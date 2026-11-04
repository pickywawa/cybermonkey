import { promises as fs } from 'node:fs';
import path from 'node:path';
import { SECRET_KEYS, type SecretKey } from '../../shared/domain/integrations.js';

/** `jiraToken` → `CYBERMONKEY_JIRA_TOKEN`: lets a CI inject secrets from its own vault, which beats a file on disk. */
export const envName = (key: SecretKey) =>
  'CYBERMONKEY_' + key.replace(/([A-Z])/g, '_$1').toUpperCase();

/** The variables each vendor's own tools already use: a CI that runs them has them set. */
const ALIASES: Partial<Record<SecretKey, string[]>> = {
  browserstackKey: ['BROWSERSTACK_ACCESS_KEY'],
  saucelabsKey: ['SAUCE_ACCESS_KEY'],
  awsSecretKey: ['AWS_SECRET_ACCESS_KEY'],
  githubToken: ['GITHUB_TOKEN'],
};
export const fromEnvironment = (key: SecretKey): string | undefined => {
  for (const name of [envName(key), ...(ALIASES[key] ?? [])]) {
    const v = process.env[name]?.trim();
    if (v) return v;
  }
  return undefined;
};

export interface Cipher {
  encrypt(plain: string): string;
  decrypt(cipher: string): string;
}

/**
 * Tokens and webhook URLs, kept apart from `settings` (which the window receives whole and which can be exported).
 * Written with owner-only permissions; encrypted with the OS keychain when a cipher is provided (the desktop app does).
 */
export class SecretStore {
  private values = new Map<SecretKey, string>();
  private loaded = false;
  private writing: Promise<unknown> = Promise.resolve();
  constructor(
    private file: string,
    private cipher?: Cipher,
  ) {}

  private async load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8')) as {
        encrypted?: boolean;
        values?: Record<string, string>;
      };
      for (const key of SECRET_KEYS) {
        const stored = raw.values?.[key];
        if (!stored) continue;
        try {
          this.values.set(key, raw.encrypted ? this.require().decrypt(stored) : stored);
        } catch {
          /* unreadable (another user / keychain reset): treated as not set */
        }
      }
    } catch {
      /* no file yet */
    }
  }
  private require() {
    if (!this.cipher) throw new Error('Secrets chiffrés mais aucun chiffrement disponible');
    return this.cipher;
  }

  async get(key: SecretKey): Promise<string | undefined> {
    const fromEnv = fromEnvironment(key);
    if (fromEnv) return fromEnv;
    await this.load();
    return this.values.get(key);
  }
  async has(): Promise<Record<SecretKey, boolean>> {
    await this.load();
    return Object.fromEntries(
      SECRET_KEYS.map((k) => [k, this.values.has(k) || !!fromEnvironment(k)]),
    ) as Record<SecretKey, boolean>;
  }
  async set(key: SecretKey, value: string | null) {
    await this.load();
    const trimmed = value?.trim();
    if (trimmed) this.values.set(key, trimmed);
    else this.values.delete(key);
    const encrypted = !!this.cipher;
    const body = JSON.stringify({
      encrypted,
      values: Object.fromEntries(
        [...this.values].map(([k, v]) => [k, encrypted ? this.cipher!.encrypt(v) : v]),
      ),
    });
    this.writing = this.writing
      .catch(() => {})
      .then(async () => {
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        const tmp = this.file + '.tmp';
        await fs.writeFile(tmp, body, { mode: 0o600 });
        await fs.rename(tmp, this.file);
      });
    await this.writing;
  }
}
