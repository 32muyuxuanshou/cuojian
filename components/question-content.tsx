'use client';
/* oxlint-disable next/no-img-element -- Offline Blob assets. */
import { useEffect, useState } from 'react';
import { X, ZoomIn, FileText } from 'lucide-react';
import { getAsset } from '@/lib/bank-db';
import type { WrongQuestion } from '@/lib/models';

export function AssetImage({
  id,
  alt = '题目图片',
  className = '',
}: {
  id: string;
  alt?: string;
  className?: string;
}) {
  const [url, setUrl] = useState('');
  const [zoom, setZoom] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    let objectUrl = '';
    void getAsset(id)
      .then((asset) => {
        if (!alive) return;
        if (!asset) {
          setError(true);
          return;
        }
        objectUrl = URL.createObjectURL(asset.blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);
  useEffect(() => {
    if (!zoom) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setZoom(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [zoom]);
  if (error)
    return (
      <p className="rounded-lg border p-3 text-sm text-muted-foreground">
        图片暂不可用，请导入完整题库包。
      </p>
    );
  if (!url)
    return (
      <div
        className="h-24 animate-pulse rounded-lg bg-muted"
        aria-label="正在读取本地图片"
      />
    );
  return (
    <>
      <button
        type="button"
        className={`group relative block w-full cursor-zoom-in bg-white ${className}`}
        onClick={(event) => {
          event.stopPropagation();
          setZoom(true);
        }}
        aria-label={`放大${alt}`}
      >
        <img
          src={url}
          alt={alt}
          className="max-h-[560px] w-full rounded-lg object-contain"
        />
        <ZoomIn className="absolute bottom-2 right-2 size-5 rounded bg-white/90 text-slate-500" />
      </button>
      {zoom && (
        <dialog
          open
          aria-modal="true"
          aria-label={alt}
          className="fixed inset-0 z-50 m-0 h-screen max-h-none w-screen max-w-none overflow-auto bg-slate-950/90 p-4"
        >
          <button
            className="fixed right-5 top-5 z-10 rounded-full bg-white p-3 text-slate-900"
            aria-label="关闭大图"
            onClick={() => setZoom(false)}
          >
            <X />
          </button>
          <img
            src={url}
            alt={alt}
            className="mx-auto min-h-0 max-w-none bg-white lg:max-w-[90vw]"
          />
        </dialog>
      )}
    </>
  );
}

export function QuestionImages({ question }: { question: WrongQuestion }) {
  return (
    <div className="space-y-3">
      {question.imageDataUrl && (
        <img
          src={question.imageDataUrl}
          alt="题目原图"
          className="max-h-[520px] w-full rounded-lg bg-white object-contain"
        />
      )}
      {question.questionImageAssets?.map((id) => (
        <AssetImage key={id} id={id} alt="题图" />
      ))}
      {question.extraImages
        ?.filter((i) => i.role !== 'analysis')
        .map((i) => (
          <img
            key={i.id}
            src={i.dataUrl}
            alt="题目续图"
            className="max-h-[520px] w-full object-contain"
          />
        ))}
    </div>
  );
}

export function AnswerInput({
  question,
  value,
  onChange,
  disabled = false,
}: {
  question: WrongQuestion;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const type = question.responseType || 'single';
  if (type === 'blank' || type === 'subjective')
    return (
      <textarea
        aria-label={type === 'blank' ? '填写答案' : '主观作答'}
        className="mt-5 min-h-28 w-full rounded-xl border bg-white p-4 text-base outline-none focus:border-primary"
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={type === 'blank' ? '填写你的答案…' : '写下你的思路或答案…'}
      />
    );
  const selected =
    type === 'multiple' ? value.split(',').filter(Boolean) : [value];
  return (
    <fieldset
      className="mt-6 grid min-w-0 gap-3"
      aria-label={type === 'multiple' ? '多选题选项' : '单选题选项'}
    >
      {Object.entries(question.options).map(([key, label]) => (
        <div
          key={key}
          className={`answer-option rounded-xl border bg-card ${selected.includes(key) ? 'border-primary bg-blue-50 ring-1 ring-primary/10' : ''}`}
        >
          <button
            type="button"
            disabled={disabled}
            aria-pressed={selected.includes(key)}
            className="flex min-h-14 w-full items-start gap-3 px-4 py-3 text-left disabled:cursor-default"
            onClick={() =>
              onChange(
                type === 'multiple'
                  ? (selected.includes(key)
                      ? selected.filter((x) => x !== key)
                      : [...selected, key]
                    )
                      .sort()
                      .join(',')
                  : key,
              )
            }
          >
            <span
              className={`grid size-8 shrink-0 place-items-center border text-sm font-semibold ${type === 'multiple' ? 'rounded-md' : 'rounded-full'} ${selected.includes(key) ? 'border-primary bg-primary text-white' : ''}`}
            >
              {key}
            </span>
            <span className="pt-1 text-[15px] leading-6">
              {label ||
                (question.optionImageAssets?.[key]?.length
                  ? '点击选择此图'
                  : `选项 ${key}`)}
            </span>
          </button>
          {question.optionImageAssets?.[key]?.length &&
          question.questionImageAssets?.length ? (
            <details className="px-4 pb-3">
              <summary className="cursor-pointer text-xs text-primary">
                查看 {key} 选项分图
              </summary>
              {question.optionImageAssets[key].map((id) => (
                <AssetImage key={id} id={id} alt={`选项${key}`} />
              ))}
            </details>
          ) : (
            question.optionImageAssets?.[key]?.map((id) => (
              <div key={id} className="px-4 pb-3">
                <AssetImage id={id} alt={`选项${key}`} />
              </div>
            ))
          )}
        </div>
      ))}
    </fieldset>
  );
}

export function OriginalEvidence({
  question,
  reveal = true,
}: {
  question: WrongQuestion;
  reveal?: boolean;
}) {
  const [pdfUrl, setPdfUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(
    () => () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    },
    [pdfUrl],
  );
  async function open() {
    const id = question.provenance?.sourcePdfId;
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const asset = await getAsset(id);
      if (!asset)
        throw new Error('本机没有原卷，请导入完整题库包或重新绑定 PDF。');
      const url = URL.createObjectURL(asset.blob);
      setPdfUrl(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取原卷失败');
    } finally {
      setLoading(false);
    }
  }
  if (!reveal) return null;
  const pages = question.provenance?.pdfPages || [];
  return (
    <details className="mt-5 rounded-xl border bg-slate-50 p-4">
      <summary className="cursor-pointer text-sm font-medium">
        原卷、笔迹与答案依据
      </summary>
      <div className="mt-3 space-y-3 text-sm leading-7">
        {question.provenance && (
          <p className="text-xs text-muted-foreground">
            {question.provenance.workbook} · {question.provenance.section} · 第
            {question.provenance.number}题 ·{' '}
            {question.provenance.row > 0
              ? `Excel第${question.provenance.row}行`
              : '原卷补录'}
            {pages.length ? ` · PDF第${pages.join('、')}页` : ''}
          </p>
        )}
        {question.originalChoice && (
          <p>原卷作答：{question.originalChoice}（历史笔迹，不计作本次成绩）</p>
        )}
        {question.originalAnswer && (
          <p>原卷答案记录：{question.originalAnswer}</p>
        )}
        {question.extractedNotes && (
          <p className="whitespace-pre-wrap">{question.extractedNotes}</p>
        )}
        {question.reviewIssues?.map((issue) => (
          <p key={issue} className="text-amber-700">
            {issue}
          </p>
        ))}
        {question.originalImageAssets?.map((id) => (
          <AssetImage key={id} id={id} alt="带笔迹原卷" />
        ))}
        {question.provenance?.sourcePdfId && (
          <button
            type="button"
            className="flex items-center gap-2 text-primary"
            onClick={() => void open()}
            disabled={loading}
          >
            <FileText className="size-4" />
            {loading ? '正在读取原卷…' : '查看 PDF 原页（包含笔迹）'}
          </button>
        )}
        {error && <p className="text-amber-700">{error}</p>}
        {pdfUrl && (
          <PdfPageViewer
            url={pdfUrl}
            initialPage={pages[0] || 1}
            onClose={() => {
              URL.revokeObjectURL(pdfUrl);
              setPdfUrl('');
            }}
          />
        )}
      </div>
    </details>
  );
}

function PdfPageViewer({
  url,
  initialPage,
  onClose,
}: {
  url: string;
  initialPage: number;
  onClose: () => void;
}) {
  const [page, setPage] = useState(initialPage);
  const [image, setImage] = useState('');
  const [max, setMax] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    let task: import('pdfjs-dist').PDFDocumentLoadingTask | undefined;
    queueMicrotask(() => setImage(''));
    void (async () => {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = (
        await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
      ).default;
      task = pdfjs.getDocument({ url });
      const pdf = await task.promise;
      if (!alive) return;
      setMax(pdf.numPages);
      const sheet = await pdf.getPage(
        Math.max(1, Math.min(page, pdf.numPages)),
      );
      const viewport = sheet.getViewport({
        scale: Math.min(2, 1600 / sheet.getViewport({ scale: 1 }).width),
      });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await sheet.render({ canvas, viewport }).promise;
      if (alive) setImage(canvas.toDataURL('image/png'));
    })().catch(() => {
      if (alive) setError('原页渲染失败，请检查 PDF 是否完整。');
    });
    return () => {
      alive = false;
      void task?.destroy();
    };
  }, [page, url]);
  return (
    <dialog
      open
      aria-modal="true"
      aria-label="查看原卷"
      className="fixed inset-0 z-50 m-0 h-screen max-h-none w-screen max-w-none overflow-auto bg-slate-900/95 p-4"
    >
      <div className="sticky top-0 mx-auto mb-4 flex max-w-4xl items-center gap-3 rounded-xl bg-white p-3">
        <button onClick={onClose} aria-label="关闭原卷">
          <X />
        </button>
        <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          上一页
        </button>
        <span>
          第 {page} / {max || '…'} 页
        </span>
        <button
          disabled={max > 0 && page >= max}
          onClick={() => setPage((p) => p + 1)}
        >
          下一页
        </button>
      </div>
      {image ? (
        <img
          className="mx-auto max-w-full bg-white"
          src={image}
          alt={`原卷第${page}页`}
        />
      ) : (
        <p className="text-center text-white">{error || '正在读取原卷…'}</p>
      )}
    </dialog>
  );
}
