import { CopilotClient, RuntimeConnection } from '@github/copilot-sdk';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ProviderStatus } from '../../../shared/domain/settings.js';
import { commandEnv, copilotBinary } from '../env.js';
import {
  CliLogin,
  type AiProvider,
  type Conversation,
  type OpenOptions,
  type SendOptions,
} from './provider.js';

const DEFAULT_TURN_MS = 150000;
export class CopilotProvider implements AiProvider {
  id = 'copilot' as const;
  private client?: Promise<CopilotClient>;
  private login_ = new CliLogin();

  private connect() {
    this.client ??= (async () => {
      // Native binaries must execute outside Electron's read-only ASAR archive.
      const client = new CopilotClient({
        env: commandEnv as Record<string, string>,
        logLevel: 'error',
        connection: RuntimeConnection.forStdio({ path: copilotBinary() }),
      });
      await client.start();
      return client;
    })().catch((e) => {
      this.client = undefined;
      throw e;
    });
    return this.client;
  }
  async status(): Promise<ProviderStatus> {
    try {
      const client = await this.connect();
      const auth = await client.getAuthStatus();
      const models = auth.isAuthenticated ? await client.listModels() : [];
      let quota: ProviderStatus['quota'];
      if (auth.isAuthenticated)
        try {
          const item = (await client.rpc.account.getQuota({})).quotaSnapshots.premium_interactions;
          if (item && !item.isUnlimitedEntitlement && Number.isFinite(item.remainingPercentage))
            quota = {
              label: 'Copilot premium',
              usedPercent: Math.max(0, Math.min(100, 100 - item.remainingPercentage)),
            };
        } catch {
          /* quotas are optional; unavailable never means zero usage */
        }
      return {
        provider: 'copilot',
        installed: true,
        authenticated: auth.isAuthenticated,
        account: auth.login ?? undefined,
        quota,
        message: auth.statusMessage ?? auth.login ?? 'Connexion GitHub requise',
        models: models.map((m) => ({ id: m.id, name: m.name })),
        help: auth.isAuthenticated
          ? undefined
          : 'Cliquez « Se connecter » et saisissez le code sur github.com/login/device.',
      };
    } catch (e) {
      return {
        provider: 'copilot',
        installed: !/ENOENT/.test(String(e)),
        authenticated: false,
        models: [],
        message: String(e),
      };
    }
  }
  async open({ system, cwd, signal, settings, fast }: OpenOptions): Promise<Conversation> {
    const session = await (
      await this.connect()
    ).createSession({
      model: settings.copilotModel || undefined,
      reasoningEffort:
        settings.reasoningEffort === 'default' ? undefined : settings.reasoningEffort,
      workingDirectory: cwd,
      availableTools: [],
      onPermissionRequest: () => ({ kind: 'denied-by-rules', rules: [] }),
      systemMessage: { mode: 'replace', content: system },
    });
    const abort = () => void session.abort().catch(() => {});
    signal.addEventListener('abort', abort);
    return {
      send: async (prompt: string, send: SendOptions = {}) => {
        signal.throwIfAborted();
        const attachments: { type: 'file'; path: string }[] = [];
        for (const [n, image] of (send.images ?? []).entries()) {
          const file = path.join(cwd, `view-${Date.now()}-${n}.png`);
          await fs.writeFile(file, Buffer.from(image.data, 'base64'));
          attachments.push({ type: 'file', path: file });
        }
        const reply = await session.sendAndWait(
          { prompt, ...(attachments.length ? { attachments } : {}) },
          send.timeoutMs ?? DEFAULT_TURN_MS,
        );
        return reply?.data.content ?? '';
      },
      close: async () => {
        signal.removeEventListener('abort', abort);
        await session.disconnect();
      },
    };
  }
  async login(
    report: (o: string, running: boolean) => void,
    openUrl: (url: string) => Promise<void>,
  ) {
    this.login_.start(
      copilotBinary(),
      ['login', '--device-code'],
      /https:\/\/github\.com\/[^\s]+/,
      (o, running) => {
        if (!running && this.client) void this.client.then((c) => c.stop()).catch(() => {});
        if (!running) this.client = undefined;
        report(o, running);
      },
      openUrl,
    );
  }
  async logout() {
    const client = await this.connect();
    await client.rpc.account.logout({});
    await client.stop();
    this.client = undefined;
  }
  async stop() {
    this.login_.stop();
    if (this.client) await (await this.client.catch(() => null))?.stop();
  }
}
