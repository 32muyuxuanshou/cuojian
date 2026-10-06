'use client';
/* oxlint-disable next/no-img-element -- Local PDF images are saved as data URLs. */
import {useEffect,useRef,useState} from 'react';
import {Button} from './ui/button';
import {Textarea} from './ui/textarea';
import type {AiSettings,SharedMaterial,WrongQuestion} from '@/lib/models';
import {makeCapture} from '@/lib/capture';
import {listQuestions,saveMaterialSet} from '@/lib/local-db';
import {requestDeepSeek} from '@/lib/deepseek-client';
import {aiLabel} from '@/lib/ai-settings';
import {mergePdfIndexes,parsePdfIndex,pdfStatistics,validatePdfReport,type PdfIndex} from '@/lib/pdf-ai';
import {latestPdfJob,savePdfJob,restorePdfJob,pdfQuestionId,pdfMaterialId,pdfDraftSaved,type PdfImportJob} from '@/lib/pdf-import-db';
import {cropNormalizedRegion,mergeExtractedQuestions,openPdf,pdfFileData,renderPdfPages,splitPdf,validatePdfExtract,type PdfRegion} from '@/lib/pdf-import';

function evidenceId(index:number){return `PDF-${index+1}`;}
function uniqueRegions(regions:PdfRegion[]){return [...new Map(regions.map(region=>[JSON.stringify(region),region])).values()];}
function missingQuestions(job:PdfImportJob){return job.index?.questions.filter(entry=>!job.drafts.some(q=>q.originalNumber===entry.originalNumber&&q.sectionKey===entry.sectionKey&&q.pageNumbers.some(page=>entry.pageNumbers.includes(page))))||[];}
function jobStatistics(job:PdfImportJob){const stats=pdfStatistics(job.drafts,job.kind);return {...stats,complete:job.complete,expectedQuestions:job.index?.questions.length,missingQuestions:missingQuestions(job).length,accuracy:job.complete&&!missingQuestions(job).length?stats.accuracy:null};}

export function PdfImport({settings,onSaved}:{settings:AiSettings;onSaved:()=>Promise<void>}) {
  const input=useRef<HTMLInputElement>(null);const paused=useRef(false);
  const [job,setJob]=useState<PdfImportJob>();const [busy,setBusy]=useState(false);const [progress,setProgress]=useState('');const [error,setError]=useState('');
  const [selected,setSelected]=useState<number[]>([]);const [kind,setKind]=useState<'mistakes'|'paper'>('mistakes');const [meaning,setMeaning]=useState('');const [batchSize,setBatchSize]=useState(4);
  const [method,setMethod]=useState<'file'|'images'>('file');
  useEffect(()=>{let mounted=true;void latestPdfJob().then(saved=>{if(saved&&mounted){const restored=restorePdfJob(saved);setJob(restored);setKind(saved.kind);setMeaning(saved.annotationMeaning);setBatchSize(saved.batchSize);setSelected(restored.drafts.map((_,i)=>i).filter(i=>!pdfDraftSaved(restored,i)));}}).catch(()=>{});return()=>{mounted=false;paused.current=true;};},[]);

  async function checkpoint(next:PdfImportJob){await savePdfJob(next);setJob({...next});}
  async function analyze(file?:File,resume?:PdfImportJob){
    if(!file&&!resume)return;if(!settings.apiKey){setError('请先在设置中配置 AI 服务。');return;}
    setBusy(true);paused.current=false;setError('');
    let pdf:Awaited<ReturnType<typeof openPdf>>|undefined;
    let current:PdfImportJob=resume?{...restorePdfJob(resume),batchSize}: {id:crypto.randomUUID(),file:file!,name:file!.name,updatedAt:new Date().toISOString(),kind,annotationMeaning:meaning,batchSize,nextPage:1,totalPages:0,drafts:[],previews:{},unresolved:[],tail:'',complete:false,savedIndexes:[],savedDraftIds:[]};
    try{
      pdf=await openPdf(current.file);if(pdf.document.numPages>120)throw new Error(`当前版本最多处理120页；文件共有${pdf.document.numPages}页。`);
      current.totalPages=pdf.document.numPages;await checkpoint(current);
      const useFile=settings.provider==='openai'&&method==='file';const bytes=useFile?new Uint8Array(await current.file.arrayBuffer()):undefined;
      if(useFile&&!current.index){
        const indexes:PdfIndex[]=[...(current.indexParts||[])];const chunk=current.indexChunkSize||(current.totalPages<=30&&current.file.size<12*1024*1024?current.totalPages:12);current.indexChunkSize=chunk;
        for(let start=current.nextIndexPage||1;start<=current.totalPages;start+=chunk){
          if(paused.current)break;
          const pages=Array.from({length:Math.min(chunk,current.totalPages-start+1)},(_,i)=>start+i);
          setProgress(`正在通读第 ${start}-${pages.at(-1)} 页，建立题号与卷面答案索引…`);
          const part=chunk===current.totalPages?{name:current.name,dataUrl:await pdfFileData(current.file)}:await splitPdf(bytes!,pages);
          const raw=await requestDeepSeek<unknown>({...settings,action:'pdfIndex',thinkingMode:'low',file:part,question:{originalPages:pages,annotationMeaning:current.annotationMeaning,previousIndex:mergePdfIndexes(indexes)}});
          const parsed=parsePdfIndex(raw);if([...parsed.questions.flatMap(q=>q.pageNumbers),...parsed.answers.map(a=>a.pageNumber)].some(page=>!pages.includes(page)))throw new Error('目录返回的原始页码不一致，本段未保存，请继续重试。');
          indexes.push(parsed);current={...current,indexParts:[...indexes],nextIndexPage:start+chunk};await checkpoint(current);
        }
        if(paused.current){setProgress('已暂停。点击继续分析即可接着整理。');return;}
        current.index=mergePdfIndexes(indexes);current.unresolved=[...new Set([...current.unresolved,...current.index.issues])];await checkpoint(current);
      }
      for(let start=current.nextPage;start<=current.totalPages;start+=Math.max(1,current.batchSize-1)){
        if(paused.current)break;
        const pages=Array.from({length:Math.min(current.batchSize,current.totalPages-start+1)},(_,i)=>start+i);
        setProgress(`正在整理第 ${start}-${pages.at(-1)} 页 / 共 ${current.totalPages} 页`);
        const assets=await renderPdfPages(pdf.document,pages);const previews={...current.previews};for(const page of assets)previews[page.pageNumber]=page.overview;
        const part=useFile?await splitPdf(bytes!,pages):undefined;
        const raw=await requestDeepSeek<unknown>({...settings,action:'pdfExtract',thinkingMode:'low',file:part,imageDataUrls:useFile?assets.map(page=>page.overview):assets.flatMap(page=>[page.overview,...page.tiles]),question:{fileName:current.name,pageCount:current.totalPages,originalPages:pages,pages:assets.map(page=>({pageNumber:page.pageNumber,text:page.text,imageRoles:useFile?['overview']:['overview','tile-1','tile-2','tile-3']})),previousTailContext:current.tail,documentIndex:current.index,annotationMeaning:current.annotationMeaning}});
        const result=validatePdfExtract(raw);
        for(const q of result.questions){
          if(q.pageNumbers.some(page=>!pages.includes(page)))throw new Error('本批返回页码与PDF不一致，已保存之前的进度；请缩小每批页数后继续。');
          const match=current.index?.questions.filter(entry=>entry.originalNumber===q.originalNumber&&entry.pageNumbers.some(page=>q.pageNumbers.includes(page)));
          if(match?.length===1){q.sectionKey=match[0].sectionKey;q.materialKey=match[0].materialKey||q.materialKey;}
          q.sectionKey ||= 'section-p1';
          if(q.materialKey&&!q.materialRegions.length)q.uncertainties.push('公共资料原图尚未定位，请在题组中核对。');
          if(!q.questionRegions.length)q.uncertainties.push('小题原图尚未定位，已保留原页供核对。');
        }
        current={...current,previews,drafts:mergeExtractedQuestions(current.drafts,result.questions),tail:result.tailContext,unresolved:[...new Set([...current.unresolved,...result.unresolved])],nextPage:pages.at(-1)===current.totalPages?current.totalPages+1:start+Math.max(1,current.batchSize-1),complete:pages.at(-1)===current.totalPages};
        await checkpoint(current);setSelected(current.drafts.map((_,i)=>i).filter(i=>!pdfDraftSaved(current,i)));
        if(current.complete)break;
      }
      if(current.complete){
        const missing=current.index?.questions.filter(entry=>!current.drafts.some(q=>q.originalNumber===entry.originalNumber&&q.sectionKey===entry.sectionKey&&q.pageNumbers.some(page=>entry.pageNumbers.includes(page)))).map(entry=>`索引中的第${entry.originalNumber}题（第${entry.pageNumbers.join('、')}页）尚未完整识别。`)||[];
        current={...current,unresolved:[...new Set([...current.unresolved,...missing])]};await checkpoint(current);
        setProgress(`已识别 ${current.drafts.length} 道题。正在生成本次PDF复盘…`);
        try{await generateReport(current);}catch(reportError){setError(`题目已识别并保存进度，报告可单独重试：${reportError instanceof Error?reportError.message:'生成失败'}`);}
        setProgress(`识别完成：${current.drafts.length} 道题，${pdfStatistics(current.drafts,current.kind).materialGroups} 套共享资料。`);
      }else setProgress('已暂停；已完成的题目可以先保存，之后继续剩余页面。');
    }catch(e){setError(e instanceof Error?e.message:'PDF解析失败。已完成的进度保留在本机。');setProgress('可以从已保存的进度继续。');}
    finally{try{await pdf?.destroy();}finally{setBusy(false);}}
  }

  async function generateReport(current:PdfImportJob){
    const history=(await listQuestions()).filter(q=>!q.isDemo&&!q.inbox&&current.drafts.some(item=>item.module===q.module&&item.topic===q.topic)).slice(0,12).map(q=>({id:q.id,source:q.source,topic:q.topic,personalCause:q.attempts.at(-1)?.personalCause,attempts:q.attempts.slice(-3).map(a=>({answer:a.answer,correct:a.correct,mode:a.mode}))}));
    const raw=await requestDeepSeek<unknown>({...settings,action:'pdfReport',thinkingMode:'high',diagnosis:{statistics:jobStatistics(current),extractionIssues:current.unresolved,questions:current.drafts.map((q,index)=>({evidenceId:evidenceId(index),originalNumber:q.originalNumber,pages:q.pageNumbers,stem:q.stem.slice(0,400),module:q.module,topic:q.topic,myAnswer:q.detectedMyAnswer,documentAnswer:q.detectedCorrectAnswer,answerEvidence:q.answerEvidence,confidence:q.confidence,notes:q.extractedNotes,materialKey:q.materialKey})),history}});
    await checkpoint({...current,report:validatePdfReport(raw,current.drafts.map((_,i)=>evidenceId(i)))});
  }

  async function save(){
    if(!job||busy||!selected.length)return;setBusy(true);setError('');
    try{
      const now=new Date().toISOString();const materials=new Map<string,SharedMaterial>();const stored=await listQuestions(true);
      for(const key of new Set(selected.map(index=>job.drafts[index].materialKey).filter(Boolean))){
        const group=job.drafts.filter(q=>q.materialKey===key);const materialId=pdfMaterialId(job,key);const old=stored.filter(q=>q.material?.id===materialId).map(q=>q.material!).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];if(old){materials.set(key,old);continue;}
        const material:SharedMaterial={id:materialId,title:key,text:group.reduce((longest,item)=>item.materialText.length>longest.length?item.materialText:longest,''),images:[],updatedAt:now};
        for(const region of uniqueRegions(group.flatMap(q=>q.materialRegions))){const page=job.previews[region.pageNumber];if(page)material.images.push(await cropNormalizedRegion(page,region));}
        materials.set(key,material);
      }
      const existing=new Set(stored.map(q=>q.id));const questions:WrongQuestion[]=[];
      for(const index of selected){
        const id=pdfQuestionId(job,index);if(existing.has(id))continue;
        const item=job.drafts[index];const material=item.materialKey?materials.get(item.materialKey):undefined;
        const images:string[]=[];for(const region of uniqueRegions(item.questionRegions)){const page=job.previews[region.pageNumber];if(page)images.push(await cropNormalizedRegion(page,region));}
        const confirmed=!!item.detectedCorrectAnswer&&item.confidence==='high'&&!!item.answerEvidence;
        const base=makeCapture('');questions.push({...base,id,material,subquestionNumber:item.originalNumber||undefined,source:item.source||job.name,sourceVerified:false,stem:item.stem,options:item.options,correctAnswer:item.detectedCorrectAnswer,answerSource:item.detectedCorrectAnswer?'document':'ai',answerConfirmed:confirmed,suggestedAnswer:confirmed?undefined:item.detectedCorrectAnswer,module:item.module,topic:item.topic,tags:item.tags,correctReasoning:item.explanation,answerEvidence:item.answerEvidence,extractedNotes:item.extractedNotes,pdfSource:{name:job.name,pages:item.pageNumbers},imageDataUrl:images[0],extraImages:images.slice(1).map((dataUrl,i)=>({id:`${id}-image${i}`,role:'question',dataUrl})),answerAnalysisImageDataUrl:job.previews[item.pageNumbers[0]],inbox:true,organizeState:'review',organizeError:[...item.uncertainties,...(!confirmed&&item.detectedCorrectAnswer?['卷面答案已识别，请核对依据']:[])].join('；'),updatedAt:now,attempts:item.detectedMyAnswer?[{id:crypto.randomUUID(),answeredAt:now,answer:item.detectedMyAnswer,correct:confirmed&&item.detectedMyAnswer===item.detectedCorrectAnswer,mode:'initial'}]:[]});
      }
      if(questions.length)await saveMaterialSet(questions);
      await checkpoint({...job,savedDraftIds:[...new Set([...(job.savedDraftIds||[]),...selected.map(index=>job.drafts[index].draftId!)])]});await onSaved();setProgress(`已保存 ${questions.length} 道题到待核对。已定位的资料原图和小题原图已一起保留，未定位的部分请核对补充。`);setSelected([]);
    }catch(e){setError(e instanceof Error?e.message:'保存失败。');}finally{setBusy(false);}
  }
  const stats=job?jobStatistics(job):undefined;
  return <section className="rounded-2xl border bg-card p-5 space-y-4">
    <div><h2 className="font-heading text-xl">PDF智能导入与复盘</h2><p className="mt-1 text-sm text-muted-foreground">一次上传，识别题目、卷面答案和笔记；共享资料与小题原图一起保存。进度留在本机，可暂停继续。</p></div>
    <div className="grid gap-3 sm:grid-cols-3"><label className="text-sm">文件内容<select className="mt-1 w-full rounded-xl border p-2" disabled={busy} value={kind} onChange={e=>setKind(e.target.value as 'mistakes'|'paper')}><option value="mistakes">错题集 · 分析错题分布</option><option value="paper">完整试卷 · 分析本卷作答</option></select></label><label className="text-sm">每批页数<select className="mt-1 w-full rounded-xl border p-2" disabled={busy} value={batchSize} onChange={e=>setBatchSize(Number(e.target.value))}>{[2,4,6].map(n=><option key={n} value={n}>{n} 页</option>)}</select></label>{settings.provider==='openai'&&<label className="text-sm">读取方式<select className="mt-1 w-full rounded-xl border p-2" disabled={busy} value={method} onChange={e=>setMethod(e.target.value as 'file'|'images')}><option value="file">原生 PDF · 推荐</option><option value="images">逐页图片 · 兼容模式</option></select></label>}</div>
    <label htmlFor="pdf-annotation-meaning" className="block text-sm">笔记标记约定（可留空）<Textarea id="pdf-annotation-meaning" className="mt-1 min-h-16" disabled={busy} value={meaning} onChange={e=>setMeaning(e.target.value)} placeholder="例如：红圈是我选错的，绿色勾是正确答案；旁边手写文字是我的错因。" /></label>
    <div className="flex flex-wrap gap-2"><Button onClick={()=>input.current?.click()} disabled={busy}>选择PDF并分析</Button><input ref={input} hidden type="file" accept="application/pdf,.pdf" onChange={e=>{void analyze(e.target.files?.[0]);e.target.value='';}}/>{busy&&<Button variant="outline" onClick={()=>{paused.current=true;setProgress('本批完成后暂停，已完成的进度会保留。');}}>暂停</Button>}{job&&!job.complete&&<Button disabled={busy} variant="outline" onClick={()=>void analyze(undefined,job)}>继续分析</Button>}{job&&job.drafts.length>0&&<Button disabled={busy||!selected.length} onClick={()=>void save()}>保存选中的 {selected.length} 道</Button>}</div>
    <p className="text-xs text-muted-foreground">当前服务：{aiLabel(settings)} · {settings.model}。最多120页、40MB。仅笔记已导出到PDF时才能读取；识别有疑点会列出供核对。</p>
    {job&&<p className="text-xs text-muted-foreground">{job.name} · 已完成 {Math.min(job.totalPages,Math.max(0,job.nextPage-1))}/{job.totalPages} 页 · 已存入错题库 {job.savedDraftIds?.length||0} 道</p>}
    {progress&&<output className="block rounded-xl bg-muted p-3 text-sm" aria-live="polite">{progress}</output>}{error&&<p role="alert" className="rounded-xl bg-[#fff0e8] p-3 text-sm text-orange-900">{error}</p>}
    {stats&&stats.total>0&&<div className="rounded-xl border bg-muted/30 p-4 space-y-2"><h3 className="font-semibold">本次PDF识别统计{!job?.complete?'（未完成）':''}</h3><p className="text-sm">识别到 {stats.total} 道题 · {stats.materialGroups} 套资料 · 卷面答案 {stats.answersDetected} 道 · 笔记 {stats.notesDetected} 道</p><p className="text-sm">有明确作答与答案依据 {stats.assessable} 道：正确 {stats.correct}、错误 {stats.incorrect}；其余 {stats.unassessable} 道暂不判定。</p><p className="text-xs text-muted-foreground">{stats.accuracy!==null?`本卷已识别题目的正确率 ${stats.accuracy}%（题目是否齐全仍需核对）`:job?.kind==='mistakes'?'错题集只能说明错误分布，不能推算整体正确率。':'题目或答案信息未齐全，暂不计算整卷正确率。'}</p></div>}
    {job&&job.drafts.length>0&&<div className="rounded-xl border p-4 space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">本次PDF复盘报告</h3><Button variant="outline" size="sm" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await generateReport(job);}catch(e){setError(e instanceof Error?e.message:'生成报告失败');}finally{setBusy(false);}}}>{job.report?'重新生成':'生成报告'}</Button></div>{job.report&&<><p className="whitespace-pre-wrap text-sm">{job.report.summary}</p>{job.report.priorities.map((item,i)=><article key={i} className="rounded-lg bg-muted p-3 text-sm space-y-1"><strong>{item.topic}</strong><p>{item.observation}</p><p>依据：{item.evidence.join('、')}</p><p>加强建议：{item.advice}</p><p>完成标准：{item.successCriteria}</p></article>)}{job.report.caution&&<p className="text-xs text-muted-foreground">{job.report.caution}</p>}{job.report.message&&<p className="rounded-lg bg-[#edf6ef] p-3 text-sm">{job.report.message}</p>}</>}</div>}
    {!!job?.unresolved.length&&<details><summary>识别疑点（{job.unresolved.length}）</summary><ul className="mt-2 list-disc pl-5 text-sm">{job.unresolved.map((value,index)=><li key={index}>{value}</li>)}</ul></details>}
    {!!job?.drafts.length&&<div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={()=>setSelected(job.drafts.map((_,i)=>i).filter(i=>!pdfDraftSaved(job,i)))}>全选未保存</Button><Button variant="outline" disabled={busy} onClick={()=>setSelected([])}>清空</Button></div>}
    <div className="grid gap-4 md:grid-cols-2">{job?.drafts.map((q,index)=><article key={evidenceId(index)} id={evidenceId(index)} className="rounded-xl border p-4 space-y-2"><label className="flex gap-2"><input type="checkbox" disabled={busy||pdfDraftSaved(job,index)} checked={selected.includes(index)} onChange={()=>setSelected(old=>old.includes(index)?old.filter(i=>i!==index):[...old,index])}/><strong>{q.originalNumber?`第 ${q.originalNumber} 题`:`识别题 ${index+1}`}</strong><span className="text-xs text-muted-foreground">{evidenceId(index)} · 第 {q.pageNumbers.join('、')} 页{pdfDraftSaved(job,index)?' · 已保存':''}</span></label>{job.previews[q.pageNumbers[0]]&&<img src={job.previews[q.pageNumbers[0]]} alt={`PDF第${q.pageNumbers[0]}页预览`} className="max-h-48 w-full rounded border object-contain"/>}<p className="line-clamp-4 whitespace-pre-wrap text-sm">{q.stem}</p><p className="text-sm">我的答案：{q.detectedMyAnswer||'未识别'}　卷面答案：{q.detectedCorrectAnswer||'未识别'}</p>{q.answerEvidence&&<p className="text-xs">依据：{q.answerEvidence}</p>}{q.extractedNotes&&<p className="rounded bg-muted p-2 text-sm">笔记：{q.extractedNotes}</p>}{q.materialKey&&<p className="text-xs">共享资料：{q.materialKey} · {q.materialRegions.length} 处原图</p>}<p className="text-xs">小题原图：{q.questionRegions.length} 处</p>{q.uncertainties.length>0&&<p className="text-xs text-orange-800">待核对：{q.uncertainties.join('；')}</p>}</article>)}</div>
  </section>;
}
