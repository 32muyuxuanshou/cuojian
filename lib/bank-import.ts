import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import type { WrongQuestion, SharedMaterial } from './models';
import type { BankAsset, BankDraft } from './bank-db';

// oxlint-disable-next-line typescript/no-explicit-any -- Untrusted OOXML is normalized into typed Row/Sheet records below.
type Xml = Record<string, any>;
type Row = { number: number; cells: Record<string, string> };
type Sheet = {
  name: string;
  rows: Row[];
  images: { row: number; col: number; path: string }[];
};
const arr = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];
const decodeXml = (source: string) =>
  source.replace(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
    (original, name: string) => {
      if (name.startsWith('#')) {
        const code =
          name[1].toLowerCase() === 'x'
            ? parseInt(name.slice(2), 16)
            : Number(name.slice(1));
        return code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : original;
      }
      return (
        (
          { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<
            string,
            string
          >
        )[name] || original
      );
    },
  );
const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: false,
  entityDecoder: {
    decode: decodeXml,
    reset() {
      /* Stateless decoder. */
    },
    setExternalEntities() {
      /* External entities are rejected. */
    },
    addInputEntities() {
      /* DTDs are rejected before parsing. */
    },
    setXmlVersion() {
      /* OOXML uses XML 1.0. */
    },
  },
});
// oxlint-disable-next-line typescript/no-explicit-any -- Rich-text runs have variable OOXML shapes; only strings leave this function.
const text = (value: any): string =>
  value === undefined
    ? ''
    : typeof value !== 'object'
      ? String(value)
      : value.t !== undefined
        ? text(value.t)
        : value.r !== undefined
          ? arr(value.r).map(text).join('')
          : String(value['#text'] || '');

export async function digest(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    bytes.slice().buffer as ArrayBuffer,
  );
  return [...new Uint8Array(hash)]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
}
const hashText = (value: unknown) =>
  digest(new TextEncoder().encode(JSON.stringify(value)));
function pathFrom(owner: string, target: string) {
  const parts: string[] = target.startsWith('/')
    ? []
    : owner.split('/').slice(0, -1);
  for (const part of target.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}
function xml(files: Record<string, Uint8Array>, path: string): Xml {
  if (!files[path]) return {};
  const source = strFromU8(files[path]);
  if (/<!DOCTYPE|<!ENTITY/i.test(source))
    throw new Error('文件包含不支持的 XML 实体定义。');
  return parser.parse(source);
}
function relationships(files: Record<string, Uint8Array>, owner: string) {
  const parts = owner.split('/');
  const name = parts.pop();
  const rel = xml(files, [...parts, '_rels', `${name}.rels`].join('/'));
  return new Map<string, string>(
    arr<Xml>(rel.Relationships?.Relationship)
      .filter((r) => r['@_TargetMode'] !== 'External')
      .map((r) => [r['@_Id'], pathFrom(owner, r['@_Target'])]),
  );
}
export function readWorkbook(bytes: Uint8Array): {
  sheets: Sheet[];
  files: Record<string, Uint8Array>;
} {
  let expanded = 0;
  const files = unzipSync(bytes, {
    filter(entry) {
      expanded += entry.originalSize;
      if (
        entry.originalSize > 120 * 1024 * 1024 ||
        expanded > 512 * 1024 * 1024
      )
        throw new Error('解压后的题库过大，请拆分文件。');
      return /^xl\/(?:workbook\.xml|_rels\/|worksheets\/|drawings\/|media\/|sharedStrings\.xml)/.test(
        entry.name,
      );
    },
  });
  const strings = arr<Xml>(xml(files, 'xl/sharedStrings.xml').sst?.si).map(
    text,
  );
  const workbookRels = relationships(files, 'xl/workbook.xml');
  const sheets = arr<Xml>(
    xml(files, 'xl/workbook.xml').workbook?.sheets?.sheet,
  ).map((sheet) => {
    const owner = workbookRels.get(sheet['@_id']);
    if (!owner) throw new Error('无法读取 Excel 工作表关系。');
    const root = xml(files, owner).worksheet;
    const rows: Row[] = arr<Xml>(root?.sheetData?.row)
      .map((row) => {
        const cells: Record<string, string> = {};
        for (const c of arr<Xml>(row.c)) {
          const value =
            c['@_t'] === 's'
              ? strings[Number(c.v)]
              : c['@_t'] === 'inlineStr'
                ? text(c.is)
                : text(c.v);
          if (value?.trim()) cells[String(c['@_r']).replace(/\d/g, '')] = value;
        }
        return { number: Number(row['@_r']), cells };
      })
      .filter((row) => Object.keys(row.cells).length);
    const rels = relationships(files, owner);
    const images: Sheet['images'] = [];
    for (const drawing of arr<Xml>(root?.drawing)) {
      const path = rels.get(drawing['@_id']);
      if (!path) continue;
      const refs = relationships(files, path);
      const rootDrawing = xml(files, path).wsDr;
      for (const anchor of [
        ...arr<Xml>(rootDrawing?.twoCellAnchor),
        ...arr<Xml>(rootDrawing?.oneCellAnchor),
      ]) {
        const ref = anchor.pic?.blipFill?.blip?.['@_embed'];
        const imagePath = refs.get(ref);
        if (imagePath && files[imagePath])
          images.push({
            row: Number(anchor.from?.row) + 1,
            col: Number(anchor.from?.col),
            path: imagePath,
          });
      }
    }
    return { name: String(sheet['@_name']), rows, images };
  });
  return { sheets, files };
}

export function pageNumbers(value: string) {
  const nums = (value.split(/[（(]?PDF/i)[0].match(/\d+/g) || []).map(Number);
  return nums.length === 2 && nums[1] > nums[0] && nums[1] - nums[0] < 20
    ? Array.from({ length: nums[1] - nums[0] + 1 }, (_, i) => nums[0] + i)
    : nums;
}

export async function parseQuestionBank(
  file: { name: string; arrayBuffer(): Promise<ArrayBuffer> },
  onProgress?: (message: string) => void,
): Promise<BankDraft> {
  onProgress?.('正在本机读取文字与内嵌图片…');
  const { sheets, files } = readWorkbook(
    new Uint8Array(await file.arrayBuffer()),
  );
  const sheet = sheets.find((s) => ['题库', '题目'].includes(s.name));
  if (!sheet)
    throw new Error('未找到“题库”或“题目”工作表，请使用约定的题库表头。');
  const header = sheet.rows.find(
    (r) =>
      Object.values(r.cells).includes('题干') ||
      Object.values(r.cells).includes('提问') ||
      Object.values(r.cells).includes('问题'),
  );
  if (!header) throw new Error('没有识别到题目表头。');
  const data = sheet.rows.filter((r) => r.number > header.number);
  const isData = Object.values(header.cells).includes('材料编号');
  const isReasoning = Object.values(header.cells).includes('原卷笔迹记录');
  const isLanguage = Object.values(header.cells).includes('手写作答');
  if (!isData && !isReasoning && !isLanguage)
    throw new Error('当前支持判断推理、言语理解、资料分析三种题库模板。');
  const questionModule = isData
    ? '资料分析'
    : isReasoning
      ? '判断推理'
      : '言语理解';
  const now = new Date().toISOString();
  const batchId = crypto.randomUUID();
  const assets = new Map<string, BankAsset>();
  const imageIds = new Map<string, string>();
  const relevant = new Set(
    sheets
      .filter((s) => s === sheet || s.name === '原卷核对')
      .flatMap((s) => s.images.map((i) => i.path)),
  );
  for (const path of relevant) {
    const bytes = files[path];
    const id = `asset-${await digest(bytes)}`;
    imageIds.set(path, id);
    const ext = path.split('.').pop()?.toLowerCase();
    const type =
      ext === 'png'
        ? 'image/png'
        : ext === 'webp'
          ? 'image/webp'
          : 'image/jpeg';
    if (!assets.has(id))
      assets.set(id, {
        id,
        blob: new Blob([bytes.slice().buffer as ArrayBuffer], { type }),
        name: path.split('/').pop()!,
        kind: 'image',
      });
  }
  const at = (row: number, col?: number) =>
    sheet.images
      .filter((i) => i.row === row && (col === undefined || i.col === col))
      .map((i) => imageIds.get(i.path)!);
  const originals = new Map<string, string[]>();
  const originalSheet = sheets.find((s) => s.name === '原卷核对');
  if (originalSheet) {
    const labels = originalSheet.rows.filter((r) =>
      /^\d+$/.test(r.cells.A || ''),
    );
    for (const label of labels) {
      const next =
        labels.find((r) => r.number > label.number)?.number || Infinity;
      originals.set(
        label.cells.A,
        originalSheet.images
          .filter((i) => i.row >= label.number && i.row < next)
          .map((i) => imageIds.get(i.path)!),
      );
    }
  }
  const materialMap = new Map<string, SharedMaterial>();
  const issues: string[] = [];
  const questions: WrongQuestion[] = [];
  for (const row of data) {
    const c = row.cells;
    const section = isData ? c.A : c.B;
    const number = isData ? c.B : c.C;
    if (!section || !number) {
      issues.push(`第${row.number}行缺少套题或题号，未导入。`);
      continue;
    }
    const rawMaterial = isData
      ? c.D || ''
      : isReasoning
        ? c.F || ''
        : c.F || '';
    const currentImages = at(row.number, isData ? 4 : 5);
    const perQuestionMaterial =
      isData && /(?:本题|选项).*(?:饼图|小图|折线图|见图)/.test(rawMaterial);
    let material: SharedMaterial | undefined;
    if (isData || rawMaterial) {
      const key = `${section}|${isData ? c.C || number : number}`;
      material = materialMap.get(key);
      if (!material) {
        material = {
          id: `material-${await hashText([questionModule, file.name, key])}`,
          title: `${section} · ${isData ? c.C || '公共资料' : '阅读材料'}`,
          text: '',
          images: [],
          imageAssets: [],
          updatedAt: now,
        };
        materialMap.set(key, material);
      }
      if (rawMaterial && !perQuestionMaterial && !material.text)
        material.text = rawMaterial;
      if (isData && !perQuestionMaterial)
        material.imageAssets = [
          ...new Set([...(material.imageAssets || []), ...currentImages]),
        ];
    }
    const optionColumns = isData ? ['G', 'H', 'I', 'J'] : ['H', 'I', 'J', 'K'];
    const options: Record<string, string> = {};
    const optionImageAssets: Record<string, string[]> = {};
    optionColumns.forEach((col, i) => {
      const letter = String.fromCharCode(65 + i);
      const images = at(row.number, (isData ? 6 : 7) + i);
      options[letter] = c[col] || (images.length ? '' : '');
      if (images.length) optionImageAssets[letter] = images;
    });
    const stem =
      (isData ? c.F : c.G) || (rawMaterial ? '' : '请根据题图作答。');
    const rawAnswer = (isData ? c.K : c.L) || '';
    const notes = (isData ? c.L : c.M) || '';
    const answerCandidate = /^[A-D]$/.test(rawAnswer.trim())
      ? rawAnswer.trim()
      : /^([A-D])(?:[（(\s，,：:]|$)/.exec(rawAnswer)?.[1] || '';
    const printedPages = pageNumbers((isData ? c.M : c.N) || '');
    const rowIssues: string[] = [];
    if (
      /待核|待确认|未标注|不明确|无法|B、C/.test(rawAnswer) ||
      /【待核】/.test(notes)
    )
      rowIssues.push('原卷答案、笔迹或数据存在疑点，请核对。');
    if (!answerCandidate) rowIssues.push('没有明确的参考答案。');
    if (!stem && !rawMaterial && !currentImages.length)
      rowIssues.push('题干缺失。');
    const mixed =
      isData &&
      section === '套题训练6' &&
      ['18', '19', '20'].includes(number) &&
      /卫星|商业航天/.test(stem);
    if (mixed)
      rowIssues.push(
        '疑似串题：套题6医疗IPO题组混入套题7商业航天内容，核对前暂停练习。',
      );
    const questionImages = isReasoning
      ? currentImages
      : perQuestionMaterial
        ? currentImages
        : [];
    const fingerprint = await hashText([
      questionModule,
      section,
      number,
      stem,
      options,
      rawMaterial,
      questionImages,
      optionImageAssets,
    ]);
    const q: WrongQuestion = {
      id: `bank-${fingerprint}`,
      collection: 'bank',
      responseType: 'single',
      createdAt: now,
      capturedAt: now,
      updatedAt: now,
      source: isData
        ? '四海公考 · 资料分析'
        : c.E || file.name.replace(/\.xlsx$/i, ''),
      sourceVerified: false,
      stem,
      options,
      correctAnswer: '',
      answerConfirmed: false,
      suggestedAnswer: answerCandidate || undefined,
      answerSource: 'document',
      originalChoice:
        isLanguage || isData ? answerCandidate || undefined : undefined,
      originalAnswer: rawAnswer,
      answerEvidence: rawAnswer,
      extractedNotes: notes,
      module: questionModule,
      topic: isData ? '资料分析综合' : c.D || '待分类',
      tags: isData ? [] : (c.D || '').split(/[·｜|]/).filter(Boolean),
      status: 'learning',
      reviewLevel: 0,
      nextReviewAt: now,
      attempts: [],
      material,
      subquestionNumber: number,
      questionImageAssets: questionImages,
      optionImageAssets,
      originalImageAssets: originals.get(c.A) || [],
      imageContainsHints:
        questionImages.length > 0 ||
        !!material?.imageAssets?.length ||
        Object.keys(optionImageAssets).length > 0,
      reviewIssues: rowIssues,
      contentNeedsReview: mixed,
      provenance: {
        batchId,
        workbook: file.name,
        sheet: sheet.name,
        row: row.number,
        section,
        number,
        fingerprint,
        printedPages,
        pdfPages: printedPages.map((p) => p + 2),
      },
    };
    questions.push(q);
  }
  // All children use the final material snapshot, including material found on a later row.
  if (isData) {
    const sections = new Map<string, WrongQuestion[]>();
    for (const q of questions) {
      const key = q.provenance!.section;
      sections.set(key, [...(sections.get(key) || []), q]);
    }
    for (const [section, group] of sections) {
      const numbers = new Set(group.map((q) => Number(q.subquestionNumber)));
      const expected = section.startsWith('套题训练')
        ? 20
        : Math.max(...numbers);
      const missing = Array.from({ length: expected }, (_, i) => i + 1).filter(
        (n) => !numbers.has(n),
      );
      if (missing.length)
        issues.push(
          `${section}：尚缺第${missing.join('、')}题，需要对照原卷补录。`,
        );
    }
    issues.push('页码暂按“印刷页码＋2”定位；绑定原卷后可逐题校正。');
  }
  if (questions.some((q) => q.imageContainsHints))
    issues.push('部分图片保留原卷笔迹：练习时会提示，作答不计入无提示正确率。');
  const flagged = questions.filter((q) => q.reviewIssues?.length).length;
  if (flagged) issues.push(`${flagged}条记录需要核对答案或题面。`);
  onProgress?.(
    `已读取 ${questions.length} 道题、${assets.size} 个独立图片文件。`,
  );
  return {
    id: batchId,
    name: file.name,
    questions,
    assets: [...assets.values()],
    issues,
  };
}

export async function bindSourcePdf(
  draft: BankDraft,
  file: File,
  offset = 2,
): Promise<BankDraft> {
  const data = new Uint8Array(await file.arrayBuffer());
  if (String.fromCharCode(...data.slice(0, 5)) !== '%PDF-')
    throw new Error('所选文件不是有效的 PDF。');
  const id = `asset-${await digest(data)}`;
  return {
    ...draft,
    assets: [
      ...draft.assets.filter((a) => a.id !== id),
      { id, blob: file, name: file.name, kind: 'pdf' },
    ],
    questions: draft.questions.map((q) => ({
      ...q,
      pdfSource: {
        name: file.name,
        pages: (q.provenance?.printedPages || []).map((p) => p + offset),
      },
      provenance: q.provenance
        ? {
            ...q.provenance,
            sourcePdfId: id,
            pdfPages: q.provenance.printedPages?.map((p) => p + offset),
          }
        : undefined,
    })),
  };
}
