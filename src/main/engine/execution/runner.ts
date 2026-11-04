import { randomUUID } from 'node:crypto';
import {
  activeEnvironment,
  activeOs,
  effectiveVariables,
  type Project,
} from '../../../shared/domain/project.js';
import type { RunReport } from '../../../shared/domain/report.js';
import {
  flatten,
  nodePath,
  updateNode,
  type OS,
  type ScenarioNode,
  isSupportScenario,
} from '../../../shared/domain/scenario.js';
import { validateScreenDefinitions } from '../../../shared/domain/screens.js';
import type { Settings } from '../../../shared/domain/settings.js';
import type { LiveEvent, RunRequest } from '../../../shared/ipc.js';
import type { Automation } from '../../infra/appium/automation.js';
import type { Devices } from '../../infra/devices/scanner.js';
import type { CampaignStore } from '../../infra/storage/campaign-store.js';
import type { WorkspaceStore } from '../../infra/storage/workspace-store.js';
import type { AiHub } from '../../infra/ai/hub.js';
import { deviceContext } from '../device-context.js';
import { translator } from '../i18n.js';
import type { StartRecoveryAgent } from '../creation/recovery.js';
import { Analyzer, formatAnalysis } from './analysis.js';
import { partialRoot } from './roots.js';
import { DeviceRun } from './device-run.js';
import { AiInterruptionAdvisor } from './interruption-ai.js';
import { Healer } from './healing.js';

/** Run lifecycle: validation, device leases, persistence, cancellation, campaign access. */
export class Runner {
  private reports = new Map<string, RunReport>();
  private active?: { report: RunReport; abort: AbortController };
  private persistence: Promise<unknown> = Promise.resolve();
  private task?: Promise<void>;
  private maintenance = new Set<string>();
  readonly analyzer: Analyzer;
  private healer: Healer;
  private advisor: AiInterruptionAdvisor;
  private t: ReturnType<typeof translator>;

  constructor(
    private deps: {
      store: WorkspaceStore;
      campaigns: CampaignStore;
      automation: Automation;
      devices: Devices;
      hub: AiHub;
      recovery: StartRecoveryAgent;
      settings: () => Settings;
      emit: (e: LiveEvent) => void;
    },
  ) {
    this.analyzer = new Analyzer(deps.hub, deps.settings);
    this.healer = new Healer(deps.hub, deps.settings);
    this.advisor = new AiInterruptionAdvisor(deps.hub, deps.settings);
    this.t = translator(deps.settings);
  }

  /** Snapshot of a run (live while running, final afterwards), or undefined if unknown to this session. */
  getReport(runId: string) {
    const report = this.reports.get(runId);
    return report && structuredClone(report);
  }
  /** Resolves when the given run is over (or after `timeoutMs`); returns whether it finished. */
  async waitForRun(runId: string, timeoutMs: number, onTick?: (report: RunReport) => void) {
    const deadline = Date.now() + timeoutMs;
    while (this.active?.report.id === runId) {
      if (Date.now() > deadline) return false;
      onTick?.(this.active.report);
      await new Promise((r) => setTimeout(r, 400));
    }
    await this.task;
    await this.persistence;
    return true;
  }
  currentRunId() {
    return this.active?.report.id;
  }
  isRunning() {
    return !!this.active;
  }
  cancel() {
    this.active?.abort.abort();
  }
  async stop() {
    this.cancel();
    await this.task;
    await this.persistence;
  }

  /* ---------- campaign access ---------- */
  async loadCampaign(projectId: string, campaignId: string) {
    const detail = await this.deps.campaigns.load(projectId, campaignId);
    for (let i = 0; i < detail.reports.length; i++) {
      const saved = detail.reports[i];
      const memory = this.reports.get(saved.id);
      if (memory) {
        detail.reports[i] = structuredClone(memory);
        continue;
      }
      if (saved.status === 'running') {
        saved.status = 'cancelled';
        saved.finishedAt = new Date().toISOString();
        for (const e of saved.entries)
          if (e.status === 'running')
            Object.assign(e, {
              status: 'cancelled',
              finishedAt: saved.finishedAt,
              message: 'Exécution interrompue par la fermeture du logiciel',
            });
        await this.deps.campaigns.saveReport(saved);
      }
      for (const e of saved.entries) if (e.analysisState === 'running') e.analysisState = 'pending';
      this.reports.set(saved.id, saved);
    }
    return detail;
  }
  async replayFrame(projectId: string, runId: string, entryId: string) {
    const campaignId = this.deps.store.get(projectId).activeCampaignId;
    if (!campaignId) throw new Error('Aucune campagne ouverte');
    let report = this.reports.get(runId);
    if (!report) {
      await this.loadCampaign(projectId, campaignId);
      report = this.reports.get(runId);
    }
    if (!report || report.projectId !== projectId || report.campaignId !== campaignId)
      throw new Error('Capture hors campagne');
    const entry = report.entries.find((e) => e.id === entryId);
    if (!entry?.completedAt) throw new Error('Étape sans capture terminée');
    return { runId, entry: structuredClone(entry) };
  }
  async cleanCampaigns(projectId: string, campaignId?: string) {
    if (this.maintenance.has(projectId)) throw new Error('Nettoyage déjà en cours');
    this.maintenance.add(projectId);
    try {
      if (this.active?.report.projectId === projectId)
        throw new Error('Arrêtez l’exécution avant de nettoyer les campagnes.');
      const analysing = [...this.reports.values()].some(
        (r) =>
          r.projectId === projectId &&
          (!campaignId || r.campaignId === campaignId) &&
          r.entries.some((e) => e.analysisState === 'running'),
      );
      if (analysing) throw new Error('Une analyse est encore en cours.');
      await this.persistence;
      await this.deps.campaigns.clean(projectId, campaignId);
      for (const [id, r] of this.reports)
        if (r.projectId === projectId && (!campaignId || r.campaignId === campaignId))
          this.reports.delete(id);
    } finally {
      this.maintenance.delete(projectId);
    }
  }
  async current(projectId: string) {
    const campaignId = this.deps.store.get(projectId).activeCampaignId;
    const memory = [...this.reports.values()]
      .reverse()
      .find((r) => r.projectId === projectId && (!campaignId || r.campaignId === campaignId));
    if (memory) return memory;
    if (!campaignId) return null;
    const detail = await this.loadCampaign(projectId, campaignId).catch(() => null);
    return detail?.reports.at(-1) ?? null;
  }

  /** Progress updates are coalesced (150 ms): cloning, emitting and writing a growing report per step is costly. */
  private flushTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private publish(report: RunReport, now = false) {
    if (!now) {
      if (!this.flushTimers.has(report.id))
        this.flushTimers.set(
          report.id,
          setTimeout(() => {
            this.flushTimers.delete(report.id);
            this.flush(report);
          }, 150),
        );
      return;
    }
    clearTimeout(this.flushTimers.get(report.id));
    this.flushTimers.delete(report.id);
    this.flush(report);
  }
  private flush(report: RunReport) {
    const snapshot = structuredClone(report);
    this.deps.emit({ type: 'run', report: snapshot });
    this.persistence = this.persistence
      .catch(() => {})
      .then(() => this.deps.campaigns.saveReport(snapshot))
      .catch((error) => {
        report.persistenceError = String(error);
        this.deps.emit({ type: 'run', report: structuredClone(report) });
      });
  }

  /* ---------- start ---------- */
  async start(input: RunRequest): Promise<RunReport> {
    const { store, campaigns, devices, automation } = this.deps;
    if (this.active) throw new Error('Une exécution est déjà en cours');
    if (this.maintenance.has(input.projectId)) throw new Error('Nettoyage de campagne en cours');
    const project = store.get(input.projectId);
    const campaignId = input.campaignId ?? project.activeCampaignId;
    if (!campaignId)
      throw new Error('Créez ou sélectionnez une campagne avant de lancer les tests.');
    const { campaign } = await campaigns.load(project.id, campaignId);
    if (campaign.status !== 'open')
      throw new Error('Cette campagne est terminée. Rouvrez-la pour poursuivre.');
    if (this.active) throw new Error('Une exécution est déjà en cours');

    // One OS at a time, or both: the request wins, otherwise the project's focus.
    const requested: OS[] = input.platforms?.length ? input.platforms : activeOs(project);
    if (requested.some((os) => !project.platforms.includes(os)))
      throw new Error('OS incompatible avec le projet');
    validateScreenDefinitions(project.nodes);

    const roots = input.roots
      ? structuredClone(input.roots)
      : this.selectRoots(project, input.nodeId, input.onlySelf);
    if (!roots.length) throw new Error('Aucun scénario à exécuter');
    const wanted = [...new Set(input.deviceIds)]
      .map((id) => devices.known.get(id))
      .filter((d) => d && requested.includes(d.platform));
    if (wanted.some((d) => d!.status !== 'ready')) throw new Error('Appareil non connecté');
    if (new Set(wanted.map((d) => d!.platform)).size !== wanted.length)
      throw new Error('Un seul appareil par OS');
    const ids = wanted.map((d) => d!.id);
    if (!ids.length) throw new Error('Associez au moins un appareil pour lancer une exécution.');
    if (input.resetCampaign) {
      if (input.nodeId || input.platforms)
        throw new Error('Le nettoyage nécessite une exécution complète.');
      await this.cleanCampaigns(project.id, campaignId);
    }
    if (this.active) throw new Error('Une exécution est déjà en cours');

    const report: RunReport = {
      id: randomUUID(),
      projectId: project.id,
      campaignId,
      environment: activeEnvironment(project)?.name,
      platforms: requested,
      startedAt: new Date().toISOString(),
      status: 'running',
      entries: [],
      snapshot: roots,
    };
    const abort = new AbortController();
    automation.acquire(ids, report.id);
    this.active = { report, abort };
    this.reports.set(report.id, report);
    for (const os of requested)
      if (!wanted.some((d) => d!.platform === os))
        report.entries.push({
          id: randomUUID(),
          nodeId: roots[0].id,
          nodeName: 'Appareil ' + os,
          deviceId: 'missing:' + os,
          platform: os,
          status: 'blocked',
          message: this.t('Aucun appareil appairé pour cet OS', 'No device paired for this OS'),
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        });
    this.publish(report, true);
    // Full runs and whole scenarios relaunch the app (data kept); single steps continue the current screen.
    const restart =
      input.restartApp ??
      (!input.nodeId || nodePath(project.nodes, input.nodeId).at(-1)?.kind === 'scenario');
    this.task = this.execute(
      report,
      ids,
      abort,
      structuredClone(project),
      restart,
      input.preparation,
    )
      .catch((error) => {
        report.status = 'failed';
        report.finishedAt = new Date().toISOString();
        report.entries.push({
          id: randomUUID(),
          nodeId: 'engine',
          nodeName: 'Moteur',
          deviceId: '',
          platform: requested[0],
          status: 'failed',
          message: String(error),
          startedAt: new Date().toISOString(),
        });
        this.publish(report, true);
      })
      .finally(() => {
        automation.release(report.id);
        if (this.active?.report.id === report.id) this.active = undefined;
      });
    return structuredClone(report);
  }

  /** Whole project, one scenario, or a single step wrapped in its scenario (keeping its precondition guard). */
  private selectRoots(project: Project, nodeId?: string, onlySelf = false): ScenarioNode[] {
    if (!nodeId) return structuredClone(project.nodes.filter((n) => !isSupportScenario(n)));
    const root = partialRoot(project, nodeId, onlySelf);
    return root ? [root] : [];
  }

  private async execute(
    report: RunReport,
    deviceIds: string[],
    abort: AbortController,
    project: Project,
    restart: boolean,
    preparation?: RunRequest['preparation'],
  ) {
    const { devices, automation, settings } = this.deps;
    const variables = () => structuredClone(effectiveVariables(project));
    const roots = [...report.snapshot];
    const outcomes = await Promise.allSettled(
      deviceIds.map((deviceId) => {
        const ctx = deviceContext(
          automation,
          devices,
          deviceId,
          report.id,
          abort.signal,
          variables,
          project.applications?.[devices.known.get(deviceId)?.platform as OS],
        );
        return new DeviceRun({
          report,
          ctx,
          abort,
          allNodes: project.nodes,
          settings,
          t: this.t,
          publish: () => this.publish(report),
          saveCapture: (entryId, image) => this.deps.campaigns.saveCapture(report, entryId, image),
          saveVideo: (entryId, video) => this.deps.campaigns.saveVideo(report, entryId, video),
          application: project.applications?.[ctx.platform] || undefined,
          restartApplication: restart,
          preparation,
          healer: this.healer,
          advisor: this.advisor,
          analyzer: this.analyzer,
          recovery: this.deps.recovery,
          startAnalysis: (entryId) =>
            void this.analyze({ runId: report.id, entryId }).catch(() => {}),
        }).run(roots);
      }),
    );
    outcomes.forEach((o, i) => {
      if (o.status === 'rejected')
        report.entries.push({
          id: randomUUID(),
          nodeId: 'engine',
          nodeName: this.t('Préparation de l’appareil', 'Device preparation'),
          deviceId: deviceIds[i],
          platform: devices.known.get(deviceIds[i])!.platform,
          status: abort.signal.aborted ? 'cancelled' : 'blocked',
          message: String(o.reason?.message ?? o.reason),
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
        });
    });
    report.status = abort.signal.aborted
      ? 'cancelled'
      : report.entries.some((e) => e.status === 'failed' || e.status === 'blocked')
        ? 'failed'
        : 'passed';
    report.finishedAt = new Date().toISOString();
    this.publish(report, true);
    await this.persistence;
  }

  /* ---------- post-run actions ---------- */
  async analyze(input: { runId: string; entryId: string }) {
    const report = this.reports.get(input.runId);
    if (report && this.maintenance.has(report.projectId))
      throw new Error('Nettoyage de campagne en cours');
    const entry = report?.entries.find((e) => e.id === input.entryId);
    if (!report || !entry || entry.status !== 'failed') throw new Error('Échec introuvable');
    if (entry.analysisState === 'running' || entry.analysisState === 'done') return;
    entry.analysisState = 'running';
    this.publish(report, true);
    try {
      const data = await this.analyzer.analyze(structuredClone(entry), structuredClone(report));
      entry.analysisData = data;
      entry.analysis = formatAnalysis(data);
      entry.analysisState = 'done';
    } catch (e) {
      entry.analysis = 'Analyse indisponible : ' + String((e as Error).message ?? e);
      entry.analysisState = 'pending';
    }
    this.publish(report, true);
    await this.persistence;
  }

  /** Persist an AI-repaired selector into the scenario (old one kept as fallback). */
  async applyHealing(input: {
    projectId: string;
    campaignId: string;
    runId: string;
    entryId: string;
  }) {
    if (!this.reports.has(input.runId)) await this.loadCampaign(input.projectId, input.campaignId);
    const report = this.reports.get(input.runId);
    const entry = report?.entries.find((e) => e.id === input.entryId);
    if (!report || !entry?.healing) throw new Error('Aucune réparation à appliquer');
    const project = this.deps.store.get(input.projectId);
    const { to, from } = entry.healing;
    const node = flatten(project.nodes).find((n) => n.id === entry.nodeId);
    const variant = node?.variants[entry.platform];
    if (!node || !variant) throw new Error('Étape introuvable dans le scénario courant');
    const updated = await this.deps.store.update({
      id: project.id,
      nodes: updateNode(project.nodes, node.id, (n) => ({
        ...n,
        variants: {
          ...n.variants,
          [entry.platform]: {
            ...variant,
            locator: to,
            fallbacks: [...(from ? [from] : []), ...variant.fallbacks].slice(0, 5),
          },
        },
      })),
    });
    entry.healing.applied = true;
    this.publish(report, true);
    await this.persistence;
    return updated;
  }
}
