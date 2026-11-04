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
 *
 * The keychain is touched as late as possible: macOS asks the person to allow it, which must never happen at launch,
 * when a settings page merely asks « is it set? », or in a CI job. Values are decrypted on first use only.
 */
export class SecretStore {
  /** What is on disk (ciphertext when `encrypted`). */
  private raw: Record<string, string> = {};
  private encrypted = false;
  /** Readable values, filled lazily. */
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
      const file = JSON.parse(await fs.readFile(this.file, 'utf8')) as {
        encrypted?: boolean;
        values?: Record<string, string>;
      };
      this.encrypted = !!file.encrypted;
      for (const key of SECRET_KEYS) {
        const stored = file.values?.[key];
        if (!stored) continue;
        this.raw[key] = stored;
        if (!this.encrypted) this.values.set(key, stored);
      }
    } catch {
      /* no file yet */
    }
  }
  /** The readable value of a stored secret; decrypts (and so may reach the keychain) on first use. */
  private read(key: SecretKey): string | undefined {
    const known = this.values.get(key);
    if (known !== undefined) return known;
    const stored = this.raw[key];
    if (!stored || !this.encrypted || !this.cipher) return undefined;
    try {
      const plain = this.cipher.decrypt(stored);
      this.values.set(key, plain);
      return plain;
    } catch {
      return undefined; // another user / keychain reset / refused: treated as not readable
    }
  }

  async get(key: SecretKey): Promise<string | undefined> {
    const fromEnv = fromEnvironment(key);
    if (fromEnv) return fromEnv;
    await this.load();
    return this.read(key);
  }
  /** Which secrets exist. Never decrypts: opening a settings page must not trigger a keychain prompt. */
  async has(): Promise<Record<SecretKey, boolean>> {
    await this.load();
    return Object.fromEntries(
      SECRET_KEYS.map((k) => [k, k in this.raw || this.values.has(k) || !!fromEnvironment(k)]),
    ) as Record<SecretKey, boolean>;
  }
  async set(key: SecretKey, value: string | null) {
    await this.load();
    // Rewriting the file needs every value in the clear.
    for (const k of Object.keys(this.raw) as SecretKey[]) if (k !== key) this.read(k);
    const trimmed = value?.trim();
    if (trimmed) this.values.set(key, trimmed);
    else this.values.delete(key);
    const entries = [...this.values];
    let encrypted = false;
    let stored = Object.fromEntries(entries);
    if (this.cipher) {
      try {
        stored = Object.fromEntries(entries.map(([k, v]) => [k, this.cipher!.encrypt(v)]));
        encrypted = true;
      } catch {
        /* no keychain on this system: owner-only plaintext is the fallback */
      }
    }
    this.raw = stored;
    this.encrypted = encrypted;
    const body = JSON.stringify({ encrypted, values: stored });
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
