import type { GithubSyncSettings, WrongQuestion } from './models';

const INDEX_PATH = 'data/index.json';
const LAST_HASHES_KEY = 'cuojian_sync_hashes';
const TOMBSTONES_KEY = 'cuojian_sync_tombstones';

type SyncEntry = { path: string; updatedAt: string; hash: string; blobSha?: string; deletedAt?: string };
type SyncIndex = { schemaVersion: 1; updatedAt: string; records: Record<string, SyncEntry> };
type GithubFile = { content?: string; encoding?: string; sha: string };
type EncryptedEnvelope = { version: 1; algorithm: 'AES-GCM'; iterations: number; salt: string; iv: string; data: string };

export type SyncConflict = { id: string; local: WrongQuestion; cloud: WrongQuestion; cloudHash: string; detectedAt: string };
export type SyncResult = { questions: WrongQuestion[]; uploaded: number; downloaded: number; conflicts: number; syncedAt: string };

export function rememberDeletion(id: string, deletedAt = new Date().toISOString()) {
  const tombstones = readJson<Record<string, string>>(TOMBSTONES_KEY, {});
  tombstones[id] = deletedAt;
  localStorage.setItem(TOMBSTONES_KEY, JSON.stringify(tombstones));
}

export function listSyncConflicts() {
  return readJson<SyncConflict[]>('cuojian_sync_conflicts', []);
}

export function resolveSyncConflict(id: string, choice: 'local' | 'cloud') {
  const conflicts = listSyncConflicts();
  const conflict = conflicts.find((item) => item.id === id);
  if (!conflict) return undefined;
  const chosen = choice === 'local'
    ? { ...mergeAppendOnly(conflict.local, conflict.cloud), updatedAt: new Date().toISOString() }
    : mergeAppendOnly(conflict.cloud, conflict.local);
  localStorage.setItem('cuojian_sync_conflicts', JSON.stringify(conflicts.filter((item) => item.id !== id)));
  const hashes = readJson<Record<string, string>>(LAST_HASHES_KEY, {});
  delete hashes[id];
  localStorage.setItem(LAST_HASHES_KEY, JSON.stringify(hashes));
  return chosen;
}

export async function syncWithGithub(localQuestions: WrongQuestion[], settings: GithubSyncSettings): Promise<SyncResult> {
  validateSettings(settings);
  const remoteIndexFile = await getFile(settings, INDEX_PATH, true);
  const remoteIndex: SyncIndex = remoteIndexFile?.content
    ? JSON.parse(decodeText(remoteIndexFile.content)) as SyncIndex
    : { schemaVersion: 1, updatedAt: new Date(0).toISOString(), records: {} };
  const localMap = new Map(localQuestions.map((question) => [question.id, question]));
  const resultMap = new Map(localMap);
  const lastHashes = readJson<Record<string, string>>(LAST_HASHES_KEY, {});
  const tombstones = readJson<Record<string, string>>(TOMBSTONES_KEY, {});
  const nextHashes = { ...lastHashes };
  const conflicts: SyncConflict[] = [];
  let uploaded = 0;
  let downloaded = 0;
  let indexChanged = false;

  for (const [id, remoteEntry] of Object.entries(remoteIndex.records)) {
    const local = localMap.get(id);
    const deletedAt = later(tombstones[id], remoteEntry.deletedAt);
    if (deletedAt && (!local || deletedAt > local.updatedAt)) {
      resultMap.delete(id);
      remoteIndex.records[id] = { ...remoteEntry, deletedAt };
      indexChanged = indexChanged || deletedAt !== remoteEntry.deletedAt;
      delete nextHashes[id];
      continue;
    }
    if (!local && !remoteEntry.deletedAt) {
      const cloud = await downloadQuestion(settings, remoteEntry);
      resultMap.set(id, cloud); nextHashes[id] = remoteEntry.hash; downloaded += 1;
      continue;
    }
    if (!local) continue;
    const localHash = await hashQuestion(local);
    if (localHash === remoteEntry.hash) { nextHashes[id] = localHash; continue; }
    const cloud = await downloadQuestion(settings, remoteEntry);
    const baseHash = lastHashes[id];
    if (baseHash && baseHash !== localHash && baseHash !== remoteEntry.hash) {
      const merged = mergeAppendOnly(local.updatedAt >= cloud.updatedAt ? local : cloud, local.updatedAt >= cloud.updatedAt ? cloud : local);
      conflicts.push({ id, local, cloud, cloudHash: remoteEntry.hash, detectedAt: new Date().toISOString() });
      resultMap.set(id, merged);
      continue;
    }
    if (cloud.updatedAt > local.updatedAt) {
      const merged = mergeAppendOnly(cloud, local);
      const mergedHash = await hashQuestion(merged);
      if (mergedHash !== remoteEntry.hash) {
        const pushed = await uploadQuestion(settings, merged, remoteEntry);
        remoteIndex.records[id] = pushed; nextHashes[id] = pushed.hash; uploaded += 1; indexChanged = true;
      } else nextHashes[id] = remoteEntry.hash;
      resultMap.set(id, merged); downloaded += 1;
    } else {
      const merged = mergeAppendOnly(local, cloud);
      const pushed = await uploadQuestion(settings, merged, remoteEntry);
      remoteIndex.records[id] = pushed; nextHashes[id] = pushed.hash; resultMap.set(id, merged); uploaded += 1; indexChanged = true;
    }
  }

  for (const question of localQuestions) {
    if (remoteIndex.records[question.id] || tombstones[question.id]) continue;
    const pushed = await uploadQuestion(settings, question);
    remoteIndex.records[question.id] = pushed; nextHashes[question.id] = pushed.hash; uploaded += 1; indexChanged = true;
  }

  for (const [id, deletedAt] of Object.entries(tombstones)) {
    const existing = remoteIndex.records[id];
    if (!existing || !existing.deletedAt || deletedAt > existing.deletedAt) {
      remoteIndex.records[id] = { path: existing?.path || questionPath(id), updatedAt: existing?.updatedAt || deletedAt, hash: existing?.hash || '', blobSha: existing?.blobSha, deletedAt };
      indexChanged = true;
    }
    resultMap.delete(id); delete nextHashes[id];
  }

  if (conflicts.length) localStorage.setItem('cuojian_sync_conflicts', JSON.stringify(conflicts));
  else localStorage.removeItem('cuojian_sync_conflicts');
  const syncedAt = new Date().toISOString();
  if (indexChanged || !remoteIndexFile) {
    remoteIndex.updatedAt = syncedAt;
    await putFile(settings, INDEX_PATH, JSON.stringify(remoteIndex, null, 2), remoteIndexFile?.sha, `sync: ${uploaded} upload, ${downloaded} download`);
  }
  localStorage.setItem(LAST_HASHES_KEY, JSON.stringify(nextHashes));
  localStorage.setItem(TOMBSTONES_KEY, JSON.stringify({}));
  return { questions: [...resultMap.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), uploaded, downloaded, conflicts: conflicts.length, syncedAt };
}

async function uploadQuestion(settings: GithubSyncSettings, question: WrongQuestion, existing?: SyncEntry): Promise<SyncEntry> {
  const path = existing?.path || questionPath(question.id);
  const hash = await hashQuestion(question);
  const envelope = await encryptJson(question, settings.passphrase);
  const response = await putFile(settings, path, JSON.stringify(envelope), existing?.blobSha, `sync: update ${question.id}`);
  return { path, updatedAt: question.updatedAt, hash, blobSha: response.sha };
}

async function downloadQuestion(settings: GithubSyncSettings, entry: SyncEntry) {
  const file = await getFile(settings, entry.path);
  if (!file?.content) throw new Error(`云端题目文件缺失：${entry.path}`);
  const envelope = JSON.parse(decodeText(file.content)) as EncryptedEnvelope;
  return decryptJson<WrongQuestion>(envelope, settings.passphrase);
}

async function getFile(settings: GithubSyncSettings, path: string, allowMissing = false): Promise<GithubFile | undefined> {
  const response = await fetch(apiUrl(settings, path, true), { headers: githubHeaders(settings.token) });
  if (allowMissing && response.status === 404) return undefined;
  if (!response.ok) throw new Error(await githubError(response));
  return response.json() as Promise<GithubFile>;
}

async function putFile(settings: GithubSyncSettings, path: string, text: string, sha: string | undefined, message: string) {
  const response = await fetch(apiUrl(settings, path, false), {
    method: 'PUT', headers: githubHeaders(settings.token),
    body: JSON.stringify({ message, content: encodeText(text), branch: settings.branch, ...(sha ? { sha } : {}) }),
  });
  if (!response.ok) throw new Error(await githubError(response));
  const body = await response.json() as { content?: { sha?: string } };
  return { sha: body.content?.sha || '' };
}

function apiUrl(settings: GithubSyncSettings, path: string, includeRef: boolean) {
  const base = `https://api.github.com/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(settings.dataRepo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
  return includeRef ? `${base}?ref=${encodeURIComponent(settings.branch)}` : base;
}

function githubHeaders(token: string) {
  return { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' };
}

function questionPath(id: string) {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `data/questions/${safe.slice(0, 2) || '00'}/${safe}.enc.json`;
}

function mergeAppendOnly(primary: WrongQuestion, secondary: WrongQuestion): WrongQuestion {
  const attempts = unionById(primary.attempts, secondary.attempts).sort((a, b) => a.answeredAt.localeCompare(b.answeredAt));
  const conversationResetAt = [primary.conversationResetAt,secondary.conversationResetAt].filter((x):x is string=>!!x).sort((a,b)=>a.localeCompare(b)).at(-1);
  const conversation = unionById(primary.conversation || [], secondary.conversation || []).filter(m => !conversationResetAt || m.createdAt > conversationResetAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { ...primary, attempts, conversation, conversationResetAt };
}

function unionById<T extends { id: string }>(first: T[], second: T[]) {
  const map = new Map<string, T>();
  [...second, ...first].forEach((item) => map.set(item.id, item));
  return [...map.values()];
}

async function hashQuestion(question: WrongQuestion) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(question)));
  return bytesToHex(new Uint8Array(bytes));
}

async function encryptJson(value: unknown, passphrase: string): Promise<EncryptedEnvelope> {
  const iterations = 210_000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, iterations, ['encrypt']);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(value)));
  return { version: 1, algorithm: 'AES-GCM', iterations, salt: bytesToBase64(salt), iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(cipher)) };
}

async function decryptJson<T>(envelope: EncryptedEnvelope, passphrase: string): Promise<T> {
  try {
    const salt = base64ToBytes(envelope.salt);
    const iv = base64ToBytes(envelope.iv);
    const key = await deriveKey(passphrase, salt, envelope.iterations, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, base64ToBytes(envelope.data));
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch { throw new Error('云端数据无法解密，请检查同步口令。'); }
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number, usages: KeyUsage[]) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, usages);
}

function encodeText(text: string) { return bytesToBase64(new TextEncoder().encode(text)); }
function decodeText(base64: string) { return new TextDecoder().decode(base64ToBytes(base64.replace(/\n/g, ''))); }
function bytesToBase64(bytes: Uint8Array) { let value = ''; for (let i = 0; i < bytes.length; i += 0x8000) value += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(value); }
function base64ToBytes(value: string) { const binary = atob(value); return Uint8Array.from(binary, (character) => character.charCodeAt(0)); }
function bytesToHex(bytes: Uint8Array) { return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join(''); }
function readJson<T>(key: string, fallback: T): T { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } }
function later(first?: string, second?: string) { return !first ? second : !second ? first : first > second ? first : second; }
function validateSettings(settings: GithubSyncSettings) {
  if (!settings.owner || !settings.dataRepo || !settings.token || !settings.passphrase) throw new Error('请完整填写GitHub同步设置。');
  if (settings.passphrase.length < 8) throw new Error('同步加密口令至少需要8个字符。');
}
async function githubError(response: Response) {
  try { const body = await response.json() as { message?: string }; return `GitHub同步失败（${response.status}）：${body.message || '请求被拒绝'}`; }
  catch { return `GitHub同步失败（${response.status}）`; }
}
