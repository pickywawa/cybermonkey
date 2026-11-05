import { spawn, type ChildProcess } from 'node:child_process';
import type { z } from 'zod';
import type { Provider, ProviderStatus, Settings } from '../../../shared/domain/settings.js';
import { extractJson } from '../../../shared/ai/protocol.js';
import { commandEnv } from '../env.js';

export interface ImageInput {
  mime: 'image/png';
  /** Base64 data. */
  data: string;
}
export interface SendOptions {
  /** Screenshots attached to this turn (vision), when the provider supports it. */
  images?: ImageInput[];
  /** JSON schema for providers that support constrained output. */
  schema?: object;
  timeoutMs?: number;
}
export interface Conversation {
  send(prompt: string, options?: SendOptions): Promise<string>;
  close(): Promise<void>;
}
export interface OpenOptions {
  system: string;
  cwd: string;
  signal: AbortSignal;
  settings: Settings;
  /** Short-answer, low-reasoning mode: for step-by-step loops where latency matters more than depth. */
  fast?: boolean;
  onUsage?: (usage: { input: number; output: number }) => void;
}
export interface AiProvider {
  id: Provider;
  status(): Promise<ProviderStatus>;
  /** Plan usage windows when the provider can tell (never a guess). */
  limits?(): Promise<NonNullable<ProviderStatus['limits']>>;
  open(options: OpenOptions): Promise<Conversation>;
  login(
    report: (output: string, running: boolean) => void,
    openUrl: (url: string) => Promise<void>,
  ): Promise<void>;
  logout(): Promise<void>;
  stop(): Promise<void>;
}

/** Shared device-code / browser login flow for the provider CLIs. */
export class CliLogin {
  private child?: ChildProcess;
  get running() {
    return !!this.child;
  }
  start(
    binary: string,
    args: string[],
    urlPattern: RegExp,
    report: (o: string, running: boolean) => void,
    openUrl: (url: string) => Promise<void>,
  ) {
    if (this.child) throw new Error('Une connexion est déjà en cours');
    report('Connexion en cours…', true);
    const child = spawn(binary, args, {
      env: commandEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;
    let output = '';
    let opened = false;
    const append = (data: Buffer) => {
      output = (output + data.toString()).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').slice(-12000);
      report(output, true);
      const url = !opened && output.match(urlPattern)?.[0];
      if (url) {
        opened = true;
        void openUrl(url).catch((e) => report(output + '\n' + String(e), true));
      }
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    const timer = setTimeout(() => child.kill(), 5 * 60 * 1000);
    const finish = (message: string) => {
      clearTimeout(timer);
      this.child = undefined;
      report(message, false);
    };
    child.once('error', (e) => finish(e.message));
    child.once('close', (code) =>
      finish(
        `${output}\n${code === 0 ? 'Connexion terminée. Actualisez le statut.' : 'Connexion interrompue ou refusée.'}`,
      ),
    );
  }
  stop() {
    this.child?.kill();
  }
}

/** Ask for JSON, validate it, and re-prompt once with the validation error before giving up. */
export async function askStructured<T>(
  conversation: Conversation,
  prompt: string,
  schema: z.ZodType<T>,
  jsonSchema: object,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  let message = prompt;
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await conversation.send(message, {
      schema: jsonSchema,
      timeoutMs: options.timeoutMs,
    });
    try {
      const parsed = schema.safeParse(extractJson(raw));
      if (parsed.success) return parsed.data;
      lastError = parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
    } catch (error) {
      lastError = String((error as Error).message);
    }
    message = `Your previous answer was invalid (${lastError}). Return ONLY one valid JSON object matching the requested schema.`;
  }
  throw new Error('Réponse IA invalide : ' + lastError);
}
