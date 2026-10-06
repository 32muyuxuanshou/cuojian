'use client';
/* oxlint-disable next/no-img-element -- Offline local images. */
import { useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import type { SharedMaterial, WrongQuestion } from '@/lib/models';
import { makeCapture } from '@/lib/capture';
import { saveMaterialSet } from '@/lib/local-db';
import {distributeCaptureGroup} from '@/lib/capture-groups';

export function MaterialView({material}:{material?:SharedMaterial}) {
  if(!material)return null;
  return <section className="mb-5 rounded-2xl border bg-muted/30 p-4"><h2 className="mb-3 font-semibold">共享资料</h2>{material.images.map((src,i)=><a key={i} href={src} target="_blank" rel="noreferrer" aria-label={`放大资料图片 ${i+1}`}><img src={src} alt={`资料 ${i+1}`} className="my-3 w-full rounded border object-contain" /></a>)}{material.images.length&&material.text?<details><summary className="text-xs text-muted-foreground">查看识别文字</summary><p className="mt-2 whitespace-pre-wrap text-sm leading-7">{material.text}</p></details>:<p className="whitespace-pre-wrap text-sm leading-7">{material.text}</p>}</section>;
}

export function MaterialSetEditor({seed=[],existing=false,onSaved,onCancel}:{seed?:WrongQuestion[];existing?:boolean;onSaved:()=>Promise<void>;onCancel:()=>void}) {
  const [choosing,setChoosing]=useState(!existing && seed.length>0);
  const [materialIds,setMaterialIds]=useState(seed.some(q=>q.captureRole==='material') ? seed.filter(q=>q.captureRole==='material').map(q=>q.id) : seed.length ? [seed[0].id] : []);
  const [consumed,setConsumed]=useState<WrongQuestion[]>([]);
  const [material,setMaterial]=useState<SharedMaterial>(()=>seed[0]?.material || {id:crypto.randomUUID(),title:'资料分析题组',text:'',images:existing ? (seed[0]?.extraImages || []).filter(i=>i.role==='material').map(i=>i.dataUrl) : [],updatedAt:new Date().toISOString()});
  const [source,setSource]=useState(seed[0]?.source || '');
  const blank=()=>({...makeCapture(''),imageDataUrl:undefined,module:'资料分析'});
  const [children,setChildren]=useState<WrongQuestion[]>(()=>existing && seed.length ? seed : [blank()]);
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  function patch(id:string,change:Partial<WrongQuestion>){setChildren(old=>old.map(q=>q.id===id?{...q,...change}:q));}
  async function files(input:FileList|null):Promise<string[]> {
    if(!input)return [];const output:string[]=[];
    for(const file of Array.from(input)){if(!file.type.startsWith('image/')||file.size>12*1024*1024)throw Error('每张图片须小于12MB');output.push(await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>typeof r.result==='string'?resolve(r.result):reject(Error('图片读取失败'));r.onerror=()=>reject(Error('图片读取失败'));r.readAsDataURL(file);}));}return output;
  }
  function distribute(){
    const distributed=distributeCaptureGroup(seed,materialIds);
    const selected=distributed.materials;
    if(!selected.length){setError('至少选择一张公共资料，其他截图作为独立小题。');return;}
    setMaterial(m=>({...m,text:selected.map(q=>q.stem).filter(Boolean).join('\n\n'),images:selected.flatMap(q=>[q.imageDataUrl,...(q.extraImages||[]).filter(i=>i.role!=='analysis').map(i=>i.dataUrl)]).filter(Boolean) as string[]}));
    const remaining=distributed.children;setChildren(remaining.length?remaining:[blank()]);setConsumed(distributed.consumed);setChoosing(false);setError('');
  }
  async function save(){
    if(busy)return;
    if(!material.text.trim()&&!material.images.length){setError('请填写共享资料文字或上传资料图片。');return;}
    if(children.some(q=>!q.stem.trim()&&!q.imageDataUrl)){setError('每道小题至少需要题干或图片；请删除空白的新小题。');return;}
    setBusy(true);setError('');
    try{
      const now=new Date().toISOString();const nextMaterial={...material,updatedAt:now};
      const result=children.map((q,index)=>{
        const original=seed.find(s=>s.id===q.id);
        const changed=!!original&&(JSON.stringify(original.material)!==JSON.stringify(material)||original.stem!==q.stem||original.correctAnswer!==q.correctAnswer||JSON.stringify(original.options)!==JSON.stringify(q.options)||original.imageDataUrl!==q.imageDataUrl);
        const answerChanged=!!original && original.correctAnswer!==q.correctAnswer;
        return {...q,captureGroupId:undefined,captureRole:undefined,captureQuestionId:undefined,attempts:[...q.attempts].sort((a,b)=>(a.mode==='initial'?0:1)-(b.mode==='initial'?0:1)),material:nextMaterial,subquestionNumber:q.subquestionNumber || String(index+1),source:source.trim() || q.source,module:q.module || '资料分析',updatedAt:now,answerConfirmed:!!q.correctAnswer && q.answerConfirmed!==false,inbox:!q.correctAnswer || q.answerConfirmed===false,organizeState:(!q.correctAnswer || q.answerConfirmed===false ? 'pending':'done') as 'pending'|'done',analysisStale:changed || q.analysisStale, ...(answerChanged ? {reviewLevel:0,status:'learning' as const,nextReviewAt:now} : {})};
      });
      await saveMaterialSet(result,consumed,seed.filter(s=>children.some(q=>q.id===s.id)));
      await onSaved();
    }catch(e){setError(e instanceof Error?e.message:'保存失败');}finally{setBusy(false);}
  }
  return <section className="space-y-5"><Button variant="outline" onClick={onCancel} disabled={busy}>返回</Button><h1 className="font-heading text-2xl">资料分析 · 一份资料，多道小题</h1><p className="text-sm text-muted-foreground">资料录入一次，每道小题分别记录答案、错因、解析和复习进度。也可以只收录其中做错的小题。</p>
    {choosing ? <><h2>核对公共资料截图（已自动勾选）；同一小题续图会自动合并</h2><div className="grid gap-4 sm:grid-cols-2">{seed.map(q=><label key={q.id} className="rounded-xl border p-3"><input type="checkbox" checked={materialIds.includes(q.id)} onChange={()=>setMaterialIds(ids=>ids.includes(q.id)?ids.filter(id=>id!==q.id):[...ids,q.id])} /> 这是公共资料{q.imageDataUrl&&<img src={q.imageDataUrl} alt="待分配截图" className="max-h-64 w-full object-contain" />}<p>{q.stem}</p></label>)}</div><Button onClick={distribute}>确认资料与小题</Button></> : <>
      <div className="rounded-2xl border bg-card p-5 space-y-4"><label className="block">题组名称<Input value={material.title} onChange={e=>setMaterial({...material,title:e.target.value})} /></label><label className="block">来源<Input value={source} onChange={e=>setSource(e.target.value)} placeholder="例如：2025国考 · 第一篇资料" /></label><label className="block">共享资料文字<Textarea value={material.text} onChange={e=>setMaterial({...material,text:e.target.value})} className="min-h-32" placeholder="粘贴这篇资料、表格说明，或上传资料图片" /></label><label className="block">上传公共资料图片（可多张）<Input type="file" accept="image/*" multiple onChange={async e=>{try{const added=await files(e.target.files);setMaterial(m=>({...m,images:[...m.images,...added]}));}catch(err){setError(String(err));}}} /></label><div className="grid gap-3 sm:grid-cols-2">{material.images.map((src,i)=><div key={i}><img src={src} alt={`公共资料${i+1}`} className="max-h-64 w-full object-contain" /><Button variant="outline" size="sm" onClick={()=>setMaterial(m=>({...m,images:m.images.filter((_,j)=>i!==j)}))}>移除此图</Button></div>)}</div></div>
      <div className="flex flex-wrap gap-3"><Button onClick={()=>setChildren(q=>[...q,blank()])}>＋ 添加小题</Button><label>批量添加小题截图（每张一道）<Input type="file" accept="image/*" multiple onChange={async e=>{try{const added=await files(e.target.files);setChildren(q=>[...q.filter(x=>x.stem||x.imageDataUrl||seed.some(s=>s.id===x.id)),...added.map(imageDataUrl=>({...blank(),imageDataUrl}))]);}catch(err){setError(String(err));}}} /></label></div>
      {children.map((q,i)=><article key={q.id} className="rounded-2xl border bg-card p-5 space-y-3"><div className="flex items-center justify-between"><h2>小题 {i+1}</h2>{!seed.some(s=>s.id===q.id) && children.length>1 && <Button variant="outline" onClick={()=>setChildren(old=>old.filter(x=>x.id!==q.id))}>移除空白 / 新小题</Button>}</div><label className="block">原题号<Input value={q.subquestionNumber||''} placeholder={String(i+1)} onChange={e=>patch(q.id,{subquestionNumber:e.target.value})} /></label><label className="block">本小题题干<Textarea value={q.stem} onChange={e=>patch(q.id,{stem:e.target.value})} placeholder="只填写本小题；公共资料不必重复粘贴" /></label>{q.imageDataUrl&&<img src={q.imageDataUrl} alt={`小题${i+1}`} className="max-h-72 w-full object-contain" />}{q.extraImages?.filter(x=>x.role==='question').map(x=><img key={x.id} src={x.dataUrl} alt="本小题续图" className="max-h-72 w-full object-contain" />)}<label className="block">小题图片<Input type="file" accept="image/*" onChange={async e=>{try{const urls=await files(e.target.files);if(urls[0])patch(q.id,{imageDataUrl:urls[0]});}catch(err){setError(String(err));}}} /></label><div className="grid gap-3 sm:grid-cols-2">{['A','B','C','D'].map(key=><label key={key}>选项 {key}<Input value={q.options[key]||''} onChange={e=>patch(q.id,{options:{...q.options,[key]:e.target.value}})} /></label>)}</div><div className="flex flex-wrap gap-4"><label>我的选项 <select value={q.attempts.find(a=>a.mode==='initial')?.answer||''} onChange={e=>{const old=q.attempts.find(a=>a.mode==='initial');patch(q.id,{attempts:[...q.attempts.filter(a=>a.mode!=='initial'),...(e.target.value?[{...old,id:old?.id||crypto.randomUUID(),answeredAt:old?.answeredAt||q.createdAt,mode:'initial' as const,answer:e.target.value,correct:!!q.correctAnswer&&e.target.value===q.correctAnswer}]:[])]});}}><option value="">暂不填写</option>{['A','B','C','D','E'].map(v=><option key={v}>{v}</option>)}</select></label><label>正确答案 <select value={q.correctAnswer} onChange={e=>patch(q.id,{correctAnswer:e.target.value,answerConfirmed:!!e.target.value,answerSource:'user',attempts:q.attempts.map(a=>a.mode==='initial'?{...a,correct:!!e.target.value&&a.answer===e.target.value}:a)})}><option value="">暂不知道</option>{['A','B','C','D','E'].map(v=><option key={v}>{v}</option>)}</select></label></div><label className="block">本小题解析（可留空）<Textarea value={q.correctReasoning||''} onChange={e=>patch(q.id,{correctReasoning:e.target.value})} /></label></article>)}
      <p className="text-sm">共 {children.length} 道小题。{consumed.length>0?`保存后 ${consumed.length} 条原资料截图移入最近删除，资料保留在题组内。`:''}答案未确认的小题进入待整理箱；其余进入错题库。</p><Button disabled={busy} onClick={save}>{busy?'正在保存…':`保存资料和 ${children.length} 道小题`}</Button>
    </>}{error&&<p role="alert" className="rounded-xl bg-muted p-3">{error}</p>}</section>;
}
