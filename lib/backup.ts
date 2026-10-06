import type { WrongQuestion } from './models';
export function validateBackup(value: unknown): WrongQuestion[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as {questions?:unknown}).questions)) throw new Error('缺少题目列表');
  const records = (value as { questions:WrongQuestion[] }).questions;
  const ids=new Set<string>();
  for(const q of records) {
    if (!q || typeof q.id!=='string' || !q.id || ids.has(q.id)) throw new Error('题目ID缺失或重复');
    ids.add(q.id);
    if((q.captureGroupId!==undefined && typeof q.captureGroupId!=='string') || (q.captureQuestionId!==undefined && typeof q.captureQuestionId!=='string') || (q.captureRole!==undefined && !['material','question'].includes(q.captureRole)))throw new Error('连续收题分组格式错误');
    if(q.material && (typeof q.material.id!=='string' || !q.material.id || typeof q.material.title!=='string' || typeof q.material.text!=='string' || !Number.isFinite(Date.parse(q.material.updatedAt)) || !Array.isArray(q.material.images) || !q.material.images.every(src=>typeof src==='string' && src.startsWith('data:image/')))) throw new Error('共享资料格式错误');
    if((q.answerEvidence!==undefined && typeof q.answerEvidence!=='string') || (q.extractedNotes!==undefined && typeof q.extractedNotes!=='string')) throw new Error('PDF识别字段格式错误');
    if(q.pdfSource && (typeof q.pdfSource.name!=='string' || !Array.isArray(q.pdfSource.pages) || !q.pdfSource.pages.every(page=>Number.isInteger(page)&&page>0))) throw new Error('PDF来源格式错误');
    for(const key of ['createdAt','updatedAt','nextReviewAt'] as const) if(!Number.isFinite(Date.parse(q[key]))) throw new Error('日期格式错误');
    for(const key of ['source','stem','module','topic','correctAnswer'] as const) if(typeof q[key]!=='string') throw new Error('题目字段不完整');
    if (!q.options || typeof q.options!=='object' || Array.isArray(q.options) || !Object.values(q.options).every(v=>typeof v==='string') || !Array.isArray(q.tags) || !q.tags.every(t=>typeof t==='string') || !Array.isArray(q.attempts)) throw new Error('题目结构错误');
    if (!q.attempts.every(a=>a && typeof a.id==='string' && typeof a.answer==='string' && typeof a.correct==='boolean' && Number.isFinite(Date.parse(a.answeredAt)))) throw new Error('作答记录格式错误');
    if (q.conversation && !q.conversation.every(m=>m && typeof m.content==='string' && ['user','assistant'].includes(m.role))) throw new Error('会话格式错误');
  }
  return records;
}
export function mergeBackup(local:WrongQuestion[], incoming:WrongQuestion[]) {
  const merged=new Map(local.map(q=>[q.id,q]));
  for(const q of incoming) if(!merged.has(q.id) || q.updatedAt>merged.get(q.id)!.updatedAt) merged.set(q.id,q);
  return [...merged.values()];
}
