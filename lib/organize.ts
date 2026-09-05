import type { AiSettings, WrongQuestion } from './models';
import { requestDeepSeek } from './deepseek-client';
import { listQuestions, saveIfUnchanged } from './local-db';

export function validateOrganized(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('AI 返回格式无效');
  const q = value as Record<string, unknown>;
  for (const key of ['stem','module','topic','source','suggestedAnswer','correctReasoning','pitfall']) if (typeof q[key] !== 'string') throw new Error(`AI 缺少 ${key}，请重试`);
  for (const key of ['tags','issues']) if (!Array.isArray(q[key]) || !(q[key] as unknown[]).every(x => typeof x === 'string')) throw new Error(`AI ${key} 格式错误`);
  if (!q.options || typeof q.options !== 'object' || Array.isArray(q.options) || !Object.values(q.options).every(x => typeof x === 'string')) throw new Error('AI 选项格式错误');
  return q as { stem:string; module:string; topic:string; source:string; suggestedAnswer:string; correctReasoning:string; pitfall:string; tags:string[]; issues:string[]; options:Record<string,string> };
}

const inFlight = new Set<string>();
export async function organizeOne(q: WrongQuestion, settings: AiSettings) {
  if (inFlight.has(q.id)) return false;
  inFlight.add(q.id);
  try {
  const start = { ...q, organizeState: 'running' as const, organizeError: undefined, updatedAt: new Date().toISOString() };
  if (!await saveIfUnchanged(start, q.updatedAt)) return false;
  try {
    const history = (await listQuestions()).filter(x => x.id !== q.id && !x.inbox && !x.isDemo && x.topic && x.topic === q.topic).slice(0,5).map(x => ({ id:x.id, topic:x.topic, personalCause:x.attempts.filter(a => a.personalCause).at(-1)?.personalCause }));
    const images = [q.imageDataUrl, ...(q.extraImages || []).map(i => i.dataUrl), q.answerAnalysisImageDataUrl].filter(Boolean) as string[];
    const data = validateOrganized(await requestDeepSeek({ ...settings, action:'organize', imageDataUrls:images, question:{ stem:q.stem, options:q.options, source:q.source, module:q.module, topic:q.topic, correctAnswer:q.answerConfirmed ? q.correctAnswer : '', myAnswer:q.attempts[0]?.answer, personalCause:q.attempts[0]?.personalCause, imageRoles:['question', ...(q.extraImages || []).map(i => i.role), ...(q.answerAnalysisImageDataUrl ? ['analysis'] : [])] }, history }));
    const conflict = q.answerConfirmed && !!data.suggestedAnswer && data.suggestedAnswer !== q.correctAnswer;
    const issues = [...data.issues, ...(conflict ? ['AI结论与已确认答案不一致，请核对'] : []), ...(!q.answerConfirmed ? ['正确答案尚未由你确认'] : [])];
    const now = new Date().toISOString();
    return await saveIfUnchanged({ ...start, stem:q.stem || data.stem, options:Object.keys(q.options).length ? q.options : data.options, source:q.source || data.source, module:q.module || data.module, topic:q.topic || data.topic, tags:[...new Set([...q.tags,...data.tags])], suggestedAnswer:data.suggestedAnswer, correctReasoning:q.correctReasoning || data.correctReasoning, pitfall:q.pitfall || data.pitfall, organizedAt:now, updatedAt:now, organizeState:issues.length ? 'review' : 'done', organizeError:issues.join('；'), inbox:issues.length > 0, analysisStale:false }, start.updatedAt);
  } catch (error) {
    await saveIfUnchanged({ ...start, organizeState:'error', organizeError:error instanceof Error ? error.message : '整理失败', updatedAt:new Date().toISOString() }, start.updatedAt);
    return false;
  }
  } finally { inFlight.delete(q.id); }
}
