import { followLanguage, tr } from './i18n.js';
import path from 'node:path';
import {
  TEST_TARGETS,
  integrationsSchema,
  type IntegrationSettings,
  type IntegrationStatus,
  type SecretKey,
  type TestTarget,
} from '../../shared/domain/integrations.js';
import type { CampaignDetail, RunReport } from '../../shared/domain/report.js';
import type { Settings } from '../../shared/domain/settings.js';
import type { LiveEvent } from '../../shared/ipc.js';
import type { AiHub } from '../infra/ai/hub.js';
import { log } from '../infra/log.js';
import type { CampaignStore } from '../infra/storage/campaign-store.js';
import type { WorkspaceStore } from '../infra/storage/workspace-store.js';
import { ConfirmBroker, Journal, type Confirmer, type FinishedRun } from './context.js';
import { inspect } from './git.js';
import { GitSync } from './git-sync.js';
import { Notifier } from './notifier.js';
import { findRegressions, secretsOf } from './regressions.js';
import { SecretStore, type Cipher } from './secrets.js';
import { TicketService } from './tickets.js';
import { TrackerService } from './trackers.js';

export interface IntegrationDeps {
  userData: string;
  settings: () => Settings;
  store: WorkspaceStore;
  campaigns: CampaignStore;
  loadCampaign: (projectId: string, campaignId: string) => Promise<CampaignDetail>;
  isBusy: () => boolean;
  ai: Pick<AiHub, 'converse'>;
  emit: (event: LiveEvent) => void;
  /** False from the command line: no window can answer, « ask » modes are skipped and git sync stays off. */
  interactive: boolean;
  cipher?: Cipher;
  /** Shared with the remote-devices service (credentials of device clouds). Created here when absent. */
  secrets?: SecretStore;
  fetchImpl?: typeof fetch;
}

/** Listens to what the app emits (runs, workspace changes) and drives Git sync, notifications, trackers and tickets. */
export class IntegrationHub {
  readonly secrets: SecretStore;
  readonly journal = new Journal();
  readonly broker: ConfirmBroker;
  readonly git: GitSync;
  readonly notifier: Notifier;
  readonly tickets: TicketService;
  readonly trackers: TrackerService;
  private finished = new Set<string>();
  private pending = new Set<Promise<unknown>>();
  private confirm?: Confirmer;

  constructor(private d: IntegrationDeps) {
    followLanguage(() => d.settings().language);
    this.secrets =
      d.secrets ?? new SecretStore(path.join(d.userData, 'integrations', 'secrets.json'), d.cipher);
    this.broker = new ConfirmBroker((request) => d.emit({ type: 'confirm', request }));
    this.confirm = d.interactive ? this.broker.ask : undefined;
    const project = (id: string) => d.store.state.projects.find((p) => p.id === id);
    this.notifier = new Notifier({
      settings: d.settings,
      secrets: this.secrets,
      journal: this.journal,
      project,
      loadCampaign: d.loadCampaign,
      media: { screenshot: (i) => d.campaigns.screenshot(i), video: (i) => d.campaigns.video(i) },
      fetchImpl: d.fetchImpl,
    });
    this.tickets = new TicketService({
      settings: d.settings,
      secrets: this.secrets,
      journal: this.journal,
      confirm: this.confirm,
      hub: d.ai,
      ledgerFile: path.join(d.userData, 'integrations', 'tickets.json'),
      screenshot: (i) => d.campaigns.screenshot(i),
      fetchImpl: d.fetchImpl,
    });
    this.trackers = new TrackerService({
      settings: d.settings,
      secrets: this.secrets,
      journal: this.journal,
      confirm: this.confirm,
      fetchImpl: d.fetchImpl,
    });
    this.git = new GitSync({
      settings: d.settings,
      projects: () =>
        d.store.state.projects.map(({ id, name, directory }) => ({ id, name, directory })),
      confirm: this.broker.ask,
      journal: this.journal,
      isBusy: d.isBusy,
      reload: async () => {
        await d.store.load();
        d.emit({ type: 'workspace' });
      },
    });
  }

  start() {
    if (this.d.interactive) this.git.start();
  }
  stop() {
    this.git.stop();
    this.broker.cancelAll();
  }

  /** Entry point: every event the app emits goes through here, and nothing here may throw into the app. */
  handle(event: LiveEvent) {
    try {
      if (event.type === 'run') {
        const report = event.report;
        if (report.status === 'running') this.track(this.notifier.onRun(report));
        else if (!this.finished.has(report.id)) {
          this.finished.add(report.id);
          if (this.finished.size > 200) this.finished.delete(this.finished.values().next().value!);
          this.track(this.finish(report));
        }
      } else if (event.type === 'workspace' && this.d.interactive) this.git.onChange('content');
    } catch (error) {
      log('integrations', String(error));
    }
  }
  private track(work: Promise<unknown>) {
    const p = work.catch((error) => {
      log('integrations', String((error as Error).stack ?? error));
      this.journal.add('integrations', false, String((error as Error).message ?? error));
    });
    this.pending.add(p);
    void p.finally(() => this.pending.delete(p));
  }
  /** Resolves when everything triggered so far is done (the command line waits for it before exiting). */
  async settled(timeoutMs = 90000) {
    const deadline = Date.now() + timeoutMs;
    while (this.pending.size && Date.now() < deadline) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.allSettled([...this.pending]),
        new Promise((resolve) => {
          timer = setTimeout(resolve, Math.max(0, deadline - Date.now()));
        }),
      ]);
      // A pending timer would keep the process alive for the whole timeout after the work is done.
      clearTimeout(timer);
    }
  }

  private async finish(report: RunReport) {
    const project = this.d.store.state.projects.find((p) => p.id === report.projectId);
    if (!project || !report.campaignId) return;
    const detail = await this.d.loadCampaign(project.id, report.campaignId);
    const others = (await this.d.campaigns.list(project.id).catch(() => []))
      .filter((c) => c.id !== report.campaignId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 8);
    const history = await Promise.all(
      others.map((c) => this.d.loadCampaign(project.id, c.id).catch(() => null)),
    );
    const f: FinishedRun = {
      report,
      project,
      campaignLabel: detail.campaign.label,
      regressions: findRegressions(report, [detail, ...history]),
      secrets: secretsOf(project),
    };
    await this.notifier.onFinished(f);
    await this.trackers.onFinished(f);
    await this.tickets.onFinished(f);
    if (this.d.interactive) this.git.onChange('run');
  }

  async status(): Promise<IntegrationStatus> {
    return {
      secrets: await this.secrets.has(),
      journal: this.journal.list(),
      interactive: this.d.interactive,
    };
  }
  async setSecret(key: SecretKey, value: string | null) {
    await this.secrets.set(key, value);
    return this.status();
  }
  gitInfo(dir: string) {
    return inspect(dir);
  }
  answer(id: string, accepted: boolean, edited?: string) {
    this.broker.answer(id, { accepted, edited });
  }
  gitSync(action: 'pull' | 'push') {
    return action === 'pull' ? this.git.checkPull() : this.git.proposePush();
  }

  /** Tries one integration with the configuration being edited (not necessarily saved yet). */
  async test(
    target: TestTarget,
    config: IntegrationSettings,
  ): Promise<{ ok: boolean; message: string }> {
    if (!TEST_TARGETS.includes(target))
      return { ok: false, message: tr('Cible inconnue', 'Unknown target') };
    const parsed = integrationsSchema.safeParse(config);
    if (!parsed.success)
      return {
        ok: false,
        message:
          tr('Configuration invalide : ', 'Invalid configuration: ') +
          parsed.error.issues[0]?.message,
      };
    const settings = () => ({ ...this.d.settings(), integrations: parsed.data });
    const shared = {
      settings,
      secrets: this.secrets,
      journal: new Journal(),
      fetchImpl: this.d.fetchImpl,
    };
    if (target === 'slack' || target === 'teams' || target === 'email') {
      const notifier = new Notifier({
        ...shared,
        project: () => undefined,
        loadCampaign: this.d.loadCampaign,
        media: { screenshot: async () => null, video: async () => null },
      });
      const r = await notifier.test(target);
      return {
        ok: r.ok,
        message: r.ok ? tr('Message de test envoyé.', 'Test message sent.') : r.message,
      };
    }
    if (target === 'github' || target === 'jira') {
      const tickets = new TicketService({
        ...shared,
        ledgerFile: path.join(this.d.userData, 'integrations', 'unused.json'),
        settings: () => ({
          ...settings(),
          integrations: { ...parsed.data, tickets: { ...parsed.data.tickets, provider: target } },
        }),
      });
      return tickets.test();
    }
    return new TrackerService({
      ...shared,
      settings: () => ({
        ...settings(),
        integrations: { ...parsed.data, trackers: { ...parsed.data.trackers, kind: target } },
      }),
    }).test();
  }
}
