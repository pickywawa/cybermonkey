import { randomUUID } from 'node:crypto';
import type { Screen } from '../../../shared/domain/devices.js';
import type {
  RunEntry,
  RunReport,
  RunStatus,
  ScreenReference,
} from '../../../shared/domain/report.js';
import {
  flatten,
  type OS,
  type ScenarioNode,
  type Variant,
} from '../../../shared/domain/scenario.js';
import { identifyScreen, isUnstableLabel } from '../../../shared/domain/screens.js';
import type { Settings } from '../../../shared/domain/settings.js';
import { StepError } from '../../infra/appium/operations.js';
import type { DeviceContext } from '../device-context.js';
import type { Translate } from '../i18n.js';
import type { StartRecoveryAgent } from '../creation/recovery.js';
import type { Analyzer } from './analysis.js';
import type { Healer } from './healing.js';
import { prepareStart, startingTarget } from './start-state.js';
import { waitForMarkers } from './screen-wait.js';

export interface DeviceRunDeps {
  report: RunReport;
  ctx: DeviceContext;
  abort: AbortController;
  allNodes: ScenarioNode[];
  settings: () => Settings;
  t: Translate;
  publish: () => void;
  saveCapture: (entryId: string, image: string) => Promise<string>;
  application?: string;
  restartApplication: boolean;
  healer?: Healer;
  analyzer: Analyzer;
  recovery?: StartRecoveryAgent;
  startAnalysis: (entryId: string) => void;
}
interface Outcome {
  failed: boolean;
  halt: boolean;
}
const MAX_HEALS = 15;

/** Executes the scenario tree on ONE device, producing one report entry per step with proof (screens, capture). */
export class DeviceRun {
  private os: OS;
  private heals = 0;
  constructor(private d: DeviceRunDeps) {
    this.os = d.ctx.platform;
  }

  async run(roots: ScenarioNode[]) {
    const { ctx, application } = this.d;
    if (application) await ctx.ensureApplication(application, this.d.restartApplication);
    for (const root of roots) await this.sequence([root]);
  }

  /* ---------- helpers ---------- */
  private get report() {
    return this.d.report;
  }
  /** Where the app currently is. Cached: it only changes through navigations, so most steps need no inspection. */
  private current?: ScreenReference;
  /** Declared start screen of the running scenario: confirmed with a couple of cheap queries instead of an inspection. */
  private startHint?: ScenarioNode['startScreen'];
  private async observe(): Promise<ScreenReference> {
    if (this.current) return this.current;
    const hint = this.startHint;
    if (hint?.variants[this.os]?.markers.length)
      try {
        const markers = hint.variants[this.os]!.markers.filter((m) => !isUnstableLabel(m.value));
        if (markers.length && (await this.d.ctx.markersPresent(markers)))
          return (this.current = {
            id: hint.id,
            name: hint.name,
            platform: this.os,
            identified: true,
          });
      } catch {
        /* fall back to a real inspection */
      }
    return (this.current = await this.identify());
  }
  private async identify(): Promise<ScreenReference> {
    try {
      return identifyScreen(await this.d.ctx.inspect(), this.os, this.d.allNodes);
    } catch {
      return {
        id: 'unavailable',
        name: 'Écran indisponible',
        platform: this.os,
        identified: false,
      };
    }
  }

  private add(node: ScenarioNode, precondition = false): RunEntry {
    const entry: RunEntry = {
      id: randomUUID(),
      nodeId: node.id,
      nodeName: node.name,
      kind: node.kind,
      deviceId: this.d.ctx.deviceId,
      platform: this.os,
      status: 'running',
      message: precondition
        ? this.d.t('Vérification de la précondition…', 'Checking precondition…')
        : this.d.t('En cours…', 'Running…'),
      startedAt: new Date().toISOString(),
      precondition,
    };
    this.report.entries.push(entry);
    this.d.publish();
    return entry;
  }
  private passive(node: ScenarioNode, status: RunStatus, message: string) {
    const at = new Date().toISOString();
    this.report.entries.push({
      id: randomUUID(),
      nodeId: node.id,
      nodeName: node.name,
      kind: node.kind,
      deviceId: this.d.ctx.deviceId,
      platform: this.os,
      status,
      message,
      startedAt: at,
      finishedAt: at,
    });
  }
  private markAll(nodes: ScenarioNode[], status: RunStatus, message: string) {
    for (const n of flatten(nodes)) this.passive(n, status, message);
  }
  /**
   * Close an entry with its evidence. `known` is the screen a successful navigation just confirmed (no inspection
   * needed). Failures always get a fresh inspection and a capture; other steps follow the `executionProof` policy.
   */
  private async complete(
    entry: RunEntry,
    outcome: RunStatus = entry.status,
    known?: ScreenReference,
  ) {
    entry.outcome = outcome;
    entry.operationMessage = entry.message;
    const proof = this.d.settings().executionProof;
    const failed = outcome === 'failed';
    const keyStep = entry.kind === 'navigation' || entry.kind === 'test' || entry.precondition;
    const wantShot = proof === 'all' || failed || (proof === 'key' && !!keyStep);
    if (known) this.current = known;
    else if (failed) this.current = undefined;
    const [screen, image] = await Promise.all([
      failed || !this.current ? this.d.ctx.inspect().catch(() => undefined) : undefined,
      wantShot
        ? this.d.ctx.screenshot().catch((error) => String(error) as unknown as undefined)
        : undefined,
    ]);
    if (screen) {
      this.current = identifyScreen(screen, this.os, this.d.allNodes);
      if (failed) this.d.analyzer.failureScreens.set(entry.id, screen);
    }
    entry.screenAfter = this.current ?? (await this.observe());
    if (wantShot) {
      try {
        if (!image || !image.startsWith('data:image'))
          entry.screenshotError = image || 'Aucune image retournée par l’appareil';
        else entry.screenshot = await this.d.saveCapture(entry.id, image);
      } catch (error) {
        entry.screenshotError = String(error);
        entry.screenshot = undefined;
      }
    }
    entry.completedAt = new Date().toISOString();
    entry.sequence = this.report.entries.filter((e) => e.completedAt).length;
    this.d.publish();
  }

  /** Perform a step; a vanished action target gets one AI repair attempt (never for assertions). */
  private async perform(node: ScenarioNode, variant: Variant, entry: RunEntry) {
    const { ctx, abort, healer, settings } = this.d;
    try {
      await ctx.perform(variant, node.kind);
    } catch (error) {
      const healable =
        error instanceof StepError && (error.kind === 'missing' || error.kind === 'ambiguous');
      if (
        !healable ||
        node.kind === 'test' ||
        !healer ||
        settings().healing === 'off' ||
        this.heals >= MAX_HEALS ||
        abort.signal.aborted
      )
        throw error;
      this.d.publish();
      entry.message = this.d.t(
        'Sélecteur introuvable : réparation IA…',
        'Selector not found: AI repair…',
      );
      this.d.publish();
      const healed = await healer.heal({
        node,
        variant,
        os: this.os,
        screen: await ctx.inspect(),
        error: error.message,
        signal: abort.signal,
      });
      if (!healed) throw error;
      await ctx.perform(
        {
          ...variant,
          locator: healed.locator,
          fallbacks: [],
          timeoutMs: Math.min(variant.timeoutMs, 6000),
        },
        node.kind,
      );
      this.heals++;
      entry.healing = { from: variant.locator, to: healed.locator, reason: healed.reason };
    }
  }

  /* ---------- scenario preparation (start state) ---------- */
  private async prepare(node: ScenarioNode) {
    const { settings, abort, ctx, allNodes, report } = this.d;
    const mode = settings().executionPreparation;
    const target = startingTarget(node, this.os);
    if (mode === 'off' || !target) return;
    const signal = AbortSignal.any([
      abort.signal,
      AbortSignal.timeout(settings().creationTimeoutMinutes * 60000),
    ]);
    const snapshot: ScenarioNode = {
      id: randomUUID(),
      name: 'Préparation · ' + target.name,
      kind: 'scenario',
      preparation: true,
      description: '',
      tags: [],
      variants: {},
      children: [],
      preconditionId: null,
      childrenOnPreconditionFailure: false,
      blocking: true,
    };
    const recordStep = async (step: ScenarioNode) => {
      if (!snapshot.children.length) report.snapshot.push(snapshot);
      snapshot.children.push(step);
      const entry = this.add(step);
      entry.preparation = true;
      entry.screenBefore = await this.observe();
      try {
        await ctx.perform(step.variants[this.os]!, step.kind);
        if (step.kind === 'navigation' && step.screen)
          await waitForMarkers(
            (m) => ctx.markersPresent(m),
            step.screen,
            this.os,
            step.variants[this.os]!.timeoutMs,
            signal,
          );
        entry.status = 'passed';
        entry.message = this.d.t('Préparation de l’écran de départ', 'Preparing the start screen');
      } catch (error) {
        entry.status = signal.aborted ? 'cancelled' : 'failed';
        entry.message = String(error);
        throw error;
      } finally {
        await this.complete(entry);
        entry.finishedAt = new Date().toISOString();
        this.d.publish();
      }
    };
    try {
      await prepareStart({
        target,
        nodes: allNodes,
        platform: this.os,
        signal,
        perform: (v, k) => ctx.perform(v, k),
        execute: recordStep,
        restart: async () => {
          if (!this.d.application) throw new Error('Application à relancer non configurée');
          await ctx.ensureApplication(this.d.application, true);
        },
        explore:
          mode === 'ai' && this.d.recovery
            ? () =>
                this.d.recovery!.recover(
                  {
                    projectId: report.projectId,
                    deviceId: ctx.deviceId,
                    platform: this.os,
                    owner: ctx.owner,
                    target,
                    signal,
                  },
                  recordStep,
                )
            : undefined,
      });
    } finally {
      this.d.publish();
    }
  }

  /* ---------- tree walk ---------- */
  private async sequence(nodes: ScenarioNode[]): Promise<Outcome> {
    const { abort, t, settings } = this.d;
    let failed = false;
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];
      // Intentionally single-OS steps are neutral, not failures.
      if (node.platforms && !node.platforms.includes(this.os)) {
        this.markAll(
          [node],
          'na',
          t(
            `Non applicable sur ${this.os === 'ios' ? 'iOS' : 'Android'}`,
            `Not applicable on ${this.os === 'ios' ? 'iOS' : 'Android'}`,
          ),
        );
        this.d.publish();
        continue;
      }
      if (node.kind === 'scenario') this.startHint = node.startScreen;
      const entry = this.add(node);
      if (abort.signal.aborted) {
        Object.assign(entry, {
          status: 'cancelled',
          message: t('Exécution annulée', 'Run cancelled'),
          finishedAt: new Date().toISOString(),
        });
        this.d.publish();
        continue;
      }
      let allowed = true;
      if (node.preconditionId) allowed = await this.checkPrecondition(nodes[index - 1]);
      let ownFailure = false;
      let childrenAllowed = true;
      if (!allowed) {
        entry.status = 'skipped';
        entry.message = t('Précondition non satisfaite', 'Precondition not met');
      } else if (node.kind !== 'scenario') {
        const variant = node.variants[this.os];
        if (!variant) {
          // A gap to complete (e.g. the other OS was never explored): reported, never a failure.
          entry.status = 'skipped';
          entry.message = t(
            `Non configuré sur ${this.os === 'ios' ? 'iOS' : 'Android'} : à compléter`,
            `Not configured on ${this.os === 'ios' ? 'iOS' : 'Android'}: to complete`,
          );
          childrenAllowed = node.kind === 'test';
        } else {
          entry.screenBefore = await this.observe();
          let reached: ScreenReference | undefined;
          try {
            if (node.kind === 'navigation' && !node.screen?.variants[this.os])
              throw new Error(
                t(
                  'Identité de l’écran destination non configurée pour ' + this.os,
                  'Destination screen identity not configured for ' + this.os,
                ),
              );
            await this.perform(node, variant, entry);
            if (node.kind === 'navigation') {
              await waitForMarkers(
                (m) => this.d.ctx.markersPresent(m),
                node.screen!,
                this.os,
                variant.timeoutMs,
                abort.signal,
              );
              reached = {
                id: node.screen!.id,
                name: node.screen!.name,
                platform: this.os,
                identified: true,
              };
            }
            if (variant.operation === 'back' || variant.operation === 'swipe')
              this.current = undefined;
            entry.status = 'passed';
            entry.message =
              (node.kind === 'test'
                ? t('Vérification réussie', 'Check passed')
                : t('Action effectuée', 'Action done')) +
              (entry.healing
                ? t(' · sélecteur réparé par l’IA', ' · selector repaired by AI')
                : '');
          } catch (error) {
            ownFailure = failed = true;
            entry.status = abort.signal.aborted ? 'cancelled' : 'failed';
            entry.message = abort.signal.aborted
              ? t('Annulé', 'Cancelled')
              : String((error as Error).message ?? error);
            entry.analysisState = settings().analysisMode === 'off' ? 'off' : 'pending';
          }
          await this.complete(entry, entry.status, entry.status === 'passed' ? reached : undefined);
          if (entry.status === 'failed' && settings().analysisMode === 'automatic')
            this.d.startAnalysis(entry.id);
        }
      } else {
        entry.message = t('Préparation du scénario…', 'Preparing the scenario…');
        this.d.publish();
        try {
          await this.prepare(node);
          entry.message = t('Scénario en cours', 'Scenario running');
        } catch (error) {
          allowed = false;
          ownFailure = failed = true;
          entry.status = abort.signal.aborted ? 'cancelled' : 'failed';
          entry.message = String((error as Error).message ?? error);
          await this.complete(entry);
        }
      }
      let child: Outcome = { failed: false, halt: false };
      const run =
        (allowed || node.childrenOnPreconditionFailure) &&
        childrenAllowed &&
        !(ownFailure && (node.blocking || node.kind === 'scenario')) &&
        !abort.signal.aborted;
      if (run) child = await this.sequence(node.children);
      else
        this.markAll(
          node.children,
          abort.signal.aborted ? 'cancelled' : 'skipped',
          t('Parent non exécuté', 'Parent not executed'),
        );
      if (child.failed) {
        failed = true;
        if (entry.status !== 'skipped')
          Object.assign(entry, {
            status: 'failed',
            message: t(
              'Un ou plusieurs éléments enfants ont échoué',
              'One or more child steps failed',
            ),
          });
      }
      if (entry.status === 'running')
        Object.assign(entry, {
          status: 'passed',
          message: t('Scénario terminé', 'Scenario finished'),
        });
      entry.finishedAt = new Date().toISOString();
      this.d.publish();
      if ((ownFailure && node.blocking) || child.halt) {
        this.markAll(
          nodes.slice(index + 1),
          'blocked',
          t('Échec bloquant précédent', 'Previous blocking failure'),
        );
        this.d.publish();
        return { failed: true, halt: true };
      }
    }
    return { failed, halt: false };
  }

  private async checkPrecondition(test: ScenarioNode): Promise<boolean> {
    const guard = this.add(test, true);
    guard.screenBefore = await this.observe();
    let ok = true;
    try {
      const v = test.variants[this.os];
      if (!v)
        throw new Error(
          this.d.t(
            'Précondition non configurée pour ' + this.os,
            'Precondition not configured for ' + this.os,
          ),
        );
      await this.d.ctx.perform(v, 'test');
      guard.status = 'passed';
      guard.message = this.d.t('Précondition satisfaite', 'Precondition met');
    } catch (e) {
      ok = false;
      guard.status = 'skipped';
      guard.message =
        this.d.t('Précondition non satisfaite : ', 'Precondition not met: ') +
        String((e as Error).message ?? e);
    }
    await this.complete(
      guard,
      ok ? 'passed' : this.d.abort.signal.aborted ? 'cancelled' : 'failed',
    );
    guard.finishedAt = new Date().toISOString();
    this.d.publish();
    return ok;
  }
}
