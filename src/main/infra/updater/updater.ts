import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  newerVersion,
  selectAsset,
  RELEASES_URL,
  REPO,
  type UpdateStatus,
  type UpdateAsset,
} from '../../../shared/update.js';
async function fileDigest(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export class Updater {
  state: UpdateStatus;
  private asset?: UpdateAsset;
  private file?: string;
  private checking?: Promise<UpdateStatus>;
  private downloading?: Promise<UpdateStatus>;
  private opening = false;
  constructor(
    private options: {
      version: string;
      platform: string;
      arch: string;
      directory: string;
      fetch: (url: string, init: RequestInit) => Promise<Response>;
      refreshProxy: () => Promise<void>;
      emit: (s: UpdateStatus) => void;
      open: (file: string) => Promise<void>;
    },
  ) {
    this.state = {
      state: 'idle',
      currentVersion: options.version,
      percent: 0,
      received: 0,
      total: 0,
      compatible: false,
    };
  }
  private publish(patch: Partial<UpdateStatus>) {
    this.state = { ...this.state, ...patch };
    this.options.emit({ ...this.state });
    return { ...this.state };
  }
  private async request(url: string, timeout: number) {
    let error: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (attempt) await this.options.refreshProxy();
        const response = await this.options.fetch(url, {
          headers: {
            Accept: url.includes('api.github.com')
              ? 'application/vnd.github+json'
              : 'application/octet-stream',
            'User-Agent': 'Cybermonkey/' + this.options.version,
            'Cache-Control': 'no-cache',
          },
          signal: AbortSignal.timeout(timeout),
        });
        if (!response.ok) throw new Error('GitHub HTTP ' + response.status);
        return response;
      } catch (e) {
        error = e;
        if (String(e).includes('HTTP 4')) break;
      }
    }
    throw error;
  }
  check() {
    if (this.downloading) return Promise.resolve({ ...this.state });
    if (this.checking) return this.checking;
    this.checking = this.performCheck().finally(() => {
      this.checking = undefined;
    });
    return this.checking;
  }
  private async performCheck() {
    this.publish({ state: 'checking', error: undefined });
    try {
      const response = await this.request(
        `https://api.github.com/repos/${REPO}/releases/latest`,
        20000,
      );
      const release = (await response.json()) as any;
      if (
        release.draft ||
        release.prerelease ||
        !newerVersion(String(release.tag_name), this.options.version)
      ) {
        this.asset = undefined;
        this.file = undefined;
        return this.publish({
          state: 'current',
          version: undefined,
          name: undefined,
          notes: undefined,
          url: RELEASES_URL,
          percent: 0,
          received: 0,
          total: 0,
          compatible: false,
          checkedAt: new Date().toISOString(),
        });
      }
      const asset = selectAsset(release, this.options.platform, this.options.arch);
      const same = this.asset?.url === asset?.url && this.asset?.digest === asset?.digest;
      if (!same) this.file = undefined;
      this.asset = asset;
      if (!this.file && asset) {
        const candidate = path.join(this.options.directory, asset.name);
        try {
          if ((await fileDigest(candidate)) === asset.digest) this.file = candidate;
        } catch {}
      }
      if (this.file) {
        try {
          await fs.access(this.file);
        } catch {
          this.file = undefined;
        }
      }
      return this.publish({
        state: this.file ? 'ready' : 'available',
        version: String(release.tag_name).replace(/^v/, ''),
        name: String(release.name ?? release.tag_name),
        notes: String(release.body ?? '').slice(0, 18000),
        url: `https://github.com/${REPO}/releases/tag/${encodeURIComponent(String(release.tag_name))}`,
        compatible: !!asset,
        percent: this.file ? 100 : 0,
        received: 0,
        total: asset?.size ?? 0,
        checkedAt: new Date().toISOString(),
      });
    } catch (e) {
      return this.publish({
        state: 'error',
        error: String(e),
        checkedAt: new Date().toISOString(),
      });
    }
  }
  download() {
    if (this.downloading) return this.downloading;
    if (this.state.state === 'ready') return Promise.resolve({ ...this.state });
    this.downloading = this.performDownload().finally(() => {
      this.downloading = undefined;
    });
    return this.downloading;
  }
  private async performDownload() {
    if (this.checking) await this.checking;
    const asset = this.asset;
    if (!asset)
      throw new Error(
        'Aucun installateur vérifié pour cette plateforme. Ouvrez la release GitHub.',
      );
    await fs.mkdir(this.options.directory, { recursive: true });
    const target = path.join(this.options.directory, asset.name),
      temporary = target + '.' + randomUUID() + '.download';
    this.publish({
      state: 'downloading',
      error: undefined,
      percent: 0,
      received: 0,
      total: asset.size,
    });
    try {
      const response = await this.request(asset.url, 30 * 60 * 1000);
      if (!response.body) throw new Error('Réponse de téléchargement vide');
      const handle = await fs.open(temporary, 'wx', 0o600);
      const hash = createHash('sha256');
      let received = 0,
        last = 0;
      try {
        for await (const chunk of response.body as any as AsyncIterable<Uint8Array>) {
          hash.update(chunk);
          let offset = 0;
          while (offset < chunk.length) {
            const written = await handle.write(chunk, offset, chunk.length - offset);
            if (!written.bytesWritten) throw new Error('Écriture du téléchargement interrompue');
            offset += written.bytesWritten;
          }
          received += chunk.length;
          if (received > asset.size && asset.size > 0)
            throw new Error('Taille de téléchargement invalide');
          if (Date.now() - last > 150) {
            last = Date.now();
            this.publish({
              received,
              total: asset.size,
              percent: asset.size ? Math.min(99, Math.floor((received / asset.size) * 100)) : 0,
            });
          }
        }
      } finally {
        await handle.close();
      }
      if (asset.size && received !== asset.size) throw new Error('Téléchargement incomplet');
      if (hash.digest('hex') !== asset.digest)
        throw new Error('Empreinte SHA-256 du téléchargement invalide');
      await fs.rename(temporary, target);
      this.file = target;
      return this.publish({ state: 'ready', percent: 100, received, total: received });
    } catch (e) {
      await fs.unlink(temporary).catch(() => {});
      this.publish({ state: 'error', error: String(e), percent: 0 });
      throw e;
    }
  }
  async install() {
    if (this.opening) return;
    if (!this.file || !this.asset || this.state.state !== 'ready')
      throw new Error('Téléchargez la mise à jour avant de l’ouvrir');
    this.opening = true;
    try {
      if ((await fileDigest(this.file)) !== this.asset.digest)
        throw new Error('Le fichier téléchargé a été modifié');
      await this.options.open(this.file);
    } finally {
      this.opening = false;
    }
  }
}
