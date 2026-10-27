import type { SharedMaterial, WrongQuestion } from './models';
import { getAsset } from './bank-db';
import { blobDataUrl } from './portable-backup';

// Each child carries a recoverable snapshot so existing encrypted sync and backups
// remain self-contained. Group edits are committed atomically by local-db.
export function reconcileMaterials(
  questions: WrongQuestion[],
): WrongQuestion[] {
  const latest = new Map<string, SharedMaterial>();
  for (const q of questions)
    if (
      q.material &&
      (!latest.has(q.material.id) ||
        latest.get(q.material.id)!.updatedAt < q.material.updatedAt)
    )
      latest.set(q.material.id, q.material);
  return questions.map((q) => {
    const m = q.material && latest.get(q.material.id);
    return m && m.updatedAt > q.material!.updatedAt
      ? {
          ...q,
          material: m,
          analysisStale: true,
          updatedAt: q.updatedAt > m.updatedAt ? q.updatedAt : m.updatedAt,
        }
      : q;
  });
}

export function questionContext(q: WrongQuestion) {
  return {
    responseType: q.responseType || 'single',
    originalChoice: q.originalChoice,
    originalAnswer: q.originalAnswer,
    reviewIssues: q.reviewIssues,
    imageContainsHints: q.imageContainsHints,
    sharedMaterial: q.material
      ? { title: q.material.title, text: q.material.text }
      : undefined,
    subquestionNumber: q.subquestionNumber,
    documentNotes: q.extractedNotes,
    answerEvidence: q.answerEvidence,
    pdfSource: q.pdfSource,
    answerConfirmed: q.answerConfirmed,
    correctReasoning: q.correctReasoning,
    pitfall: q.pitfall,
  };
}

export async function resolvedQuestionImages(
  q: WrongQuestion,
  includeAnalysis = true,
) {
  const images = questionImages(q, includeAnalysis);
  const references = [
    ...(q.material?.imageAssets || []).map((id) => ({
      id,
      role: 'shared-material',
    })),
    ...(q.questionImageAssets || []).map((id) => ({
      id,
      role: 'current-question',
    })),
    ...Object.entries(q.optionImageAssets || {}).flatMap(([letter, ids]) =>
      ids.map((id) => ({ id, role: `option-${letter}` })),
    ),
  ];
  for (const ref of references) {
    const asset = await getAsset(ref.id);
    if (!asset) throw new Error('缺少题目图片，请先导入完整题库包。');
    images.push({ dataUrl: await blobDataUrl(asset.blob), role: ref.role });
  }
  return images;
}
export function questionImages(q: WrongQuestion, includeAnalysis = true) {
  return [
    ...(q.material?.images || []).map((dataUrl) => ({
      dataUrl,
      role: 'shared-material',
    })),
    ...(q.imageDataUrl
      ? [{ dataUrl: q.imageDataUrl, role: 'current-question' }]
      : []),
    ...(q.extraImages || []).filter(
      (i) => includeAnalysis || i.role !== 'analysis',
    ),
    ...(includeAnalysis && q.answerAnalysisImageDataUrl
      ? [{ dataUrl: q.answerAnalysisImageDataUrl, role: 'analysis' }]
      : []),
  ];
}
