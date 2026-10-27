import {
  commitBankImport,
  listBankImports,
  type BankImportRecord,
} from './bank-db';
import { readPortableBackup } from './portable-backup';
import { digest } from './bank-import';

export interface BuiltinLibraryManifest {
  id: string;
  title: string;
  file: string;
  sha256: string;
  bytes: number;
  questions: number;
}
const pending = new Map<string, Promise<BankImportRecord | undefined>>();

export function validateBuiltinManifest(
  value: unknown,
): BuiltinLibraryManifest {
  const data = value as Partial<BuiltinLibraryManifest> | null;
  if (
    !data ||
    typeof data.id !== 'string' ||
    !/^[\w-]+$/.test(data.id) ||
    typeof data.title !== 'string' ||
    typeof data.file !== 'string' ||
    !/^[\w.-]+\.zip$/.test(data.file) ||
    typeof data.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(data.sha256) ||
    !Number.isInteger(data.bytes) ||
    data.bytes! <= 0 ||
    data.bytes! > 800 * 1024 * 1024 ||
    !Number.isInteger(data.questions) ||
    data.questions! <= 0
  )
    throw new Error('内置题库清单无效。');
  return data as BuiltinLibraryManifest;
}

// Shared by strict-mode effects: download, validate and commit a personal bank once.
export function installBuiltinLibrary(
  manifest: BuiltinLibraryManifest,
  load: () => Promise<ArrayBuffer>,
  progress: (message: string) => void = () => {},
) {
  const existing = pending.get(manifest.id);
  if (existing) return existing;
  const work = (async () => {
    if ((await listBankImports()).some((record) => record.id === manifest.id))
      return undefined;
    progress('首次启动：正在读取内置题库和原卷…');
    const bytes = new Uint8Array(await load());
    if (
      bytes.byteLength !== manifest.bytes ||
      (await digest(bytes)) !== manifest.sha256
    )
      throw new Error('内置题库校验失败，已有学习数据未改动。');
    progress('正在校验题目、图片和原始资料…');
    const draft = await readPortableBackup({
      name: manifest.title,
      arrayBuffer: async () => bytes.buffer as ArrayBuffer,
    });
    if (draft.questions.length !== manifest.questions)
      throw new Error('内置题数与清单不一致，题库未导入。');
    if (typeof navigator !== 'undefined')
      await navigator.storage?.persist?.().catch(() => false);
    progress(`正在将 ${draft.questions.length} 道题保存到本机…`);
    return commitBankImport({
      ...draft,
      id: manifest.id,
      name: manifest.title,
    });
  })().finally(() => pending.delete(manifest.id));
  pending.set(manifest.id, work);
  return work;
}

export async function ensureBuiltinLibrary(
  progress?: (message: string) => void,
) {
  if (import.meta.env.VITE_BUILTIN_LIBRARY !== 'personal') return undefined;
  const response = await fetch('builtin-library/manifest.json');
  if (!response.ok)
    throw new Error('未找到内置题库；请使用含题库的个人安装包。');
  const manifest = validateBuiltinManifest(await response.json());
  return installBuiltinLibrary(
    manifest,
    async () => {
      // Keep the URL relative so Capacitor's original WebView fetch reads packaged assets.
      const bank = await fetch(`builtin-library/${manifest.file}`);
      if (!bank.ok) throw new Error('无法读取安装包内的个人题库。');
      return bank.arrayBuffer();
    },
    progress,
  );
}
