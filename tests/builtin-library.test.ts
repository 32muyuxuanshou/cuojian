import 'fake-indexeddb/auto';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import {
  installBuiltinLibrary,
  validateBuiltinManifest,
} from '../lib/builtin-library';
import { createPortableBackup } from '../lib/portable-backup';
import { digest } from '../lib/bank-import';
import { makeCapture } from '../lib/capture';
import {
  listQuestions,
  saveQuestion,
  replaceAllQuestions,
  trashQuestions,
} from '../lib/local-db';
import { listBankImports } from '../lib/bank-db';
import { loadAiSettings } from '../lib/ai-settings';
import { DEEPSEEK_MODEL } from '../lib/deepseek-client-config';
import { confirmDocumentAnswers } from '../lib/confirm-answers';
const q = () => ({
  ...makeCapture('', crypto.randomUUID()),
  inbox: false,
  collection: 'bank' as const,
  imageDataUrl: undefined,
  options: { A: '甲', B: '乙' },
  answerSource: 'document' as const,
  suggestedAnswer: 'A',
});
async function bundle(question = q()) {
  const blob = await createPortableBackup([question], []);
  const bytes = await blob.arrayBuffer();
  return {
    question,
    bytes,
    manifest: {
      id: 'builtin-' + crypto.randomUUID(),
      title: '内置测试题库',
      file: 'test.cuojian.zip',
      sha256: await digest(new Uint8Array(bytes)),
      bytes: bytes.byteLength,
      questions: 1,
    },
  };
}
beforeEach(() => replaceAllQuestions([]));
describe('首次启动内置题库', () => {
  it('并发启动只加载一次，保留已录题目，入库后不会重复载入', async () => {
    const value = await bundle();
    const local = q();
    await saveQuestion(local);
    const load = vi.fn(async () => value.bytes);
    const [a, b] = await Promise.all([
      installBuiltinLibrary(value.manifest, load),
      installBuiltinLibrary(value.manifest, load),
    ]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(a?.id).toBe(b?.id);
    expect(await listQuestions()).toHaveLength(2);
    expect(await installBuiltinLibrary(value.manifest, load)).toBeUndefined();
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('跳过已有题目的修改和历史，删除后不会在下次启动复活', async () => {
    const value = await bundle();
    await saveQuestion({ ...value.question, stem: '本机修改' });
    const result = await installBuiltinLibrary(
      value.manifest,
      async () => value.bytes,
    );
    expect(result?.skipped).toBe(1);
    expect((await listQuestions())[0].stem).toBe('本机修改');
    await trashQuestions([value.question.id]);
    await installBuiltinLibrary(value.manifest, async () => {
      throw new Error('不能重复读取');
    });
    expect(await listQuestions()).toHaveLength(0);
  });
  it('校验失败不改动数据，也不记为导入成功', async () => {
    const value = await bundle();
    const local = q();
    await saveQuestion(local);
    await expect(
      installBuiltinLibrary(
        { ...value.manifest, sha256: '0'.repeat(64) },
        async () => value.bytes,
      ),
    ).rejects.toThrow('校验失败');
    expect(await listQuestions()).toHaveLength(1);
    expect(
      (await listBankImports()).some((r) => r.id === value.manifest.id),
    ).toBe(false);
    expect(() =>
      validateBuiltinManifest({ ...value.manifest, file: '../private.zip' }),
    ).toThrow();
  });
});
it('旧Flash别名固定迁移到1017，保留密钥和思考模式及自定义服务', () => {
  const old = {
    provider: 'deepseek',
    baseUrl: 'https://api.lingxiaihub.com',
    apiKey: 'stored-test-key',
    model: 'deepseek-v4.1-flash',
    thinkingMode: 'max',
  };
  const migrated = loadAiSettings({ getItem: () => JSON.stringify(old) });
  expect(DEEPSEEK_MODEL).toBe('deepseek-v4.1-flash-1017');
  expect(migrated.model).toBe(DEEPSEEK_MODEL);
  expect(migrated.apiKey).toBe(old.apiKey);
  expect(migrated.thinkingMode).toBe('max');
  expect(
    loadAiSettings({
      getItem: () =>
        JSON.stringify({
          ...old,
          baseUrl: 'https://custom.example',
          model: 'custom-model',
        }),
    }).model,
  ).toBe('custom-model');
});
it('批量确认只处理明确、未修改的原卷候选，不伪造作答', async () => {
  const ready = q();
  const uncertain = { ...q(), reviewIssues: ['答案有疑点'] };
  const edited = q();
  const confirmed = { ...q(), correctAnswer: 'B', answerConfirmed: true };
  for (const value of [ready, uncertain, edited, confirmed])
    await saveQuestion(value);
  await saveQuestion({
    ...edited,
    stem: '已在其他位置修改',
    updatedAt: '2099-01-01T00:00:00Z',
  });
  expect(
    await confirmDocumentAnswers([ready, uncertain, edited, confirmed]),
  ).toBe(1);
  const saved = (await listQuestions()).find((x) => x.id === ready.id)!;
  expect(saved.correctAnswer).toBe('A');
  expect(saved.answerConfirmed).toBe(true);
  expect(saved.attempts).toEqual([]);
  expect(
    (await listQuestions()).find((x) => x.id === confirmed.id)?.correctAnswer,
  ).toBe('B');
});
