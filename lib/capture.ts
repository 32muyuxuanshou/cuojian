import { registerPlugin } from '@capacitor/core';
import type { WrongQuestion } from './models';

export const NativeCapture = registerPlugin<{
  start(options?: {group?:boolean}): Promise<void>;
  stop(): Promise<void>;
  pending(): Promise<{ collectingGroup?:string; images: Array<{ id: string; dataUrl: string; capturedAt: string; groupId?:string; role?:'material'|'question'; questionId?:string }> }>;
  acknowledge(options: { ids: string[] }): Promise<void>;
}>('NativeCapture');

export const captureDate = (q: WrongQuestion) => q.capturedAt || q.createdAt;
export function matchesDate(q: WrongQuestion, period: string, from = '', to = '', now = new Date()) {
  const time = Date.parse(captureDate(q));
  if (period === 'all') return true;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let end = new Date(start); end.setDate(end.getDate() + 1);
  if (period === 'yesterday') { end = new Date(start); start.setDate(start.getDate() - 1); }
  else if (period === '7' || period === '30') start.setDate(start.getDate() - (Number(period) - 1));
  else if (period === 'custom') {
    const a = from ? new Date(`${from}T00:00:00`).getTime() : -Infinity;
    const b = to ? new Date(`${to}T00:00:00`) : null;
    if (b) b.setDate(b.getDate() + 1);
    return time >= a && time < (b?.getTime() ?? Infinity);
  }
  return time >= start.getTime() && time < end.getTime();
}

export function makeCapture(imageDataUrl: string, id = crypto.randomUUID(), capturedAt = new Date().toISOString()): WrongQuestion {
  return { id, capturedAt, createdAt: capturedAt, updatedAt: capturedAt, inbox: true, organizeState: 'pending', source: '', sourceVerified: false, stem: '', options: {}, correctAnswer: '', answerSource: 'user', answerConfirmed: false, module: '', topic: '', tags: [], imageDataUrl, status: 'learning', reviewLevel: 0, nextReviewAt: capturedAt, attempts: [] };
}
