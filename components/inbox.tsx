'use client';
/* oxlint-disable next/no-img-element -- Offline local data URLs must not use a remote optimizer. */
import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Button } from './ui/button';
import { Input } from './ui/input';
import type { AiSettings, WrongQuestion } from '@/lib/models';
import { captureDate, makeCapture, matchesDate, NativeCapture } from '@/lib/capture';
import { listQuestions, permanentlyDeleteQuestion, saveQuestion, trashQuestions } from '@/lib/local-db';
import { organizeOne } from '@/lib/organize';
import { MaterialView } from './material-set';
import { requestDeepSeek } from '@/lib/deepseek-client';

const labels = { pending:'待整理', queued:'待运行', running:'处理中／中断后可继续', done:'已归档', review:'待核对', error:'失败可重试' };
export function Inbox({ questions, settings, onChanged, onEdit, onStart, onMaterialSet }: { onMaterialSet:(seed:WrongQuestion[])=>void; questions:WrongQuestion[]; settings:AiSettings; onChanged:()=>Promise<void>; onEdit:(id:string)=>void; onStart:(mode:'practice'|'review',q:WrongQuestion[])=>void }) {
  const [selected,setSelected] = useState<string[]>([]);
  const [trash,setTrash] = useState<WrongQuestion[]>([]);
  const [showTrash,setShowTrash] = useState(false);
  const [period,setPeriod] = useState('all');
  const [from,setFrom] = useState(''); const [to,setTo] = useState('');
  const [message,setMessage] = useState('');
  const [busy,setBusy] = useState(false); const paused = useRef(false); const running = useRef(false);
  const draining=useRef(false);
  const [wizard,setWizard] = useState<string[]>([]); const [step,setStep] = useState(0);
  const [mine,setMine] = useState(''); const [correct,setCorrect] = useState('');
  const [report,setReport] = useState<WrongQuestion[]>([]);
  const [feedback,setFeedback] = useState<{summary:string;advice:string[];message:string}>();
  const [crop,setCrop] = useState<WrongQuestion>();
  const upload = useRef<HTMLInputElement>(null);
  const inbox = questions.filter(q => q.inbox && matchesDate(q,period,from,to)).sort((a,b)=>captureDate(a).localeCompare(captureDate(b)));
  const shown = showTrash ? trash : inbox;
  async function refresh() { setTrash((await listQuestions(true)).filter(q => q.deletedAt)); await onChanged(); }
  useEffect(() => {
    queueMicrotask(()=>void refresh());
    async function drain() {
      if (!Capacitor.isNativePlatform() || draining.current) return;
      draining.current=true;
      try {
        let total = 0;
        for (;;) {
        const { images,collectingGroup } = await NativeCapture.pending();
        if(collectingGroup)setMessage('本套资料题正在连续收录，图片已保存在本机。请长按悬浮入口 → 结束本套，再统一核对。');
        if (!images.length) break;
        const existing = new Set((await listQuestions(true)).map(q=>q.id));
        for (const image of images) { if (!existing.has(image.id)) await saveQuestion({...makeCapture(image.dataUrl,image.id,image.capturedAt),captureGroupId:image.groupId,captureRole:image.role,captureQuestionId:image.questionId}); await NativeCapture.acknowledge({ ids:[image.id] }); }
        total += images.length;
        }
        if (total) { await refresh(); setMessage(`已安全收录 ${total} 张截图。可继续裁剪或一键整理。`); }
      } catch { setMessage('截图读取失败，原图仍保留在本机，返回此页可重试。'); } finally { draining.current=false; }
    }
    void drain();
    const visible = () => { if(document.visibilityState==='visible') void drain(); };
    document.addEventListener('visibilitychange',visible);
    const timer = Capacitor.isNativePlatform() ? setInterval(visible,3000) : undefined;
    return ()=> { paused.current=true; if(timer)clearInterval(timer); document.removeEventListener('visibilitychange',visible); };
  },[]);
  async function importFiles(files:FileList|null) {
    if (!files) return;
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/') || file.size > 12*1024*1024) { setMessage('跳过非图片或超过12MB的文件'); continue; }
        const data = await new Promise<string>((resolve,reject)=>{ const r=new FileReader(); r.onload=()=>typeof r.result==='string'?resolve(r.result):reject(new Error('图片读取失败')); r.onerror=reject; r.readAsDataURL(file); });
        if ((await listQuestions()).some(q=>q.imageDataUrl===data) && !confirm(`${file.name} 已收录过，仍然添加？`)) continue;
        await saveQuestion(makeCapture(data));
      }
      await refresh();
    } catch { setMessage('保存失败，请检查设备剩余空间；尚未成功的图片请重新导入。'); }
  }
  function prepare() {
    const ids=(selected.length ? inbox.filter(q=>selected.includes(q.id)) : inbox).map(q=>q.id);
    if (!ids.length) return;
    const grouped=inbox.find(q=>ids.includes(q.id)&&q.captureGroupId&&!q.material);
    if(grouped){setMessage('请先核对资料题组，公共资料和续图不会作为独立题送给AI。');onMaterialSet(questions.filter(q=>q.inbox&&!q.material&&q.captureGroupId===grouped.captureGroupId));return;}
    setWizard(ids); setStep(0); setMine(questions.find(q=>q.id===ids[0])?.attempts[0]?.answer || ''); setCorrect(questions.find(q=>q.id===ids[0])?.correctAnswer || '');
  }
  async function confirmStep() {
    const q=(await listQuestions()).find(q=>q.id===wizard[step]);
    if (!q) { setWizard([]); return; }
    const now=new Date().toISOString();
    const initial = q.attempts.find(a=>a.mode==='initial');
    await saveQuestion({ ...q, correctAnswer:correct, answerConfirmed:!!correct, answerSource:'user', organizeState:'queued', updatedAt:now, attempts:[...(mine ? [{ ...initial, id:initial?.id || crypto.randomUUID(), answeredAt:initial?.answeredAt || captureDate(q), mode:'initial' as const, answer:mine, correct:!!correct && correct===mine }] : []), ...q.attempts.filter(a=>a.mode!=='initial')] });
    await refresh();
    if (step+1<wizard.length) { setStep(step+1); const next=questions.find(x=>x.id===wizard[step+1]); setMine(next?.attempts[0]?.answer || ''); setCorrect(next?.correctAnswer || ''); }
    else { const ids=[...wizard]; setWizard([]); void run(ids); }
  }
  async function run(ids:string[]) {
    if(running.current) return;
    if(questions.some(q=>ids.includes(q.id)&&q.captureGroupId&&!q.material)){setMessage('请先打开本套资料题组核对，再进行AI整理。');return;}
    if(!settings.apiKey) { setMessage('答案已保存。请先在设置填写 DeepSeek Key，再点继续整理。'); return; }
    running.current=true; paused.current=false; setBusy(true); setReport([]);
    const processed:string[]=[];
    try {
      for(const id of ids) {
        if(paused.current) break;
        const q=(await listQuestions()).find(x=>x.id===id);
        if(!q || !q.inbox) continue;
        setMessage(`正在整理 ${processed.length+1}/${ids.length}；每题独立保存，退出后可继续。`);
        await organizeOne(q,settings); processed.push(id); await refresh();
      }
      const result=(await listQuestions()).filter(q=>processed.includes(q.id)); setReport(result);
      if (result.length && !paused.current) {
        try {
          const f=await requestDeepSeek<{summary:string;advice:string[];message:string}>({...settings,action:'feedback',thinkingMode:'disabled',diagnosis:{total:result.length,done:result.filter(q=>!q.inbox).length,review:result.filter(q=>q.organizeState==='review').length,failed:result.filter(q=>q.organizeState==='error').length,evidence:result.map(q=>({id:q.id,topic:q.topic,personalCause:q.attempts[0]?.personalCause}))}});
          if(typeof f.summary==='string' && typeof f.message==='string' && f.message.startsWith('小羊，') && Array.isArray(f.advice) && f.advice.every(a=>typeof a==='string')) {setFeedback({...f,advice:f.advice.slice(0,2)});localStorage.setItem('cuojian_last_batch_feedback',JSON.stringify({at:new Date().toISOString(),ids:processed,...f}));}
        } catch { /* Individual question results remain safe; local feedback is shown. */ }
      }
      setMessage(paused.current ? '已暂停，已处理内容已保存。' : '本批处理结束。待核对题不会自动进入计分练习。');
    } finally { running.current=false; setBusy(false); await refresh(); }
  }
  async function remove() {
    if(!selected.length || !confirm(`${showTrash?'永久删除（不可恢复）':'移入最近删除（可以恢复）'} ${selected.length} 道题？`)) return;
    paused.current=true;
    if(showTrash) for(const id of selected) await permanentlyDeleteQuestion(id); else await trashQuestions(selected);
    setSelected([]); await refresh();
  }
  async function merge() {
    const group=inbox.filter(q=>selected.includes(q.id)); if(group.length<2) return;
    if(!confirm(`将 ${group.length} 张合并为一道题？首张为题目，后续为材料；原记录进入最近删除。`)) return;
    const first=group[0]; await saveQuestion({ ...first, extraImages:[...(first.extraImages||[]), ...group.slice(1).flatMap(q=>[...(q.imageDataUrl ? [{id:q.id,role:'material' as const,dataUrl:q.imageDataUrl}] : []), ...(q.extraImages||[])])], updatedAt:new Date().toISOString() });
    await trashQuestions(group.slice(1).map(q=>q.id)); setSelected([first.id]); await refresh();
  }
  const current=questions.find(q=>q.id===wizard[step]);
  const today=questions.filter(q=>!q.isDemo && matchesDate(q,'today'));
  return <section className="space-y-5"><h1 className="font-heading text-2xl">待整理箱</h1><p className="text-sm text-muted-foreground">今天收录 {today.length} 道 · 今天整理 {questions.filter(q=>!q.isDemo && q.organizedAt && new Date(q.organizedAt).toDateString()===new Date().toDateString()).length} 道。收录量不是掌握率。</p>
    <div className="flex flex-wrap gap-2"><Button onClick={()=>onMaterialSet(inbox.filter(q=>selected.includes(q.id)))}>资料分析：资料＋多个小题</Button><Button onClick={()=>upload.current?.click()}>导入截图（多张）</Button><input ref={upload} hidden type="file" multiple accept="image/*" onChange={e=>{void importFiles(e.target.files); e.target.value='';}} />{Capacitor.isNativePlatform() && <><Button variant="outline" onClick={()=>NativeCapture.start().catch(e=>setMessage(e.message))}>开启悬浮收题</Button><Button variant="outline" onClick={()=>NativeCapture.start({group:true}).catch(e=>setMessage(e.message))}>悬浮连续收一套资料题</Button><Button variant="outline" onClick={()=>NativeCapture.stop()}>停止悬浮收题</Button></>}<Button variant="outline" onClick={()=>{setShowTrash(!showTrash);setSelected([]);void refresh();}}>{showTrash?'返回待整理':'最近删除'}</Button></div>
    <p className="text-xs text-muted-foreground">悬浮收题需由你授权屏幕捕获；只在点击收题时保存。点按截图，长按菜单切换资料/小题、补图或结束本套。锁屏后可能需要重新授权；小米系统若清理后台，请在系统设置允许后台运行。</p>
    <div className="flex flex-wrap gap-2"><select aria-label="收录日期" value={period} onChange={e=>setPeriod(e.target.value)} className="rounded-xl border p-2">{[['all','全部时间'],['today','今天'],['yesterday','昨天'],['7','近7天'],['30','近30天'],['custom','自定义']].map(([v,l])=><option value={v} key={v}>{l}</option>)}</select>{period==='custom' && <><Input type="date" aria-label="开始日期" className="w-auto" value={from} onChange={e=>setFrom(e.target.value)} /><Input type="date" aria-label="结束日期" className="w-auto" value={to} onChange={e=>setTo(e.target.value)} /></>}<Button variant="outline" onClick={()=>setSelected(shown.map(q=>q.id))}>全选当前 {shown.length} 道</Button><Button variant="outline" onClick={()=>setSelected([])}>清空选择</Button><Button variant="outline" disabled={!selected.length} onClick={remove}>删除 {selected.length} 道</Button>{showTrash ? <Button disabled={!selected.length} onClick={async()=>{await trashQuestions(selected,true);setSelected([]);await refresh();}}>恢复</Button> : <><Button disabled={busy || !inbox.length} onClick={prepare}>一键整理（先确认答案）</Button><Button disabled={busy} onClick={()=>run(inbox.filter(q=>['queued','running','error'].includes(q.organizeState||'')).map(q=>q.id))}>继续 / 重试失败</Button><Button variant="outline" disabled={selected.length<2 || busy} onClick={merge}>合并为一道题</Button>{busy && <Button onClick={()=>{paused.current=true;setMessage('本题处理结束后暂停。');}}>暂停</Button>}</>}</div>
    {!showTrash && [...new Set(inbox.filter(q=>q.captureGroupId&&!q.material).map(q=>q.captureGroupId!))].map(id=>{const set=questions.filter(q=>q.inbox&&!q.material&&q.captureGroupId===id);return <div key={id} className="rounded-2xl border bg-muted p-4"><h2>连续收录的资料题组 · {set.length} 张</h2><p className="text-sm">资料 {set.filter(q=>q.captureRole==='material').length} 张，小题及续图 {set.filter(q=>q.captureRole==='question').length} 张。请先在悬浮菜单结束本套，再核对归档。</p><Button onClick={()=>onMaterialSet(set)}>整套核对（自动分好资料和续图）</Button></div>;})}
    {message && <output className="block rounded-xl bg-muted p-3 text-sm">{message}</output>}
    {feedback && <div className="rounded-2xl bg-[#fff8ef] p-5 space-y-3"><h2>DeepSeek 整理反馈</h2><p>{feedback.summary}</p>{feedback.advice.map(a=><p key={a}>{a}</p>)}<p>{feedback.message}</p></div>}
    {wizard.length>0 && current && <div className="space-y-3 rounded-2xl border bg-card p-5"><h2>确认答案 {step+1}/{wizard.length}（可留空，AI不会替你确认）</h2><MaterialView material={current.material} />{current.imageDataUrl && <img alt="当前题目" src={current.imageDataUrl} className="max-h-96 w-full object-contain" />}<p>{current.stem}</p><div className="flex flex-wrap gap-4">{[['我的选项',mine,setMine],['正确答案',correct,setCorrect]].map(([label,value,setter])=><label key={String(label)}>{String(label)} <select className="rounded border p-2" value={String(value)} onChange={e=>(setter as (v:string)=>void)(e.target.value)}><option value="">不记得 / 暂不知道</option>{['A','B','C','D','E'].map(v=><option key={v}>{v}</option>)}</select></label>)}</div><Button onClick={confirmStep}>{step+1===wizard.length?'保存并开始AI整理':'保存，下一题'}</Button><Button variant="outline" onClick={()=>setWizard([])}>稍后继续</Button></div>}
    {report.length>0 && <div className="rounded-2xl border bg-card p-5 space-y-3"><h2>本批反馈</h2><p>已归档 {report.filter(q=>q.organizeState==='done').length} · 待核对 {report.filter(q=>q.organizeState==='review').length} · 失败 {report.filter(q=>q.organizeState==='error').length}</p><p>小羊，题目已经一张张安顿好了。慢慢核对，不需要一次就弄懂所有题。</p><p className="text-sm">先核对缺失的材料和答案；再用白题复习检验是否真的理解。仅凭收录不能判断薄弱点。</p><Button onClick={()=>onStart('review',report.filter(q=>!q.inbox))}>复习已归档题</Button><Button variant="outline" onClick={()=>onStart('practice',report.filter(q=>!q.inbox))}>写题检验</Button></div>}
    <div className="grid gap-4 md:grid-cols-2">{shown.filter(q=>showTrash||!q.captureGroupId||q.material).map(q=><article key={q.id} className="rounded-2xl border bg-card p-4 space-y-3"><label className="flex gap-2"><input type="checkbox" checked={selected.includes(q.id)} onChange={()=>setSelected(v=>v.includes(q.id)?v.filter(id=>id!==q.id):[...v,q.id])} />{new Date(captureDate(q)).toLocaleString('zh-CN')} · {q.deletedAt?'最近删除':labels[q.organizeState||'pending']}</label>{q.imageDataUrl && <img src={q.imageDataUrl} alt="题目截图" className="max-h-60 w-full object-contain" />}{q.material && <p className="text-sm">{q.material.title} · 小题 {q.subquestionNumber}</p>}<p>{q.stem || '图片待识别'}</p>{q.extraImages?.map(i=><div key={i.id}><img src={i.dataUrl} alt={i.role} className="max-h-32" /><select aria-label="图片角色" value={i.role} onChange={async e=>{await saveQuestion({...q,extraImages:q.extraImages?.map(x=>x.id===i.id?{...x,role:e.target.value as typeof i.role}:x),updatedAt:new Date().toISOString()});await refresh();}}><option value="question">题目</option><option value="material">材料</option><option value="analysis">解析（白题隐藏）</option></select></div>)}{q.organizeError && <p className="text-sm text-orange-800">{q.organizeError}</p>}{q.suggestedAnswer && <p>AI候选答案：{q.suggestedAnswer}（未代替用户确认）</p>}{!showTrash && <div className="flex gap-2"><Button variant="outline" onClick={()=>onEdit(q.id)}>编辑 / 核对归档</Button>{q.imageDataUrl && <Button variant="outline" onClick={()=>setCrop(q)}>裁剪 / 遮住答案</Button>}</div>}</article>)}</div>
    {crop && <CropEditor question={crop} onClose={()=>setCrop(undefined)} onSaved={refresh} />}
  </section>;
}

function CropEditor({question,onClose,onSaved}:{question:WrongQuestion;onClose:()=>void;onSaved:()=>Promise<void>}) {
  const canvas=useRef<HTMLCanvasElement>(null); const img=useRef<HTMLImageElement | undefined>(undefined);
  const [box,setBox]=useState({x:0,y:0,w:0,h:0}); const start=useRef<{x:number;y:number} | undefined>(undefined); const [mask,setMask]=useState(false);
  useEffect(()=>{ const image=new Image(); image.onload=()=>{img.current=image;const c=canvas.current!;c.width=image.width;c.height=image.height;c.getContext('2d')!.drawImage(image,0,0);setBox({x:0,y:0,w:image.width,h:image.height});};image.src=question.imageDataUrl!;},[question]);
  useEffect(()=>{const c=canvas.current; if(!c || !img.current)return;const ctx=c.getContext('2d')!;ctx.clearRect(0,0,c.width,c.height);ctx.drawImage(img.current,0,0);ctx.strokeStyle='#00aaaa';ctx.lineWidth=Math.max(3,c.width/250);ctx.strokeRect(box.x,box.y,box.w,box.h);if(mask){ctx.fillStyle='rgba(255,255,255,.7)';ctx.fillRect(box.x,box.y,box.w,box.h);}},[box,mask]);
  function point(e:React.PointerEvent<HTMLCanvasElement>){const r=e.currentTarget.getBoundingClientRect();return {x:(e.clientX-r.left)*e.currentTarget.width/r.width,y:(e.clientY-r.top)*e.currentTarget.height/r.height};}
  async function save(){ if(box.w<5||box.h<5)return;const c=document.createElement('canvas');c.width=mask?img.current!.width:Math.round(box.w);c.height=mask?img.current!.height:Math.round(box.h);const ctx=c.getContext('2d')!;if(mask){ctx.drawImage(img.current!,0,0);ctx.fillStyle='white';ctx.fillRect(box.x,box.y,box.w,box.h);}else ctx.drawImage(img.current!,box.x,box.y,box.w,box.h,0,0,c.width,c.height);await saveQuestion({...question,imageDataUrl:c.toDataURL('image/png'),analysisStale:true,updatedAt:new Date().toISOString()});await onSaved();onClose();}
  return <div className="fixed inset-0 z-50 overflow-auto bg-background p-5"><h2>拖动框选：{mask?'遮住答案标记':'保留题目区域'}</h2><p className="text-xs">裁剪会替换当前题目图。请保留题目需要的图形、材料与选项。</p><div className="relative mt-3"><canvas ref={canvas} className="max-h-[70vh] max-w-full touch-none border" onPointerDown={e=>{start.current=point(e);e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(!start.current)return;const p=point(e),s=start.current;setBox({x:Math.min(s.x,p.x),y:Math.min(s.y,p.y),w:Math.abs(s.x-p.x),h:Math.abs(s.y-p.y)});}} onPointerUp={()=>{start.current=undefined;}} /></div><p>选区：{Math.round(box.w)} × {Math.round(box.h)}（左 {Math.round(box.x)}，上 {Math.round(box.y)}）</p><label><input type="checkbox" checked={mask} onChange={e=>setMask(e.target.checked)} /> 白色遮挡模式</label><div className="mt-3 flex gap-2"><Button onClick={save}>保存选区</Button><Button variant="outline" onClick={onClose}>取消</Button></div></div>;
}
