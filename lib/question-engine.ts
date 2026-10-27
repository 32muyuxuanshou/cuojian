import type { WrongQuestion } from './models';

export function isWrongQuestion(q: WrongQuestion) {
  return !q.inbox && q.collection !== 'bank';
}

export function hasReliableAnswer(q: WrongQuestion) {
  return Boolean(q.correctAnswer.trim()) && q.answerConfirmed !== false;
}

export function normalizeAnswer(
  answer: string,
  type: WrongQuestion['responseType'] = 'single',
) {
  const text = answer.trim().normalize('NFKC');
  return type === 'multiple'
    ? [
        ...new Set(
          text
            .toUpperCase()
            .split(/[\s,，、;；|]+/)
            .flatMap((s) => s.split('')),
        ),
      ]
        .sort()
        .join(',')
    : type === 'single'
      ? text.toUpperCase()
      : text;
}

export function gradeAnswer(
  q: WrongQuestion,
  answer: string,
  hintsVisible = false,
): boolean | undefined {
  if (
    !hasReliableAnswer(q) ||
    q.responseType === 'subjective' ||
    hintsVisible ||
    q.imageContainsHints
  )
    return undefined;
  return (
    normalizeAnswer(answer, q.responseType) ===
    normalizeAnswer(q.correctAnswer, q.responseType)
  );
}

// Shuffle material groups as units; do not break a shared reading into unrelated items.
export function practiceOrder(
  questions: WrongQuestion[],
  random = Math.random,
) {
  const units = new Map<string, WrongQuestion[]>();
  for (const q of questions) {
    const key = q.material?.id || q.id;
    units.set(key, [...(units.get(key) || []), q]);
  }
  const groups = [...units.values()];
  for (let i = groups.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [groups[i], groups[j]] = [groups[j], groups[i]];
  }
  return groups.flatMap((group) =>
    group.sort((a, b) =>
      (a.subquestionNumber || '').localeCompare(
        b.subquestionNumber || '',
        'zh-CN',
        { numeric: true },
      ),
    ),
  );
}

export function answerLabel(q: WrongQuestion) {
  return hasReliableAnswer(q)
    ? q.correctAnswer
    : q.correctAnswer
      ? `${q.correctAnswer}（待确认）`
      : '尚未确认';
}
