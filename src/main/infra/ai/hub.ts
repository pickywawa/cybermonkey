import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  Provider,
  ProviderStatus,
  Settings,
  LoginProgress,
} from '../../../shared/domain/settings.js';
import { classifyError } from '../../../shared/errors.js';
import { ClaudeProvider } from './claude.js';
import { CodexProvider } from './codex.js';
import { CopilotProvider } from './copilot.js';
import type { AiProvider, Conversation, SendOptions } from './provider.js';
import type { UsageLedger } from './usage.js';

/** Who a conversation's tokens belong to: a project's chat session, or nobody in particular. */
export interface UsageOwner {
  projectId: string;
  sessionId?: string | null;
}

const TRANSIENT = new Set(['ai-timeout', 'network']);

/** Picks the configured provider and wraps every conversation with retry + cleanup. */
export class AiHub {
  private providers: Record<Provider, AiProvider> = {
    claude: new ClaudeProvider(),
    codex: new CodexProvider(),
    copilot: new CopilotProvider(),
  };
  private logins = new Set<Provider>();
  active = new Set<AbortController>();
  constructor(
    private settings: () => Settings,
    private onLogin: (progress: LoginProgress) => void,
    private openUrl: (url: string) => Promise<void>,
    private ledger?: UsageLedger,
    /** Called after every AI turn with the tokens it used and who asked. */
    private onTokens?: (
      owner: UsageOwner | undefined,
      usage: { input: number; output: number },
    ) => void,
  ) {}

  get current() {
    return this.providers[this.settings().provider];
  }
  async status(provider: Provider): Promise<ProviderStatus> {
    const status = await this.providers[provider].status();
    const [limits, usage] = await Promise.all([
      status.authenticated ? this.providers[provider].limits?.().catch(() => undefined) : undefined,
      this.ledger?.totals().catch(() => undefined),
    ]);
    return {
      ...status,
      ...(limits?.length ? { limits } : {}),
      ...(status.quota && !limits?.length
        ? {
            limits: [
              { id: 'quota', label: status.quota.label, usedPercent: status.quota.usedPercent },
            ],
          }
        : {}),
      ...(usage ? { usage } : {}),
    };
  }
  async isReady() {
    return (await this.current.status().catch(() => null))?.authenticated === true;
  }
  login(provider: Provider) {
    if (this.logins.has(provider)) throw new Error('Une connexion est déjà en cours');
    this.logins.add(provider);
    return this.providers[provider].login((output, running) => {
      if (!running) this.logins.delete(provider);
      this.onLogin({ provider, output, running });
    }, this.openUrl);
  }
  async logout(provider: Provider) {
    if (this.active.size || this.logins.size)
      throw new Error(
        'Arrêtez les demandes IA et la connexion en cours avant de vous déconnecter.',
      );
    await this.providers[provider].logout();
  }

  /** Open a short-lived conversation in a private temp directory. */
  async converse<T>(
    system: string,
    signal: AbortSignal,
    run: (conversation: Conversation) => Promise<T>,
    options: { fast?: boolean; owner?: UsageOwner } = {},
  ): Promise<T> {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'cybermonkey-ai-'));
    const controller = new AbortController();
    this.active.add(controller);
    const forward = () => controller.abort(signal.reason);
    signal.addEventListener('abort', forward, { once: true });
    if (signal.aborted) forward();
    let conversation: Conversation | undefined;
    try {
      const inner = await this.current.open({
        system,
        cwd,
        signal: controller.signal,
        settings: this.settings(),
        fast: options.fast,
        onUsage: (usage) => {
          void this.ledger?.add(usage);
          this.onTokens?.(options.owner, usage);
        },
      });
      conversation = inner;
      const resilient: Conversation = {
        close: () => inner.close(),
        send: async (prompt: string, options?: SendOptions) => {
          for (let attempt = 0; ; attempt++) {
            controller.signal.throwIfAborted();
            try {
              return await inner.send(prompt, options);
            } catch (error) {
              // Only transient provider failures are retried; a turn that executed nothing is safe to resend.
              if (
                attempt >= 2 ||
                controller.signal.aborted ||
                !TRANSIENT.has(classifyError(error).code)
              )
                throw error;
              await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
            }
          }
        },
      };
      return await run(resilient);
    } finally {
      signal.removeEventListener('abort', forward);
      this.active.delete(controller);
      await conversation?.close().catch(() => {});
      await fs.rm(cwd, { recursive: true, force: true });
    }
  }
  async stop() {
    for (const c of this.active) c.abort();
    await Promise.allSettled(Object.values(this.providers).map((p) => p.stop()));
  }
}
