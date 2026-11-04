export const REPO = 'pickywawa/cybermonkey';
export const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;
export interface UpdateStatus {
  state: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'error';
  currentVersion: string;
  version?: string;
  name?: string;
  notes?: string;
  url?: string;
  percent: number;
  received: number;
  total: number;
  checkedAt?: string;
  error?: string;
  compatible: boolean;
}
export interface UpdateAsset {
  name: string;
  url: string;
  size: number;
  digest: string;
}
export function newerVersion(latest: string, current: string) {
  const parse = (s: string) => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(s)?.slice(1).map(Number);
  const a = parse(latest),
    b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
export function selectAsset(release: any, platform: string, arch: string): UpdateAsset | undefined {
  const version = String(release.tag_name ?? '').replace(/^v/, '');
  const os = platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : 'linux';
  const extension = platform === 'darwin' ? 'dmg' : platform === 'win32' ? 'exe' : 'AppImage';
  const name = `Cybermonkey-${version}-${os}-${arch}.${extension}`;
  const asset = release.assets?.find((a: any) => a.name === name);
  if (
    !asset ||
    !(asset.browser_download_url ?? '').startsWith(`https://github.com/${REPO}/releases/download/`)
  )
    return;
  const digest = /^sha256:([a-f0-9]{64})$/i.exec(asset.digest ?? '')?.[1]?.toLowerCase();
  if (!digest) return;
  return { name, url: asset.browser_download_url, size: Number(asset.size) || 0, digest };
}
