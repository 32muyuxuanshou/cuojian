'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Loader2, Sparkles } from 'lucide-react';
import { Button } from './ui/button';
import { MaterialView } from './material-set';
import {
  AnswerInput,
  OriginalEvidence,
  QuestionImages,
} from './question-content';
import { listQuestions, saveIfUnchanged } from '@/lib/local-db';
import {
  gradeAnswer,
  practiceOrder,
  answerLabel,
  hasReliableAnswer,
} from '@/lib/question-engine';
import { requestDeepSeek } from '@/lib/deepseek-client';
import type {
  AiSettings,
  ReviewCelebrationInput,
  WrongQuestion,
} from '@/lib/models';

export function StudySession({
  mode,
  questions,
  settings,
  mastery,
  isTodaySession,
  onBack,
  onChanged,
}: {
  mode: 'practice' | 'review';
  questions: WrongQuestion[];
  settings: AiSettings;
  mastery: number;
  isTodaySession: boolean;
  onBack: () => void;
  onChanged: () => Promise<void>;
}) {
  const [queue] = useState(() =>
    mode === 'practice' ? practiceOrder(questions) : [...questions],
  );
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [results, setResults] = useState<
    Record<string, { correct?: boolean; answer: string; selfRating?: string }>
  >({});
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const started = useRef(Date.now());
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState('');
  const [celebration, setCelebration] = useState('');
  const [celebrating, setCelebrating] = useState(false);
  const celebrated = useRef(false);
  const question = queue[index];
  const result = question && results[question.id];
  const values = Object.values(results);
  const graded = values.filter((r) => r.correct !== undefined);
  const correct = graded.filter((r) => r.correct).length;
  useEffect(() => {
    if (!finished || !isTodaySession || celebrated.current) return;
    celebrated.current = true;
    const key = `cuojian_lamb_celebration_${new Intl.DateTimeFormat('en-CA').format(new Date())}`;
    const cached = localStorage.getItem(key);
    if (cached) {
      queueMicrotask(() => setCelebration(cached));
      return;
    }
    if (!settings.apiKey) {
      queueMicrotask(() =>
        setCelebration('今天的复盘已保存在本机；配置 AI 后可生成小羊寄语。'),
      );
      return;
    }
    const reviewResult: ReviewCelebrationInput = {
      mode,
      total: graded.length,
      correct: mode === 'practice' ? correct : 0,
      incorrect: mode === 'practice' ? graded.length - correct : 0,
      remembered: mode === 'review' ? correct : 0,
      fuzzy: mode === 'review' ? graded.length - correct : 0,
      mastery,
    };
    queueMicrotask(() => setCelebrating(true));
    void requestDeepSeek<{ message?: string }>({
      ...settings,
      action: 'celebrate',
      reviewResult,
      thinkingMode: 'disabled',
    })
      .then((r) => {
        if (!r.message) throw new Error('没有返回寄语');
        localStorage.setItem(key, r.message);
        setCelebration(r.message);
      })
      .catch(() =>
        setCelebration('本轮复盘已保存。小羊寄语暂未生成，稍后再试。'),
      )
      .finally(() => setCelebrating(false));
  }, [
    finished,
    isTodaySession,
    settings,
    mode,
    mastery,
    correct,
    graded.length,
  ]);

  async function record(rating?: 'mastered' | 'fuzzy' | 'unknown') {
    if (!question || guard.current || result) return;
    guard.current = true;
    setBusy(true);
    setError('');
    try {
      const current = (await listQuestions()).find((q) => q.id === question.id);
      if (!current || current.updatedAt !== question.updatedAt)
        throw new Error('题目在本轮期间已修改或删除，请退出后重新进入。');
      const ratingAnswer =
        rating === 'mastered'
          ? current.correctAnswer || '已想起'
          : rating === 'fuzzy'
            ? '有点模糊'
            : '未想起';
      const outcome =
        mode === 'practice'
          ? gradeAnswer(current, answer)
          : hasReliableAnswer(current) && !current.imageContainsHints
            ? rating === 'mastered'
            : undefined;
      const level =
        outcome === undefined
          ? current.reviewLevel
          : outcome
            ? Math.min(current.reviewLevel + 1, 5)
            : 0;
      const intervals = [1, 3, 7, 14, 30, 60];
      const now = new Date().toISOString();
      const next: WrongQuestion = {
        ...current,
        updatedAt: now,
        collection: outcome === false ? 'wrong' : current.collection,
        reviewLevel: level,
        status:
          outcome === undefined
            ? current.status
            : level >= 5
              ? 'mastered'
              : 'learning',
        nextReviewAt:
          outcome === undefined
            ? current.nextReviewAt
            : new Date(
                Date.now() + intervals[level] * 86_400_000,
              ).toISOString(),
        attempts: [
          ...current.attempts,
          {
            id: crypto.randomUUID(),
            answeredAt: now,
            answer: mode === 'practice' ? answer.trim() : ratingAnswer,
            correct: outcome === true,
            graded: outcome !== undefined,
            referenceAnswer: hasReliableAnswer(current)
              ? current.correctAnswer
              : undefined,
            mode,
            selfRating: rating,
            durationMs: Math.max(1000, Date.now() - started.current),
            revealedAnswer: mode === 'review' || !!current.imageContainsHints,
          },
        ],
      };
      if (!(await saveIfUnchanged(next, current.updatedAt)))
        throw new Error('本题刚刚发生变化，本次未写入，请重新进入练习。');
      // Keep the local snapshot current for revisiting a completed item.
      Object.assign(question, next);
      setResults((old) => ({
        ...old,
        [question.id]: {
          answer: mode === 'practice' ? answer.trim() : ratingAnswer,
          correct: outcome,
          selfRating: rating,
        },
      }));
      await onChanged();
      if (mode === 'review') advance();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败，请重试。');
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  function move(target: number) {
    if (busy || target < 0 || target >= queue.length) return;
    setIndex(target);
    setAnswer(results[queue[target].id]?.answer || '');
    setRevealed(!!results[queue[target].id]);
    setError('');
    started.current = Date.now();
  }
  function advance() {
    const remaining = queue.findIndex((q, i) => i !== index && !results[q.id]);
    // record() updates state asynchronously, so explicitly exclude the current item.
    if (remaining < 0) setFinished(true);
    else move(remaining);
  }
  if (!queue.length)
    return <Button onClick={onBack}>没有可练习的题，返回题库</Button>;
  if (finished)
    return (
      <div className="mx-auto max-w-2xl rounded-xl border bg-white p-8">
        <Sparkles className="size-8 text-primary" />
        <h1 className="mt-5 text-2xl font-semibold">本轮完成</h1>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          完成 {values.length} 道；
          {mode === 'practice'
            ? `已判分 ${graded.length} 道，答对 ${correct} 道`
            : `有效自评 ${graded.length} 道，已想起 ${correct} 道`}
          。
          {values.length > graded.length &&
            `另有 ${values.length - graded.length} 道未判分，已保留作答。`}
        </p>
        {isTodaySession && (
          <div className="mt-6 rounded-xl bg-blue-50 p-5">
            <p className="text-xs font-semibold text-primary">今日的小羊寄语</p>
            <p className="mt-3 leading-8">
              {celebrating ? <Loader2 className="animate-spin" /> : celebration}
            </p>
          </div>
        )}
        <Button className="mt-6" onClick={onBack}>
          返回
        </Button>
      </div>
    );
  const reveal = mode === 'review' ? revealed : !!result && revealed;
  return (
    <div className="study-workspace">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft />
          退出{mode === 'practice' ? '写题' : '复习'}
        </Button>
        <div className="rounded-lg border bg-white px-4 py-2 text-sm font-medium">
          {mode === 'practice' ? '写题模式 · 随机题组' : '复习模式 · 主动回忆'}
        </div>
        <span className="text-xs text-muted-foreground">
          已完成 {values.length} / {queue.length}
        </span>
      </header>
      <div className={`study-grid ${question.material ? 'has-material' : ''}`}>
        {question.material && (
          <aside className="study-material">
            <div className="study-panel-heading">公共资料</div>
            <div className="p-5">
              <MaterialView material={{ ...question.material, title: '' }} />
            </div>
          </aside>
        )}
        <section className="study-question">
          <div className="study-panel-heading flex flex-wrap items-center gap-2">
            <span className="mr-auto">
              第 {index + 1} 题 / 共 {queue.length} 题
            </span>
            <details className="relative text-sm font-normal">
              <summary className="cursor-pointer">题目列表</summary>
              <div className="absolute right-0 z-10 mt-3 grid max-h-72 w-64 grid-cols-5 gap-2 overflow-auto rounded-xl border bg-white p-3 shadow-lg">
                {queue.map((q, i) => (
                  <button
                    key={q.id}
                    onClick={() => move(i)}
                    className={`h-9 rounded-md border ${i === index ? 'bg-primary text-white' : results[q.id] ? 'bg-blue-50 text-primary' : ''}`}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            </details>
          </div>
          <div className="p-5 sm:p-7">
            {question.imageContainsHints && (
              <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-6 text-amber-800">
                题图可能含原卷笔迹，本题保留作答，不计入无提示正确率。
              </p>
            )}
            <QuestionImages question={question} />
            <p className="mt-4 whitespace-pre-wrap text-[17px] font-medium leading-8">
              {question.stem}
            </p>
            <AnswerInput
              question={question}
              value={answer}
              onChange={setAnswer}
              disabled={mode === 'review' || !!result || busy}
            />
            {error && (
              <p className="mt-4 text-sm text-red-700" role="alert">
                {error}
              </p>
            )}
            {mode === 'practice' && !result && (
              <Button
                className="mt-6 h-12 w-full"
                disabled={!answer.trim() || busy}
                onClick={() => void record()}
              >
                {busy && <Loader2 className="animate-spin" />}提交答案
              </Button>
            )}
            {mode === 'practice' && result && (
              <div className="mt-6 rounded-xl border bg-blue-50 p-4">
                <strong className="text-sm">
                  {result.correct === undefined
                    ? '作答已保存 · 未判分'
                    : result.correct
                      ? '回答正确'
                      : '回答错误 · 已加入错题'}
                </strong>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setRevealed(!revealed)}
                  >
                    {revealed ? '收起解析' : '查看答案与解析'}
                  </Button>
                  <Button onClick={advance}>
                    {values.length === queue.length ? '完成本轮' : '继续下一题'}
                    <ArrowRight />
                  </Button>
                </div>
              </div>
            )}
            {mode === 'review' && !revealed && (
              <Button
                className="mt-6 h-12 w-full"
                onClick={() => setRevealed(true)}
              >
                查看答案
              </Button>
            )}
            {reveal && (
              <div className="mt-6 space-y-4 border-t pt-5">
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>{question.module}</span>
                  <span>{question.topic}</span>
                  {question.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
                <p className="font-semibold">
                  参考答案：{answerLabel(question)}
                </p>
                {question.correctReasoning && (
                  <p className="whitespace-pre-wrap text-sm leading-7">
                    {question.correctReasoning}
                  </p>
                )}
                {question.analysis && (
                  <p className="whitespace-pre-wrap text-sm leading-7">
                    {question.analysis.correctReasoning}
                  </p>
                )}
                {question.pitfall && (
                  <p className="rounded-lg bg-slate-50 p-3 text-sm">
                    {question.pitfall}
                  </p>
                )}
                <OriginalEvidence question={question} />
                {mode === 'review' && !result && (
                  <div className="grid grid-cols-3 gap-2">
                    {(['unknown', 'fuzzy', 'mastered'] as const).map(
                      (rating, i) => (
                        <Button
                          key={rating}
                          disabled={busy}
                          variant={i === 2 ? 'default' : 'outline'}
                          onClick={() => void record(rating)}
                        >
                          {['仍然不会', '有点模糊', '已掌握'][i]}
                        </Button>
                      ),
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="mt-6 flex justify-between border-t pt-4">
              <Button
                variant="ghost"
                disabled={index === 0 || busy}
                onClick={() => move(index - 1)}
              >
                <ArrowLeft />
                上一题
              </Button>
              {index < queue.length - 1 && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => move(index + 1)}
                >
                  下一题
                  <ArrowRight />
                </Button>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
