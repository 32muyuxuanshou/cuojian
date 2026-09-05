import type { SharedMaterial, WrongQuestion } from './models';

// Each child carries a recoverable snapshot so existing encrypted sync and backups
// remain self-contained. Group edits are committed atomically by local-db.
export function reconcileMaterials(questions: WrongQuestion[]): WrongQuestion[] {
  const latest = new Map<string, SharedMaterial>();
  for (const q of questions) if (q.material && (!latest.has(q.material.id) || latest.get(q.material.id)!.updatedAt < q.material.updatedAt)) latest.set(q.material.id,q.material);
  return questions.map(q=> {
    const m=q.material && latest.get(q.material.id);
    return m && m.updatedAt > q.material!.updatedAt ? {...q,material:m,analysisStale:true,updatedAt:q.updatedAt > m.updatedAt ? q.updatedAt : m.updatedAt} : q;
  });
}

export function questionContext(q:WrongQuestion) {
  return { sharedMaterial:q.material ? {title:q.material.title,text:q.material.text} : undefined, subquestionNumber:q.subquestionNumber };
}
export function questionImages(q:WrongQuestion, includeAnalysis=true) {
  return [
    ...(q.material?.images || []).map(dataUrl=>({dataUrl,role:'shared-material'})),
    ...(q.imageDataUrl ? [{dataUrl:q.imageDataUrl,role:'current-question'}] : []),
    ...(q.extraImages || []).filter(i=>includeAnalysis || i.role!=='analysis'),
    ...(includeAnalysis && q.answerAnalysisImageDataUrl ? [{dataUrl:q.answerAnalysisImageDataUrl,role:'analysis'}] : []),
  ];
}
