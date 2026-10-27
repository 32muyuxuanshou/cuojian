import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { assetIds, getAsset, type BankAsset, type BankDraft } from './bank-db';
import { validateBackup } from './backup';
import { digest } from './bank-import';
import type { WrongQuestion } from './models';

export async function createPortableBackup(
  questions: WrongQuestion[],
  assets?: BankAsset[],
  notes: string[] = [],
) {
  const required = [...new Set(questions.flatMap(assetIds))];
  const available = assets ? new Map(assets.map((a) => [a.id, a])) : undefined;
  const entries: Record<string, Uint8Array> = {};
  const metadata: Omit<BankAsset, 'blob'>[] = [];
  for (const id of required) {
    const asset = available ? available.get(id) : await getAsset(id);
    if (!asset)
      throw new Error('缺少本地图片或原卷，请先重新绑定原文件再导出完整备份。');
    entries[`assets/${id}`] = new Uint8Array(await asset.blob.arrayBuffer());
    metadata.push({ id, name: asset.name, kind: asset.kind });
  }
  entries['manifest.json'] = strToU8(
    JSON.stringify({
      format: 'cuojian-bank',
      version: 1,
      exportedAt: new Date().toISOString(),
      questions,
      notes,
      assets: metadata,
    }),
  );
  return new Blob([zipSync(entries, { level: 0 }).buffer as ArrayBuffer], {
    type: 'application/zip',
  });
}

export async function readPortableBackup(file: {
  name: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}): Promise<BankDraft> {
  let total = 0;
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter(entry) {
      total += entry.originalSize;
      if (total > 800 * 1024 * 1024)
        throw new Error('备份包过大，请分批导入。');
      return (
        entry.name === 'manifest.json' ||
        /^assets\/asset-[a-f0-9]{64}$/.test(entry.name)
      );
    },
  });
  if (!files['manifest.json']) throw new Error('没有找到错见备份清单。');
  const data = JSON.parse(strFromU8(files['manifest.json']));
  if (
    data.format !== 'cuojian-bank' ||
    data.version !== 1 ||
    !Array.isArray(data.assets)
  )
    throw new Error('不支持的备份版本。');
  const questions = validateBackup(data);
  const assets: BankAsset[] = [];
  for (const item of data.assets) {
    if (
      !item ||
      typeof item.id !== 'string' ||
      !/^asset-[a-f0-9]{64}$/.test(item.id) ||
      typeof item.name !== 'string' ||
      !['image', 'pdf'].includes(item.kind)
    )
      throw new Error('备份资产信息损坏。');
    const bytes = files[`assets/${item.id}`];
    if (!bytes || `asset-${await digest(bytes)}` !== item.id)
      throw new Error('图片或原卷校验失败，备份未导入。');
    const type =
      item.kind === 'pdf'
        ? 'application/pdf'
        : bytes[0] === 0x89
          ? 'image/png'
          : bytes[0] === 0x52
            ? 'image/webp'
            : 'image/jpeg';
    assets.push({
      ...item,
      blob: new Blob([bytes.slice().buffer as ArrayBuffer], { type }),
    });
  }
  const found = new Set(assets.map((a) => a.id));
  if (questions.flatMap(assetIds).some((id) => !found.has(id)))
    throw new Error('备份包缺少题目引用的图片或 PDF，未导入。');
  return {
    id: crypto.randomUUID(),
    name: file.name,
    questions,
    assets,
    issues: [
      ...(Array.isArray(data.notes)
        ? data.notes.filter(
            (note: unknown): note is string => typeof note === 'string',
          )
        : []),
      '已校验文字、图片与原卷。重复题目会跳过，不会覆盖本机作答与修改。',
    ],
  };
}

export async function blobDataUrl(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:${blob.type};base64,${btoa(text)}`;
}
