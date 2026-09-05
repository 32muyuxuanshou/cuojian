import type { Attempt, WrongQuestion } from './models';

export type EvidenceLevel = '待观察' | '中等' | '较强';
export type WeaknessStatus = '优先加强' | '尚不稳定' | '正在改善' | '趋于掌握' | '待观察';

export interface WeaknessDiagnosis {
  key: string;
  module: string;
  topic: string;
  score: number;
  evidenceLevel: EvidenceLevel;
  status: WeaknessStatus;
  questionCount: number;
  attemptCount: number;
  repeatAttemptCount: number;
  repeatAccuracy?: number;
  fuzzyRate?: number;
  overdueCount: number;
  topCause?: string;
  trend: 'improving' | 'stable' | 'declining' | 'unknown';
  questionIds: string[];
  evidence: Array<{ id: string; source: string; stem: string; results: boolean[]; cause?: string }>;
  localAdvice: string[];
}

export interface DiagnosisOptions {
  days?: 7 | 30 | 90 | 'all';
  source?: string;
}

const causeAdvice: Record<string, string> = {
  知识盲区: '先阅读对应知识卡，再用 3 道基础题确认概念边界。',
  方法不熟: '复述一次标准步骤，再完成 5 道同类题，做到不看提示也能启动方法。',
  审题失误: '做题时圈出主体、范围和限定词，连续 3 题写下题目真正问什么。',
  计算错误: '每题增加单位、正负号、基期/现期和量级检查，正确后再做限时训练。',
  时间不足: '先不限时做对 3 题，再做一组限时题；不要一开始只追求速度。',
  选项纠结: '强制写出两个候选项的差异和排除理由，训练比较力度而非凭感觉选择。',
  主观发挥: '把判断重新落到题干原句或明确规则，避免补充题目没有提供的前提。',
  其他: '查看证据题，补充更具体的个人错因后再生成针对性训练。',
};

export function diagnoseWeaknesses(questions: WrongQuestion[], options: DiagnosisOptions = {}): WeaknessDiagnosis[] {
  const now = Date.now();
  const start = options.days && options.days !== 'all' ? now - options.days * 86_400_000 : 0;
  const scoped = questions.filter((question) => !question.isDemo && !question.inbox && !question.deletedAt && question.answerConfirmed !== false && !!question.correctAnswer && (!options.source || question.source === options.source)
    && (!start || question.attempts.some((attempt) => new Date(attempt.answeredAt).getTime() >= start)));
  const groups = new Map<string, WrongQuestion[]>();
  scoped.forEach((question) => {
    const key = `${question.module} · ${question.topic}`;
    groups.set(key, [...(groups.get(key) || []), question]);
  });

  return [...groups.entries()].map(([key, group]) => {
    const periodAttempts = group.flatMap((question) => question.attempts.filter((attempt) => new Date(attempt.answeredAt).getTime() >= start));
    const repeated = group.flatMap((question) => question.attempts.filter((attempt, index) => (attempt.mode ? attempt.mode !== 'initial' : index > 0) && new Date(attempt.answeredAt).getTime() >= start));
    const repeatAttempts = repeated.filter(a => a.mode !== 'review' && !a.selfRating && !a.revealedAnswer);
    const reviewAttempts = repeated.filter((attempt) => attempt.mode === 'review' || attempt.answer === '未想起');
    const repeatErrorRate = repeatAttempts.length ? repeatAttempts.filter((attempt) => !attempt.correct).length / repeatAttempts.length : undefined;
    const fuzzyRate = reviewAttempts.length ? reviewAttempts.filter((attempt) => attempt.selfRating !== 'mastered' && !attempt.correct).length / reviewAttempts.length : undefined;
    const overdueCount = group.filter((question) => question.status !== 'mastered' && new Date(question.nextReviewAt).getTime() <= now).length;
    const levelRisk = average(group.map((question) => 1 - Math.min(question.reviewLevel, 5) / 5));
    const overdueRisk = group.length ? overdueCount / group.length : 0;
    const causeCounts = count(group.flatMap((question) => [...new Set(question.attempts.filter(a => Date.parse(a.answeredAt) >= start).map((attempt) => attempt.causeType).filter(Boolean))] as string[]));
    const topCause = causeCounts[0]?.[0];
    const repeatedCauseRisk = causeCounts[0] && group.length > 1 ? Math.min(1, causeCounts[0][1] / group.length) : 0;

    const weighted: Array<[number, number]> = [[levelRisk, 25], [overdueRisk, 15], [repeatedCauseRisk, 10]];
    if (repeatErrorRate !== undefined) weighted.push([smoothedRate(repeatAttempts.filter((attempt) => !attempt.correct).length, repeatAttempts.length), 35]);
    if (fuzzyRate !== undefined) weighted.push([smoothedRate(reviewAttempts.filter((attempt) => !attempt.correct).length, reviewAttempts.length), 15]);
    const weightTotal = weighted.reduce((sum, [, weight]) => sum + weight, 0);
    const rawScore = weighted.reduce((sum, [value, weight]) => sum + value * weight, 0) / Math.max(1, weightTotal) * 100;
    const score = Math.round(rawScore);
    const evidenceLevel: EvidenceLevel = group.filter(q => q.attempts.some(a => a.mode === 'practice' && Date.parse(a.answeredAt) >= start)).length >= 5 && repeatAttempts.length >= 10 ? '较强' : group.filter(q => q.attempts.some(a => a.mode === 'practice' && Date.parse(a.answeredAt) >= start)).length >= 2 && repeatAttempts.length >= 4 ? '中等' : '待观察';
    const trend = getTrend(repeatAttempts);
    const status: WeaknessStatus = evidenceLevel === '待观察'
      ? '待观察'
      : trend === 'improving' && score < 70
        ? '正在改善'
        : score >= 70
          ? '优先加强'
          : score >= 45
            ? '尚不稳定'
            : '趋于掌握';
    const moduleName = group[0]?.module || '';
    const topic = group[0]?.topic || '';
    const localAdvice = [
      topCause ? causeAdvice[topCause] || causeAdvice.其他 : '先完成一轮白题复习，并在模糊时补充个人错因。',
      repeatAttempts.length < 2 ? '当前复刷证据不足，先用本题组完成 2 次独立回忆后再判断。' : '优先重做错过或仍然模糊的证据题，连续 3 题正确后再拉长复习间隔。',
    ];
    return {
      key, module: moduleName, topic, score, evidenceLevel, status, questionCount: group.length,
      attemptCount: periodAttempts.length, repeatAttemptCount: repeatAttempts.length,
      repeatAccuracy: repeatAttempts.length ? Math.round((1 - (repeatErrorRate || 0)) * 100) : undefined,
      fuzzyRate: fuzzyRate === undefined ? undefined : Math.round(fuzzyRate * 100),
      overdueCount, topCause, trend, questionIds: group.map((question) => question.id),
      evidence: group.map((question) => ({
        id: question.id,
        source: question.source,
        stem: question.stem.slice(0, 70),
        results: question.attempts.map((attempt) => attempt.correct),
        cause: question.attempts.at(-1)?.personalCause || question.attempts.at(-1)?.causeType,
      })),
      localAdvice,
    };
  }).sort((a, b) => {
    const evidenceOrder = { 较强: 2, 中等: 1, 待观察: 0 };
    return evidenceOrder[b.evidenceLevel] - evidenceOrder[a.evidenceLevel] || b.score - a.score;
  });
}

function smoothedRate(successes: number, total: number) { return (successes + 1) / (total + 2); }
function average(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function count(values: string[]) {
  const valuesMap = new Map<string, number>();
  values.forEach((value) => valuesMap.set(value, (valuesMap.get(value) || 0) + 1));
  return [...valuesMap.entries()].sort((a, b) => b[1] - a[1]);
}
function getTrend(attempts: Attempt[]): WeaknessDiagnosis['trend'] {
  if (attempts.length < 4) return 'unknown';
  const ordered = [...attempts].sort((a, b) => a.answeredAt.localeCompare(b.answeredAt));
  const split = Math.floor(ordered.length / 2);
  const older = ordered.slice(0, split);
  const newer = ordered.slice(split);
  const olderAccuracy = older.filter((attempt) => attempt.correct).length / older.length;
  const newerAccuracy = newer.filter((attempt) => attempt.correct).length / newer.length;
  if (newerAccuracy - olderAccuracy >= 0.2) return 'improving';
  if (olderAccuracy - newerAccuracy >= 0.2) return 'declining';
  return 'stable';
}
