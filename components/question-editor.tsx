'use client';
/* oxlint-disable next/no-img-element -- User supplied offline images. */
import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ImagePlus,
  Loader2,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { AssetImage, OriginalEvidence } from './question-content';
import { MaterialView } from './material-set';
import { digest, pageNumbers } from '@/lib/bank-import';
import { storeAssets, type BankAsset } from '@/lib/bank-db';
import { saveIfUnchanged, saveQuestion } from '@/lib/local-db';
import { resolvedQuestionImages, questionContext } from '@/lib/materials';
import { requestDeepSeek } from '@/lib/deepseek-client';
import { gradeAnswer } from '@/lib/question-engine';
import {
  causeTypes,
  modules,
  type AiAnalysis,
  type AiSettings,
  type WrongQuestion,
} from '@/lib/models';

const control = 'h-11 w-full rounded-lg border bg-white px-3 text-sm';
export function QuestionEditor({
  initialQuestion,
  settings,
  onCancel,
  onSaved,
}: {
  initialQuestion?: WrongQuestion;
  settings: AiSettings;
  onCancel: () => void;
  onSaved: (q: WrongQuestion) => void;
}) {
  const initial = initialQuestion;
  const now = new Date().toISOString();
  const [q, setQ] = useState<WrongQuestion>(
    () =>
      initial || {
        id: crypto.randomUUID(),
        createdAt: now,
        capturedAt: now,
        updatedAt: now,
        source: '',
        sourceVerified: false,
        stem: '',
        options: { A: '', B: '', C: '', D: '' },
        correctAnswer: '',
        answerConfirmed: false,
        answerSource: 'user',
        module: '',
        topic: '',
        tags: [],
        status: 'learning',
        reviewLevel: 0,
        nextReviewAt: now,
        attempts: [],
        collection: 'wrong',
        responseType: 'single',
      },
  );
  const [tags, setTags] = useState(q.tags.join('、'));
  const [myAnswer, setMyAnswer] = useState('');
  const [cause, setCause] = useState(
    q.causeType || q.attempts.at(-1)?.causeType || '',
  );
  const [personalCause, setPersonalCause] = useState(
    q.personalCause || q.attempts.at(-1)?.personalCause || '',
  );
  const [staged, setStaged] = useState<BankAsset[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const change = <K extends keyof WrongQuestion>(
    key: K,
    value: WrongQuestion[K],
  ) => setQ((old) => ({ ...old, [key]: value }));
  async function upload(file: File | undefined, option?: string) {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      setMessage('请选择 PNG、JPG 或 WebP 图片。');
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setMessage('图片请控制在12MB以内。');
      return;
    }
    const id = `asset-${await digest(new Uint8Array(await file.arrayBuffer()))}`;
    setStaged((old) => [
      ...old.filter((a) => a.id !== id),
      { id, name: file.name, kind: 'image', blob: file },
    ]);
    setQ((old) =>
      option
        ? {
            ...old,
            optionImageAssets: {
              ...old.optionImageAssets,
              [option]: [...(old.optionImageAssets?.[option] || []), id],
            },
          }
        : {
            ...old,
            questionImageAssets: [...(old.questionImageAssets || []), id],
          },
    );
  }
  async function ai(action: 'classify' | 'analyze') {
    if (!settings.apiKey) {
      setMessage('请先在设置中填写 API Key。');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await storeAssets(staged);
      const images = await resolvedQuestionImages(q);
      const result = await requestDeepSeek<
        Partial<AiAnalysis> & {
          stem?: string;
          options?: Record<string, string>;
          module?: string;
          topic?: string;
          detectedSource?: string;
          tags?: string[];
        }
      >({
        ...settings,
        action,
        imageDataUrls: images.map((i) => i.dataUrl),
        question: {
          ...questionContext(q),
          stem: q.stem,
          options: q.options,
          correctAnswer: q.answerConfirmed ? q.correctAnswer : '',
          suggestedAnswer: q.originalAnswer || q.suggestedAnswer,
          module: q.module,
          topic: q.topic,
          personalCause,
          imageRoles: images.map((i) => i.role),
        },
      });
      if (action === 'classify') {
        setQ((old) => ({
          ...old,
          stem: result.stem || old.stem,
          options: result.options || old.options,
          module: result.module || old.module,
          topic: result.topic || old.topic,
          source: old.source || result.detectedSource || '',
          sourceVerified: false,
        }));
        if (Array.isArray(result.tags)) setTags(result.tags.join('、'));
      } else
        setQ((old) => ({
          ...old,
          analysis: result as AiAnalysis,
          correctReasoning: result.correctReasoning || old.correctReasoning,
          pitfall: result.pitfall || old.pitfall,
        }));
      setMessage('AI 草稿已填入，请核对后保存；参考答案和个人错因由你确认。');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'AI 请求失败');
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (
      !q.stem.trim() &&
      !q.imageDataUrl &&
      !q.questionImageAssets?.length &&
      !q.material?.text
    ) {
      setMessage('请填写题干、材料或题目图片。');
      return;
    }
    if (
      (q.responseType || 'single') === 'single' &&
      q.answerConfirmed &&
      q.correctAnswer &&
      !Object.hasOwn(q.options, q.correctAnswer.trim().toUpperCase())
    ) {
      setMessage('单选题的答案应对应一个已有选项；多选请先切换作答方式。');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const changed =
        initial &&
        JSON.stringify([
          initial.stem,
          initial.options,
          initial.correctAnswer,
          initial.questionImageAssets,
          initial.optionImageAssets,
          initial.responseType,
        ]) !==
          JSON.stringify([
            q.stem,
            q.options,
            q.correctAnswer,
            q.questionImageAssets,
            q.optionImageAssets,
            q.responseType,
          ]);
      const updatedAt = new Date().toISOString();
      let next: WrongQuestion = {
        ...q,
        personalCause: personalCause.trim() || undefined,
        causeType: cause || undefined,
        source: q.source.trim() || '未填写来源',
        stem: q.stem.trim(),
        module: q.module || '待分类',
        topic: q.topic || '待分类',
        tags: [
          ...new Set(
            tags
              .split(/[、,，]/)
              .map((t) => t.trim())
              .filter(Boolean),
          ),
        ],
        updatedAt,
        inbox:
          initial?.collection === 'bank'
            ? false
            : q.inbox && !q.correctAnswer
              ? true
              : false,
        answerSource: q.answerConfirmed ? 'user' : q.answerSource,
        analysisStale: changed ? true : q.analysisStale,
        reviewLevel:
          initial?.correctAnswer !== q.correctAnswer ? 0 : q.reviewLevel,
        status:
          initial?.correctAnswer !== q.correctAnswer ? 'learning' : q.status,
      };
      if (myAnswer.trim()) {
        const correct = gradeAnswer(next, myAnswer);
        next = {
          ...next,
          collection: correct === false ? 'wrong' : next.collection,
          attempts: [
            ...next.attempts,
            {
              id: crypto.randomUUID(),
              answeredAt: updatedAt,
              answer: myAnswer.trim(),
              correct: correct === true,
              graded: correct !== undefined,
              referenceAnswer: next.answerConfirmed
                ? next.correctAnswer
                : undefined,
              mode: 'initial',
              causeType: cause || undefined,
              personalCause: personalCause.trim() || undefined,
            },
          ],
        };
      }
      if (changed && initial?.correctAnswer !== next.correctAnswer)
        next.attempts = next.attempts.map((a) =>
          a.answeredAt !== updatedAt ? { ...a, graded: false } : a,
        );
      await storeAssets(staged);
      if (initial) {
        if (!(await saveIfUnchanged(next, initial.updatedAt)))
          throw new Error('本题已在其他位置修改，请重新打开后编辑。');
      } else await saveQuestion(next);
      onSaved(next);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }
  const choices =
    (q.responseType || 'single') === 'single' || q.responseType === 'multiple';
  return (
    <div className="mx-auto max-w-6xl">
      <Button variant="ghost" onClick={onCancel}>
        <ArrowLeft />
        返回
      </Button>
      <h1 className="mt-5 text-2xl font-semibold">
        {initial ? '编辑题目' : '收录一道题'}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        题面、参考答案和历史笔迹分别保存，原有作答与会话保留。
      </p>
      <div className="mt-6 grid gap-5 xl:grid-cols-[.9fr_1.1fr]">
        <section className="space-y-5">
          <MaterialView material={q.material} />
          <div className="rounded-xl border bg-white p-5">
            <h2 className="font-semibold">题图</h2>
            {q.imageDataUrl && (
              <div className="mt-3">
                <img
                  src={q.imageDataUrl}
                  alt="题目原图"
                  className="max-h-96 w-full object-contain"
                />
                <Button
                  variant="ghost"
                  onClick={() => change('imageDataUrl', undefined)}
                >
                  移除旧图
                </Button>
              </div>
            )}
            {q.questionImageAssets?.map((id) => (
              <div key={id} className="mt-3">
                <EditorAsset id={id} staged={staged} />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    change(
                      'questionImageAssets',
                      q.questionImageAssets?.filter((x) => x !== id),
                    )
                  }
                >
                  <X />
                  移除此图
                </Button>
              </div>
            ))}
            <label className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm">
              <ImagePlus className="size-4" />
              添加题图
              <input
                hidden
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => void upload(e.target.files?.[0])}
              />
            </label>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void ai('classify')}
              >
                <Sparkles />
                AI 识别归类
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void ai('analyze')}
              >
                <Sparkles />
                AI 生成解析草稿
              </Button>
            </div>
          </div>
          <OriginalEvidence question={q} />
        </section>
        <section className="space-y-5 rounded-xl border bg-white p-5 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <EditorField label="保存位置">
              <select
                className={control}
                value={q.collection || 'wrong'}
                onChange={(e) =>
                  change('collection', e.target.value as 'wrong' | 'bank')
                }
              >
                <option value="wrong">我的错题</option>
                <option value="bank">题库</option>
              </select>
            </EditorField>
            <EditorField label="作答方式">
              <select
                className={control}
                value={q.responseType || 'single'}
                onChange={(e) =>
                  change(
                    'responseType',
                    e.target.value as WrongQuestion['responseType'],
                  )
                }
              >
                <option value="single">单选</option>
                <option value="multiple">多选</option>
                <option value="blank">填空</option>
                <option value="subjective">主观题</option>
              </select>
            </EditorField>
          </div>
          <EditorField label="来源">
            <Input
              value={q.source}
              onChange={(e) => change('source', e.target.value)}
            />
          </EditorField>
          <EditorField label="题干">
            <Textarea
              className="min-h-32"
              value={q.stem}
              onChange={(e) => change('stem', e.target.value)}
            />
          </EditorField>
          {choices && (
            <div className="space-y-3">
              {Object.entries(q.options).map(([key, value]) => (
                <div key={key} className="rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{key}</span>
                    <Input
                      aria-label={`选项${key}`}
                      value={value}
                      onChange={(e) =>
                        change('options', {
                          ...q.options,
                          [key]: e.target.value,
                        })
                      }
                    />
                    <Button
                      aria-label={`删除选项${key}`}
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const options = { ...q.options };
                        delete options[key];
                        const images = { ...q.optionImageAssets };
                        delete images[key];
                        setQ((old) => ({
                          ...old,
                          options,
                          optionImageAssets: images,
                        }));
                      }}
                    >
                      <X />
                    </Button>
                  </div>
                  {q.optionImageAssets?.[key]?.map((id) => (
                    <div key={id} className="mt-2">
                      <EditorAsset id={id} staged={staged} />
                      <button
                        className="text-xs text-muted-foreground"
                        onClick={() =>
                          change('optionImageAssets', {
                            ...q.optionImageAssets,
                            [key]:
                              q.optionImageAssets?.[key]?.filter(
                                (x) => x !== id,
                              ) || [],
                          })
                        }
                      >
                        移除图片
                      </button>
                    </div>
                  ))}
                  <label className="mt-2 inline-block cursor-pointer text-xs text-primary">
                    添加选项图片
                    <input
                      hidden
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(e) => void upload(e.target.files?.[0], key)}
                    />
                  </label>
                </div>
              ))}
              <Button
                variant="outline"
                onClick={() => {
                  const next = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
                    .split('')
                    .find((k) => !(k in q.options));
                  if (next) change('options', { ...q.options, [next]: '' });
                }}
              >
                <Plus />
                添加选项
              </Button>
            </div>
          )}
          <EditorField label="参考答案（可以留空，多选用逗号分隔）">
            <Input
              value={q.correctAnswer}
              onChange={(e) =>
                setQ((old) => ({
                  ...old,
                  correctAnswer: e.target.value,
                  answerConfirmed: false,
                }))
              }
            />
          </EditorField>
          {q.suggestedAnswer && (
            <button
              className="text-xs text-primary"
              onClick={() =>
                setQ((old) => ({
                  ...old,
                  correctAnswer: old.suggestedAnswer || '',
                  answerConfirmed: false,
                }))
              }
            >
              填入原卷候选答案 {q.suggestedAnswer}
            </button>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!q.answerConfirmed}
              onChange={(e) => change('answerConfirmed', e.target.checked)}
            />
            我已核对参考答案
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <EditorField label="大模块">
              <Input
                list="editor-modules"
                value={q.module}
                onChange={(e) => change('module', e.target.value)}
              />
              <datalist id="editor-modules">
                {modules.slice(1).map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </datalist>
            </EditorField>
            <EditorField label="细分考点">
              <Input
                value={q.topic}
                onChange={(e) => change('topic', e.target.value)}
              />
            </EditorField>
          </div>
          <EditorField label="标签（逗号或顿号分隔）">
            <Input value={tags} onChange={(e) => setTags(e.target.value)} />
          </EditorField>
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm">
              补记作答与个人错因
            </summary>
            <div className="mt-3 space-y-3">
              <EditorField label="我的作答（留空不新增作答记录）">
                <Input
                  value={myAnswer}
                  onChange={(e) => setMyAnswer(e.target.value)}
                />
              </EditorField>
              <EditorField label="错因类型">
                <select
                  className={control}
                  value={cause}
                  onChange={(e) => setCause(e.target.value)}
                >
                  <option value="">暂未确认</option>
                  {causeTypes.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </EditorField>
              <EditorField label="具体个人错因">
                <Textarea
                  value={personalCause}
                  onChange={(e) => setPersonalCause(e.target.value)}
                />
              </EditorField>
            </div>
          </details>
          <EditorField label="正确思路 / 解析">
            <Textarea
              className="min-h-32"
              value={q.correctReasoning || ''}
              onChange={(e) => change('correctReasoning', e.target.value)}
            />
          </EditorField>
          <div className="space-y-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm">
              <ImagePlus className="size-4" />
              上传解析图片
              <input
                hidden
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  if (file.size > 12 * 1024 * 1024) {
                    setMessage('解析图请控制在12MB以内。');
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = () => {
                    if (typeof reader.result === 'string')
                      change('answerAnalysisImageDataUrl', reader.result);
                  };
                  reader.readAsDataURL(file);
                }}
              />
            </label>
            {q.answerAnalysisImageDataUrl && (
              <>
                <img
                  src={q.answerAnalysisImageDataUrl}
                  alt="解析图片"
                  className="max-h-80 w-full rounded-lg object-contain"
                />
                <Button
                  variant="ghost"
                  onClick={() =>
                    change('answerAnalysisImageDataUrl', undefined)
                  }
                >
                  移除解析图片
                </Button>
              </>
            )}
          </div>
          <EditorField label="避坑提醒">
            <Textarea
              value={q.pitfall || ''}
              onChange={(e) => change('pitfall', e.target.value)}
            />
          </EditorField>
          {q.provenance && (
            <EditorField label="原 PDF 实际页码（可纠正定位）">
              <Input
                value={q.provenance.pdfPages?.join('、') || ''}
                onChange={(e) =>
                  change('provenance', {
                    ...q.provenance!,
                    pdfPages: pageNumbers(e.target.value),
                  })
                }
              />
            </EditorField>
          )}
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={!!q.imageContainsHints}
              onChange={(e) => change('imageContainsHints', e.target.checked)}
            />
            <span>
              题图含笔迹或答案提示
              <span className="mt-1 block text-xs text-muted-foreground">
                核对图中没有提示后可取消；含提示的作答不会进入无提示正确率。
              </span>
            </span>
          </label>
          {!!q.reviewIssues?.length && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                onChange={(e) => {
                  if (e.target.checked) change('reviewIssues', []);
                }}
              />
              我已逐项核对原卷疑点，清除待核对提醒
            </label>
          )}
          {q.contentNeedsReview && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                onChange={(e) => {
                  if (e.target.checked)
                    setQ((old) => ({
                      ...old,
                      contentNeedsReview: false,
                      reviewIssues: [],
                    }));
                }}
              />
              我已对照原卷修正串题 / 缺失内容，恢复练习
            </label>
          )}
          {message && (
            <output className="rounded-lg bg-blue-50 p-3 text-sm leading-6">
              {message}
            </output>
          )}
          <div className="flex justify-end gap-3 border-t pt-5">
            <Button variant="outline" onClick={onCancel}>
              取消
            </Button>
            <Button disabled={busy} onClick={() => void save()}>
              {busy ? <Loader2 className="animate-spin" /> : <Check />}保存
              {initial ? '修改' : '题目'}
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}

function EditorField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-2 text-sm">
      <span className="block font-medium">{label}</span>
      {children}
    </label>
  );
}
function EditorAsset({ id, staged }: { id: string; staged: BankAsset[] }) {
  const asset = staged.find((a) => a.id === id);
  return asset ? <StagedImage blob={asset.blob} /> : <AssetImage id={id} />;
}
function StagedImage({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const value = URL.createObjectURL(blob);
    queueMicrotask(() => setUrl(value));
    return () => URL.revokeObjectURL(value);
  }, [blob]);
  return url ? (
    <img
      src={url}
      alt="待保存图片"
      className="max-h-80 w-full object-contain"
    />
  ) : null;
}
