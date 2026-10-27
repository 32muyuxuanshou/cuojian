import { Capacitor, registerPlugin } from '@capacitor/core';
interface NativeExport {
  begin(options: { name: string }): Promise<{ id: string }>;
  append(options: { id: string; data: string }): Promise<void>;
  finish(options: { id: string }): Promise<{ saved: boolean }>;
  cancel(options: { id: string }): Promise<void>;
}
const native = registerPlugin<NativeExport>('NativeExport');
export async function exportFile(blob: Blob, name: string) {
  if (Capacitor.getPlatform() !== 'android') {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return;
  }
  if (blob.size > 800 * 1024 * 1024)
    throw new Error('备份超过800MB，请分批导出。');
  const { id } = await native.begin({ name });
  try {
    for (let offset = 0; offset < blob.size; offset += 512 * 1024) {
      const bytes = new Uint8Array(
        await blob.slice(offset, offset + 512 * 1024).arrayBuffer(),
      );
      let data = '';
      for (let i = 0; i < bytes.length; i += 8192)
        data += String.fromCharCode(...bytes.subarray(i, i + 8192));
      await native.append({ id, data: btoa(data) });
    }
    const result = await native.finish({ id });
    if (!result.saved) throw new Error('已取消导出，本机数据保留。');
  } finally {
    await native.cancel({ id }).catch(() => {});
  }
}
