import { Capacitor, registerPlugin } from '@capacitor/core';

export const APP_VERSION = '1.2.0';
export const UPDATE_REPO = '32muyuxuanshou/cuojian';

export interface AvailableUpdate {
  version: string;
  notes: string;
  publishedAt: string;
  downloadUrl: string;
  size: number;
}

interface NativeUpdater {
  downloadAndInstall(options: { url: string; fileName: string }): Promise<{ started: boolean }>;
}

const NativeAppUpdate = registerPlugin<NativeUpdater>('NativeAppUpdate');

export async function checkForUpdate(): Promise<AvailableUpdate | undefined> {
  const response = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`检查更新失败（${response.status}）`);
  const release = await response.json() as {
    tag_name?: string; body?: string; published_at?: string;
    assets?: Array<{ name: string; browser_download_url: string; size: number }>;
  };
  const version = (release.tag_name || '').replace(/^v/i, '');
  const apk = release.assets?.find((asset) => asset.name.toLowerCase().endsWith('.apk'));
  if (!version || !apk || compareVersions(version, APP_VERSION) <= 0) return undefined;
  return { version, notes: release.body || '新版本可用。', publishedAt: release.published_at || '', downloadUrl: apk.browser_download_url, size: apk.size };
}

export async function installUpdate(update: AvailableUpdate) {
  if (Capacitor.getPlatform() === 'android') {
    await NativeAppUpdate.downloadAndInstall({ url: update.downloadUrl, fileName: `cuojian-${update.version}.apk` });
    return;
  }
  window.open(update.downloadUrl, '_blank', 'noopener,noreferrer');
}

function compareVersions(left: string, right: string) {
  const a = left.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const b = right.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
  }
  return 0;
}
