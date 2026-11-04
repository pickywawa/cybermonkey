import { Codex } from '@openai/codex-sdk';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ProviderStatus } from '../../../shared/domain/settings.js';
import { codexBinary, command } from '../env.js';
import {
  CliLogin,
  type AiProvider,
  type Conversation,
  type OpenOptions,
  type SendOptions,
} from './provider.js';

const DEFAULT_TURN_MS = 150000;
export class CodexProvider implements AiProvider {
  id = 'codex' as const;
  private login_ = new CliLogin();
  lastUsage?: { input: number; output: number };

  async status(): Promise<ProviderStatus> {
    try {
      await command(codexBinary(), ['login', 'status']);
    } catch (error) {
      return {
        provider: 'codex',
        installed: !/ENOENT/.test(String(error)),
        authenticated: false,
        models: [],
        message: 'Codex n’est pas connecté.',
        help: 'Cliquez « Se connecter » et suivez le code appareil affiché.',
      };
    }
    let models: ProviderStatus['models'] = [];
    try {
      const cached = JSON.parse(
        await fs.readFile(
          path.join(
            process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'),
            'models_cache.json',
          ),
          'utf8',
        ),
      );
      models = (cached.models ?? [])
        .filter((m: any) => m.visibility !== 'hide')
        .map((m: any) => ({ id: m.slug, name: m.display_name ?? m.slug }));
    } catch {
      /* the user can type a model id or keep the CLI default */
    }
    return {
      provider: 'codex',
      installed: true,
      authenticated: true,
      message: 'Compte Codex connecté.',
      models,
      lastUsage: this.lastUsage,
    };
  }
  async open({ system, cwd, signal, settings, onUsage, fast }: OpenOptions): Promise<Conversation> {
    const thread = new Codex({
      codexPathOverride: codexBinary(),
      config: { features: { shell_tool: false, unified_exec: false, code_mode_host: false } },
    }).startThread({
      model: settings.codexModel || undefined,
      modelReasoningEffort:
        settings.reasoningEffort === 'default' ? undefined : settings.reasoningEffort,
      workingDirectory: cwd,
      skipGitRepoCheck: true,
      sandboxMode: 'read-only',
      approvalPolicy: 'never',
      webSearchMode: 'disabled',
      networkAccessEnabled: false,
    });
    let first = true; // Codex has no system-prompt channel: the protocol rides on the first turn.
    return {
      send: async (prompt: string, send: SendOptions = {}) => {
        if (first) {
          first = false;
          prompt = system + '\n\n' + prompt;
        }
        const timeout = AbortSignal.timeout(send.timeoutMs ?? DEFAULT_TURN_MS);
        try {
          const files: string[] = [];
          for (const [n, image] of (send.images ?? []).entries()) {
            const file = path.join(cwd, `view-${Date.now()}-${n}.png`);
            await fs.writeFile(file, Buffer.from(image.data, 'base64'));
            files.push(file);
          }
          const input = files.length
            ? [
                { type: 'text' as const, text: prompt },
                ...files.map((f) => ({ type: 'local_image' as const, path: f })),
              ]
            : prompt;
          const result = await thread.run(input, {
            signal: AbortSignal.any([signal, timeout]),
            ...(send.schema ? { outputSchema: send.schema } : {}),
          });
          if (result.usage) {
            this.lastUsage = {
              input: result.usage.input_tokens,
              output: result.usage.output_tokens,
            };
            onUsage?.(this.lastUsage);
          }
          return result.finalResponse;
        } catch (error) {
          if (timeout.aborted && !signal.aborted)
            throw new Error(
              'Codex n’a pas répondu dans le délai imparti. Les actions déjà réalisées restent effectives ; réessayez ou réduisez l’effort de raisonnement.',
            );
          throw error;
        }
      },
      close: async () => {},
    };
  }
  async login(
    report: (o: string, running: boolean) => void,
    openUrl: (url: string) => Promise<void>,
  ) {
    this.login_.start(
      codexBinary(),
      ['login', '--device-auth'],
      /https:\/\/auth\.openai\.com\/[^\s]+/,
      report,
      openUrl,
    );
  }
  async logout() {
    await command(codexBinary(), ['logout']);
    this.lastUsage = undefined;
  }
  async stop() {
    this.login_.stop();
  }
}
