import {
  query,
  type Options,
  type Query,
  type SDKResultMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { ProviderStatus } from '../../../shared/domain/settings.js';
import { claudeBinary, command, commandEnv } from '../env.js';
import {
  CliLogin,
  type AiProvider,
  type Conversation,
  type OpenOptions,
  type SendOptions,
} from './provider.js';

const MODELS = [
  { id: 'sonnet', name: 'Sonnet (alias)' },
  { id: 'opus', name: 'Opus (alias)' },
  { id: 'haiku', name: 'Haiku (alias)' },
  { id: 'claude-fable-5-1', name: 'Fable 5.1' },
  { id: 'claude-opus-5-5', name: 'Opus 5.5' },
  { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5' },
  { id: 'claude-haiku-5-5', name: 'Haiku 5.5' },
];
const DEFAULT_TURN_MS = 150000;

/** Claude Code through the Agent SDK: no tools, no user settings, only the conversation. */
export class ClaudeProvider implements AiProvider {
  id = 'claude' as const;
  private login_ = new CliLogin();
  lastUsage?: { input: number; output: number };

  private limitsCache?: { at: number; value: NonNullable<ProviderStatus['limits']> };
  /**
   * The plan's usage windows (5 hours, 7 days…) as Claude Code's own /usage reports them. Answered by the CLI without
   * sending any prompt; absent for API-key accounts. Cached a minute: it is asked every time the panel opens.
   */
  async limits(): Promise<NonNullable<ProviderStatus['limits']>> {
    if (this.limitsCache && Date.now() - this.limitsCache.at < 60_000)
      return this.limitsCache.value;
    const probe = query({
      prompt: (async function* (): AsyncGenerator<SDKUserMessage> {
        await new Promise<never>(() => {});
      })(),
      options: {
        tools: [],
        settingSources: [],
        pathToClaudeCodeExecutable: claudeBinary(),
        env: commandEnv as Record<string, string | undefined>,
      },
    });
    const value: NonNullable<ProviderStatus['limits']> = [];
    try {
      const usage = await Promise.race([
        probe.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Claude Code usage timeout')), 15000),
        ),
      ]);
      const windows = [
        ['five_hour', '5 h'],
        ['seven_day', '7 j'],
        ['seven_day_opus', 'Opus 7 j'],
        ['seven_day_sonnet', 'Sonnet 7 j'],
      ] as const;
      for (const [id, label] of windows) {
        const w = usage.rate_limits?.[id];
        if (w && typeof w.utilization === 'number')
          value.push({
            id,
            label,
            usedPercent: Math.max(0, Math.min(100, w.utilization)),
            ...(w.resets_at ? { resetsAt: w.resets_at } : {}),
          });
      }
    } catch {
      /* limits are optional: unavailable never means « nothing used » */
    } finally {
      try {
        probe.close();
      } catch {
        /* already stopped */
      }
    }
    this.limitsCache = { at: Date.now(), value };
    return value;
  }

  async status(): Promise<ProviderStatus> {
    const binary = claudeBinary();
    try {
      const out = JSON.parse(
        (await command(binary, ['auth', 'status'], { timeout: 15000 })).toString(),
      );
      const authenticated = !!out.loggedIn;
      return {
        provider: 'claude',
        installed: true,
        authenticated,
        account: out.email ?? out.authMethod,
        message: authenticated
          ? `Claude Code connecté${out.email ? ' · ' + out.email : ''}`
          : 'Claude Code n’est pas connecté.',
        models: MODELS,
        lastUsage: this.lastUsage,
        help: authenticated
          ? undefined
          : 'Cliquez « Se connecter » (navigateur) ou définissez ANTHROPIC_API_KEY avant de lancer Cybermonkey.',
      };
    } catch (error) {
      const missing = /ENOENT/.test(String(error));
      return {
        provider: 'claude',
        installed: !missing,
        authenticated: false,
        models: MODELS,
        message: missing ? 'Binaire Claude Code introuvable.' : String(error),
        help: missing
          ? 'Réinstallez Cybermonkey, ou installez Claude Code (npm i -g @anthropic-ai/claude-code).'
          : 'Lancez « claude auth login » dans un terminal puis actualisez.',
      };
    }
  }

  /**
   * One long-lived Claude Code process per conversation (streaming input): no process start-up and no prompt
   * re-reading on every step, which dominates latency when an exploration needs dozens of short turns.
   */
  async open({ system, cwd, signal, settings, onUsage, fast }: OpenOptions): Promise<Conversation> {
    let live: LiveSession | undefined;
    let sessionId: string | undefined;
    let liveSchema = '';
    const effort = settings.reasoningEffort === 'default' ? undefined : settings.reasoningEffort;
    const start = (schema?: object) => {
      const options: Options = {
        cwd,
        systemPrompt: system,
        tools: [],
        allowedTools: [],
        settingSources: [],
        model: settings.claudeModel || undefined,
        ...(fast ? { thinking: { type: 'disabled' } as const } : { effort }),
        pathToClaudeCodeExecutable: claudeBinary(),
        env: commandEnv as Record<string, string | undefined>,
        canUseTool: async () => ({ behavior: 'deny', message: 'Tools are disabled.' }),
        ...(sessionId ? { resume: sessionId } : {}),
        ...(schema
          ? { outputFormat: { type: 'json_schema', schema: schema as Record<string, unknown> } }
          : {}),
      };
      return new LiveSession(options, (id) => (sessionId = id), onUsage);
    };
    const onAbort = () => live?.close(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    return {
      send: async (prompt: string, send: SendOptions = {}) => {
        signal.throwIfAborted();
        const key = JSON.stringify(send.schema ?? null);
        if (live && (live.dead || key !== liveSchema)) {
          live.close();
          live = undefined;
        }
        if (!live) {
          live = start(send.schema);
          liveSchema = key;
        }
        const content: unknown = send.images?.length
          ? [
              { type: 'text', text: prompt },
              ...send.images.map((i) => ({
                type: 'image',
                source: { type: 'base64', media_type: i.mime, data: i.data },
              })),
            ]
          : prompt;
        const text = await live.ask(content, send.timeoutMs ?? DEFAULT_TURN_MS);
        this.lastUsage = live.usage ?? this.lastUsage;
        return text;
      },
      close: async () => {
        signal.removeEventListener('abort', onAbort);
        live?.close();
      },
    };
  }

  async login(
    report: (o: string, running: boolean) => void,
    openUrl: (url: string) => Promise<void>,
  ) {
    this.login_.start(
      claudeBinary(),
      ['auth', 'login'],
      /https:\/\/(?:claude\.(?:ai|com)|console\.anthropic\.com|platform\.claude\.com)\/[^\s]+/,
      report,
      openUrl,
    );
  }
  async logout() {
    await command(claudeBinary(), ['auth', 'logout']);
  }
  async stop() {
    this.login_.stop();
  }
}

/** A running Claude Code process fed through an async queue; one pending answer at a time. */
class LiveSession {
  private queue: SDKUserMessage[] = [];
  private wake?: () => void;
  private closed = false;
  private pending?: {
    resolve: (text: string) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  private readonly controller = new AbortController();
  private query!: Query;
  dead = false;
  usage?: { input: number; output: number };

  constructor(
    options: Options,
    onSession: (id: string) => void,
    private onUsage?: (u: { input: number; output: number }) => void,
  ) {
    const self = this;
    async function* input(): AsyncGenerator<SDKUserMessage> {
      while (true) {
        while (!self.queue.length) {
          if (self.closed) return;
          await new Promise<void>((resolve) => (self.wake = resolve));
        }
        yield self.queue.shift()!;
      }
    }
    this.query = query({
      prompt: input(),
      options: { ...options, abortController: this.controller },
    });
    void (async () => {
      try {
        for await (const message of this.query) {
          if ('session_id' in message && message.session_id) onSession(message.session_id);
          if (message.type === 'result') this.settle(message);
        }
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      } finally {
        this.dead = true;
        this.fail(new Error('Claude Code s’est arrêté de façon inattendue.'));
      }
    })();
  }

  private settle(message: SDKResultMessage) {
    const pending = this.pending;
    if (!pending) return;
    this.pending = undefined;
    clearTimeout(pending.timer);
    if (message.subtype !== 'success')
      return pending.reject(
        new Error(
          `Claude Code : ${message.subtype}${'errors' in message ? ' · ' + (message.errors ?? []).join('; ') : ''}`,
        ),
      );
    if (message.usage) {
      this.usage = {
        input: message.usage.input_tokens ?? 0,
        output: message.usage.output_tokens ?? 0,
      };
      this.onUsage?.(this.usage);
    }
    const text =
      message.structured_output !== undefined
        ? JSON.stringify(message.structured_output)
        : message.result;
    text ? pending.resolve(text) : pending.reject(new Error('Claude Code n’a rien retourné.'));
  }
  private fail(error: Error) {
    const pending = this.pending;
    this.pending = undefined;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }
  ask(content: unknown, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.dead) return reject(new Error('Claude Code n’est plus actif.'));
      const timer = setTimeout(() => {
        this.fail(
          new Error(
            'Claude Code n’a pas répondu dans le délai imparti. Les actions déjà réalisées restent effectives ; réessayez ou réduisez l’effort de raisonnement.',
          ),
        );
        this.close();
      }, timeoutMs);
      this.pending = { resolve, reject, timer };
      this.queue.push({
        type: 'user',
        parent_tool_use_id: null,
        message: { role: 'user', content },
      } as unknown as SDKUserMessage);
      this.wake?.();
    });
  }
  close(reason?: unknown) {
    if (this.closed) return;
    this.closed = true;
    this.dead = true;
    this.fail(reason instanceof Error ? reason : new Error('Conversation fermée.'));
    this.wake?.();
    this.controller.abort();
    try {
      this.query.close();
    } catch {
      /* already stopped */
    }
  }
}
