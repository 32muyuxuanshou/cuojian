import { beforeEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({
  begin: vi.fn(),
  append: vi.fn(),
  finish: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'android' },
  registerPlugin: () => native,
}));
import { exportFile } from '../lib/file-export';
beforeEach(() => {
  vi.resetAllMocks();
  native.begin.mockResolvedValue({ id: 'export' });
  native.append.mockResolvedValue(undefined);
  native.finish.mockResolvedValue({ saved: true });
  native.cancel.mockResolvedValue(undefined);
});
it('Android备份按512KB分块传递，不使用不可靠的Blob下载', async () => {
  const bytes = new Uint8Array(1024 * 1024 + 3).fill(42);
  await exportFile(new Blob([bytes]), 'backup.cuojian.zip');
  expect(native.append).toHaveBeenCalledTimes(3);
  const transferred = native.append.mock.calls.reduce((total, [part]) => {
    expect(part.data.length).toBeLessThan(750000);
    return total + atob(part.data).length;
  }, 0);
  expect(transferred).toBe(bytes.length);
  expect(native.finish).toHaveBeenCalledWith({ id: 'export' });
  expect(native.cancel).toHaveBeenCalledTimes(1);
});
it('取消保存会清理临时分块并明确告知用户', async () => {
  native.finish.mockResolvedValue({ saved: false });
  await expect(exportFile(new Blob(['data']), 'backup.zip')).rejects.toThrow(
    '取消',
  );
  expect(native.cancel).toHaveBeenCalledTimes(1);
});
it('分块失败也清理临时文件，不能显示导出成功', async () => {
  native.append.mockRejectedValue(new Error('space'));
  await expect(exportFile(new Blob(['data']), 'backup.zip')).rejects.toThrow(
    'space',
  );
  expect(native.finish).not.toHaveBeenCalled();
  expect(native.cancel).toHaveBeenCalledTimes(1);
});
