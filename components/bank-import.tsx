'use client';
/* oxlint-disable next/no-img-element -- Local import preview. */
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
  X,
} from 'lucide-react';
import { Button } from './ui/button';
import { parseQuestionBank, bindSourcePdf } from '@/lib/bank-import';
import {
  commitBankImport,
  listBankImports,
  rollbackBankImport,
  type BankDraft,
  type BankImportRecord,
} from '@/lib/bank-db';
import {
  createPortableBackup,
  readPortableBackup,
} from '@/lib/portable-backup';
import { exportFile } from '@/lib/file-export';

export const downloadBlob = exportFile;

export function BankImport({
  onBack,
  onSaved,
}: {
  onBack: () => void;
  onSaved: () => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [drafts, setDrafts] = useState<BankDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmAnswers, setConfirmAnswers] = useState(false);
  const [history, setHistory] = useState<BankImportRecord[]>([]);
  useEffect(() => {
    void listBankImports().then(setHistory);
  }, []);
  async function read(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setMessage('');
    setDrafts([]);
    try {
      const next: BankDraft[] = [];
      for (const file of Array.from(files)) {
        setMessage(`正在读取 ${file.name}…`);
        await new Promise((resolve) => setTimeout(resolve, 30));
        next.push(
          /\.xlsx$/i.test(file.name)
            ? await parseQuestionBank(file, setMessage)
            : await readPortableBackup(file),
        );
      }
      setDrafts(next);
      setMessage('预览已准备好，尚未写入题库。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取失败');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }
  async function bind(index: number, file?: File) {
    if (!file) return;
    setBusy(true);
    setMessage('正在绑定本机原卷，无需调用 AI…');
    try {
      const next = await bindSourcePdf(drafts[index], file);
      setDrafts((old) => old.map((d, i) => (i === index ? next : d)));
      setMessage('原卷已加入预览，导入后可离线查看。');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '绑定失败');
    } finally {
      setBusy(false);
    }
  }
  function combined(): BankDraft {
    const assets = new Map(
      drafts.flatMap((d) => d.assets).map((a) => [a.id, a]),
    );
    return {
      id: crypto.randomUUID(),
      name: drafts.map((d) => d.name).join('、'),
      assets: [...assets.values()],
      issues: drafts.flatMap((d) => d.issues),
      questions: drafts
        .flatMap((d) => d.questions)
        .map((q) =>
          confirmAnswers &&
          q.suggestedAnswer &&
          !q.reviewIssues?.length &&
          !q.contentNeedsReview
            ? {
                ...q,
                correctAnswer: q.suggestedAnswer,
                answerConfirmed: true,
                answerSource: 'user' as const,
              }
            : q,
        ),
    };
  }
  async function commit() {
    setBusy(true);
    setMessage('正在整批保存题目、图片与原卷…');
    try {
      await navigator.storage?.persist?.();
      const result = await commitBankImport(combined());
      localStorage.setItem('cuojian_initialized', 'true');
      setMessage(
        `已导入 ${result.questionIds.length} 道题，跳过 ${result.skipped} 道重复题。`,
      );
      setDrafts([]);
      setHistory(await listBankImports());
      await onSaved();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '导入失败');
    } finally {
      setBusy(false);
    }
  }
  async function exportDraft() {
    setBusy(true);
    setMessage('正在生成含图片与原卷的离线题库包…');
    try {
      const draft = combined();
      await downloadBlob(
        await createPortableBackup(draft.questions, draft.assets, draft.issues),
        '错见-离线题库.cuojian.zip',
      );
      setMessage('题库包已生成，可传到平板后在此导入。');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '生成失败');
    } finally {
      setBusy(false);
    }
  }
  const count = drafts.reduce((sum, d) => sum + d.questions.length, 0);
  return (
    <div className="mx-auto max-w-6xl">
      <Button variant="ghost" onClick={onBack}>
        <ArrowLeft />
        返回题库
      </Button>
      <header className="mt-5">
        <p className="text-xs font-semibold text-primary">本地导入</p>
        <h1 className="mt-2 text-3xl font-semibold">把现成的题，放进题库</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          选择 Excel
          或错见离线题库包。文字、图片和资料题组直接读取；原卷可一并保存在本机。
        </p>
      </header>
      <input
        aria-label="选择Excel或离线题库包"
        ref={input}
        hidden
        type="file"
        multiple
        accept=".xlsx,.zip"
        onChange={(e) => void read(e.target.files)}
      />
      <button
        disabled={busy}
        onClick={() => input.current?.click()}
        className="mt-7 flex min-h-40 w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-primary/35 bg-blue-50/50 p-6 text-primary"
      >
        <FileSpreadsheet className="size-8" />
        <strong>选择 Excel / 离线题库包</strong>
        <span className="text-xs text-muted-foreground">
          支持多文件，读取完成后预览并确认
        </span>
      </button>
      {message && (
        <output
          className={`mt-4 flex items-center gap-2 rounded-lg border p-4 text-sm ${busy ? 'bg-blue-50' : 'bg-card'}`}
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {message}
        </output>
      )}
      <div className="mt-6 space-y-5">
        {drafts.map((draft, index) => (
          <section key={draft.id} className="rounded-xl border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">{draft.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {draft.questions.length} 道题 ·{' '}
                  {
                    new Set(
                      draft.questions
                        .map((q) => q.material?.id)
                        .filter(Boolean),
                    ).size
                  }{' '}
                  份材料 ·{' '}
                  {draft.assets.filter((a) => a.kind === 'image').length} 张图片
                </p>
              </div>
              <Button
                variant="ghost"
                aria-label={`移除${draft.name}`}
                disabled={busy}
                onClick={() =>
                  setDrafts((old) => old.filter((d) => d.id !== draft.id))
                }
              >
                <X />
              </Button>
            </div>
            {draft.issues.length > 0 && (
              <ul className="mt-4 space-y-2 rounded-lg bg-amber-50 p-4 text-xs leading-6 text-amber-900">
                {draft.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {new Set(
                draft.questions
                  .map((q) => q.provenance?.workbook)
                  .filter(Boolean),
              ).size <= 1 && (
                <label className="cursor-pointer rounded-lg border px-3 py-2 text-sm">
                  <Upload className="mr-2 inline size-4" />
                  绑定对应原 PDF
                  <input
                    aria-label={`绑定${draft.name}原卷`}
                    disabled={busy}
                    hidden
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => void bind(index, e.target.files?.[0])}
                  />
                </label>
              )}
              <span className="text-xs text-muted-foreground">
                {draft.assets
                  .filter((a) => a.kind === 'pdf')
                  .map((a) => a.name)
                  .join('、') || '可选；支持整本原卷，不调用 AI'}
              </span>
            </div>
            <details className="mt-4 rounded-lg border p-3">
              <summary className="cursor-pointer text-sm">
                查看题目预览与待核对记录
              </summary>
              <div className="mt-4 space-y-4">
                {draft.questions
                  .filter((q) => q.reviewIssues?.length)
                  .slice(0, 8)
                  .map((q) => (
                    <p key={q.id} className="text-xs leading-6 text-amber-800">
                      {q.provenance?.section} 第{q.subquestionNumber}题：
                      {q.reviewIssues?.join('；')}
                    </p>
                  ))}
                {draft.questions.slice(0, 3).map((q) => (
                  <article key={q.id} className="border-t pt-4">
                    <p className="text-xs text-muted-foreground">
                      {q.provenance?.section} · 第{q.subquestionNumber}题 ·{' '}
                      {q.topic}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-7">
                      {q.material?.text || q.stem}
                    </p>
                    {q.material?.text && (
                      <p className="mt-3 text-sm">{q.stem}</p>
                    )}
                    <DraftImage
                      asset={draft.assets.find(
                        (a) =>
                          a.id === q.questionImageAssets?.[0] ||
                          a.id === q.material?.imageAssets?.[0],
                      )}
                    />
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {Object.entries(q.options).map(([key, value]) => (
                        <p className="rounded border p-2 text-xs" key={key}>
                          {key}　{value || '图片选项'}
                        </p>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      原卷答案：{q.originalAnswer || '无'} · 尚无新增作答记录
                    </p>
                  </article>
                ))}
              </div>
            </details>
          </section>
        ))}
      </div>
      {count > 0 && (
        <section className="sticky bottom-20 z-10 mt-5 rounded-xl border bg-white p-4 shadow-sm lg:bottom-5">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={confirmAnswers}
              onChange={(e) => setConfirmAnswers(e.target.checked)}
            />
            <span>
              我已核对，采用没有疑点的原卷答案作为参考答案
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                默认保留待确认；有冲突、待核或串题的记录始终保留疑点。
              </span>
            </span>
          </label>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button disabled={busy} onClick={() => void commit()}>
              <Check />
              确认导入 {count} 道题
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void exportDraft()}
            >
              <Download />
              生成平板离线题库包
            </Button>
          </div>
        </section>
      )}
      <section className="mt-8">
        <h2 className="font-semibold">导入记录</h2>
        {!history.length && (
          <p className="mt-3 text-sm text-muted-foreground">还没有导入记录。</p>
        )}
        {history.map((item) => (
          <div
            key={item.id}
            className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{item.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {new Date(item.importedAt).toLocaleString('zh-CN')} · 新增{' '}
                {item.questionIds.length} 道 · 跳过 {item.skipped} 道
              </p>
            </div>
            <Button
              variant="outline"
              disabled={busy || !!item.rolledBackAt}
              onClick={async () => {
                if (
                  !confirm(
                    '撤销本次导入？导入后已作答、追问或修改过的题会保留。',
                  )
                )
                  return;
                try {
                  await rollbackBankImport(item.id);
                  setHistory(await listBankImports());
                  await onSaved();
                  setMessage('已撤销；保留之后已使用或修改过的题。');
                } catch (e) {
                  setMessage(e instanceof Error ? e.message : '撤销失败');
                }
              }}
            >
              {item.rolledBackAt ? '已撤销' : '撤销本次导入'}
            </Button>
          </div>
        ))}
      </section>
    </div>
  );
}

function DraftImage({ asset }: { asset?: BankDraft['assets'][number] }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!asset) return;
    const value = URL.createObjectURL(asset.blob);
    queueMicrotask(() => setUrl(value));
    return () => URL.revokeObjectURL(value);
  }, [asset]);
  return url ? (
    <img
      src={url}
      alt="题库原图预览"
      className="mt-3 max-h-72 w-full rounded-lg bg-white object-contain"
    />
  ) : null;
}
