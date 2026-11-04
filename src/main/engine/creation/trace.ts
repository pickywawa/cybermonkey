import { promises as fs } from 'node:fs';
import path from 'node:path';
import { redact, secretEnvironment } from '../../../shared/domain/variables.js';

/** Append-only JSONL exploration trace; secrets and secure fields are masked before hitting the disk. */
export class TraceWriter {
  private directory?: string;
  readonly id = crypto.randomUUID();
  constructor(private secrets: () => string[]) {}
  async open(projectDirectory: string) {
    this.directory = path.join(projectDirectory, 'explorations');
    await fs.mkdir(this.directory, { recursive: true });
  }
  async record(entry: unknown) {
    if (!this.directory) return;
    const secrets = [...this.secrets(), ...secretEnvironment(process.env)];
    const line = JSON.stringify({ at: new Date().toISOString(), entry }, (_key, value) => {
      if (value && typeof value === 'object' && value.password)
        return { ...value, text: '[REDACTED]', label: '[REDACTED]' };
      return typeof value === 'string' ? redact(value, secrets) : value;
    });
    await fs
      .appendFile(path.join(this.directory, this.id + '.jsonl'), line + '\n', { mode: 0o600 })
      .catch(() => {});
  }
}
