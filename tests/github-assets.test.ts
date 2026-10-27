import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { syncWithGithub } from '../lib/github-sync';
import { makeCapture } from '../lib/capture';
import { digest } from '../lib/bank-import';
import { getAsset, storeAssets } from '../lib/bank-db';
import { openDb } from '../lib/local-db';
afterEach(() => vi.unstubAllGlobals());
it('题库默认不上传；开启后加密同步图片，并在新设备恢复关联资产', async () => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  const remote = new Map<string, { content: string; sha: string }>();
  let revision = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options: RequestInit = {}) => {
      const path = new URL(url).pathname.split('/contents/')[1];
      if (options.method === 'PUT') {
        const body = JSON.parse(options.body as string);
        const sha = String(++revision);
        remote.set(path, { content: body.content, sha });
        return Response.json({ content: { sha } });
      }
      const file = remote.get(path);
      return file
        ? Response.json({ ...file, encoding: 'base64' })
        : new Response('{}', { status: 404 });
    }),
  );
  const bytes = new TextEncoder().encode('synthetic-image');
  const id = `asset-${await digest(bytes)}`;
  await storeAssets([
    {
      id,
      name: 'test.png',
      kind: 'image',
      blob: new Blob([bytes], { type: 'image/png' }),
    },
  ]);
  const question = {
    ...makeCapture('', 'sync-test'),
    inbox: false,
    collection: 'bank' as const,
    imageDataUrl: undefined,
    questionImageAssets: [id],
  };
  const settings = {
    owner: 'test',
    dataRepo: 'private',
    branch: 'main',
    token: 'test-token',
    passphrase: 'test-passphrase',
    autoSync: false,
  };
  expect((await syncWithGithub([question], settings)).uploaded).toBe(0);
  const enabled = { ...settings, includeBank: true };
  expect((await syncWithGithub([question], enabled)).uploaded).toBe(1);
  const encrypted = [...remote.entries()].find(([name]) =>
    name.endsWith('.enc.json'),
  )![1];
  expect(atob(encrypted.content)).not.toContain('synthetic-image');
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('assets', 'readwrite');
    tx.objectStore('assets').clear();
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
  storage.clear();
  const restored = await syncWithGithub([], enabled);
  expect(restored.downloaded).toBe(1);
  expect(restored.questions[0].questionImageAssets).toEqual([id]);
  expect(await (await getAsset(id))?.blob.text()).toBe('synthetic-image');
});
