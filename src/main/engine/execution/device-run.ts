import { randomUUID } from 'node:crypto';
import { outcomeOf } from '../../../shared/domain/campaign.js';
import { screenFingerprint, type Screen } from '../../../shared/domain/devices.js';
import type {
  RunEntry,
  RunReport,
  RunStatus,
  ScreenReference,
} from '../../../shared/domain/report.js';
import {
  datasetRowLabel,
  flatten,
  makeNode,
  makeVariant,
  SCREEN_CHANGING_OPERATIONS,
  type OS,
  type ScenarioNode,
  type Variant,
} from '../../../shared/domain/scenario.js';
import {
  identifyScreen,
  isUnstableLabel,
  screenDefinitions,
} from '../../../shared/domain/screens.js';
import type { Settings } from '../../../shared/domain/settings.js';
import { StepError } from '../../infra/appium/operations.js';
import { summarizeDeviceLog } from '../../infra/devices/device-log.js';
import type { DeviceContext } from '../device-context.js';
import type { Translate } from '../i18n.js';
import type { StartRecoveryAgent } from '../creation/recovery.js';
import type { Analyzer } from './analysis.js';
import type { Healer } from './healing.js';
import { prepareStart, screenTarget, startingTarget, type StartTarget } from './start-state.js';
import { InterruptionGuard, type InterruptionAdvisor } from './interruptions.js';
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
  saveVideo?: (entryId: string, video: string) => Promise<string>;
  application?: string;
  restartApplication: boolean;
  /** Overrides the start-screen preparation mode for this run (MCP asks for at least existing routes). */
  preparation?: Settings['executionPreparation'];
  healer?: Healer;
  analyzer: Analyzer;
  recovery?: StartRecoveryAgent;
  advisor?: InterruptionAdvisor;
  startAnalysis: (entryId: string) => void;
}
interface Outcome {
  failed: boolean;
  halt: boolean;
}
const MAX_HEALS = 15;
/** Interruption handling is bounded: a few rounds per step, a dozen per run. */
const MAX_RECOVERY_ROUNDS = 3;
const MAX_INTERRUPTIONS_PER_RUN = 12;
/** Second attempts are short: a real failure should not cost twice its timeout. */
const RETRY_TIMEOUT_MS = 4000;
/** How long a destination screen gets to appear before we check whether the tap was lost. */
const CONFIRM_FIRST_MS = 4000;
/** Pause between the two inspections that prove the screen is idle. */
const IDLE_CHECK_MS = 400;

/** Executes the scenario tree on ONE device, producing one report entry per step with proof (screens, capture). */
export class DeviceRun {
  private os: OS;
  private heals = 0;
  constructor(private d: DeviceRunDeps) {
    this.os = d.ctx.platform;
  }

  async run(roots: ScenarioNode[]) {
    const { ctx, application } = this.d;
    if (application) {
      await ctx.ensureApplication(application, this.d.restartApplication);
      if (this.d.restartApplication) await this.settleApp();
    }
    for (const root of roots) {
      const rows = root.dataset?.rows;
      if (!rows?.length || root.preparation) {
        await this.recorded(root, () => this.sequence([root]));
        continue;
      }
      // Data-driven scenario: one independent pass per row, the app restarted in between.
      for (let i = 0; i < rows.length && !this.d.abort.signal.aborted; i++) {
        ctx.clearVariables();
        ctx.setVariables(rows[i]);
        this.iteration =
          rows.length > 1
            ? { index: i + 1, total: rows.length, label: datasetRowLabel(rows[i]) }
            : undefined;
        if (i > 0 && application) {
          await ctx.ensureApplication(application, true);
          await this.settleApp();
        }
        this.current = undefined;
        await this.recorded(root, () => this.sequence([root]));
      }
      this.iteration = undefined;
      ctx.clearVariables();
    }
  }
  /**
   * Right after a relaunch the app is still drawing its first screens (splash, animations): a tap sent now is silently
   * lost, and the run then waits its whole timeout for a screen that will never come. Wait until the screen stops
   * changing (at most ~2.5 s; a device that cannot be inspected is not an error here).
   */
  private async settleApp() {
    const { ctx, abort } = this.d;
    let previous: string | undefined;
    for (let i = 0; i < 8 && !abort.signal.aborted; i++) {
      let now: string | undefined;
      try {
        now = screenFingerprint(await ctx.inspect());
      } catch {
        return;
      }
      if (now === previous) return;
      previous = now;
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  /**
   * Play one scenario pass while recording the screen, and keep the video only if something failed in it ("show me what
   * happened", never a pile of videos of passing runs). Recording problems never affect the run.
   */
  private async recorded(root: ScenarioNode, play: () => Promise<unknown>) {
    const { ctx, settings } = this.d;
    const record =
      settings().executionVideo === 'failures' && !root.preparation && !!this.d.saveVideo
        ? await ctx.startRecording().catch(() => false)
        : false;
    const from = this.report.entries.length;
    const startedAt = Date.now();
    try {
      await play();
    } finally {
      if (record) await this.keepVideoIfFailed(from, startedAt);
    }
  }
  private async keepVideoIfFailed(from: number, startedAt: number) {
    let video: string | undefined;
    try {
      video = await this.d.ctx.stopRecording();
    } catch {
      return;
    }
    const entries = this.report.entries.slice(from);
    const failed = entries.filter((e) => e.kind !== 'scenario' && outcomeOf(e) === 'failed');
    if (!video || !failed.length) return;
    try {
      const ref = await this.d.saveVideo!(failed[0].id, video);
      for (const e of [...failed, ...entries.filter((x) => x.kind === 'scenario').slice(0, 1)]) {
        e.video = ref;
        e.videoAt = Math.max(0, Math.round((Date.parse(e.startedAt) - startedAt) / 1000));
      }
      this.d.publish();
    } catch {
      /* too large or unwritable: the failure itself is still fully reported */
    }
  }
  private iteration?: RunEntry['iteration'];
  /** Set while an interruption handler runs: its entries are tagged so they never count as test results. */
  private interruptionName?: string;
  private guard?: InterruptionGuard;
  private interruptionsHandled = 0;
  private callDepth = 0;
  /** Steps that run under a node: its own children, or the steps of the scenario it calls. */
  private childrenOf(node: ScenarioNode): ScenarioNode[] | undefined {
    if (!node.call) return node.children;
    return this.d.allNodes.find((n) => n.id === node.call && n.kind === 'scenario')?.children;
  }
  /** Evaluates the run condition of a node on this OS. */
  private async condition(node: ScenarioNode): Promise<{ met: boolean; reason: string }> {
    if (!node.when) return { met: true, reason: '' };
    const cond = node.when[this.os];
    if (!cond)
      return {
        met: false,
        reason: this.d.t(
          `Condition non configurée sur ${this.os === 'ios' ? 'iOS' : 'Android'} : à compléter`,
          `Condition not configured on ${this.os === 'ios' ? 'iOS' : 'Android'}: to complete`,
        ),
      };
    try {
      await this.d.ctx.perform({ ...cond, operation: 'assert' }, 'test');
      return { met: true, reason: '' };
    } catch (error) {
      // "Not there" is an answer; a broken device or a malformed condition is a failure to report.
      if (error instanceof StepError && (error.kind === 'missing' || error.kind === 'assertion'))
        return {
          met: false,
          reason: this.d.t('Condition non remplie : ', 'Condition not met: ') + error.message,
        };
      throw error;
    }
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
      ...(this.iteration ? { iteration: this.iteration } : {}),
      ...(this.interruptionName ? { interruption: this.interruptionName } : {}),
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
      ...(this.iteration ? { iteration: this.iteration } : {}),
      ...(this.interruptionName ? { interruption: this.interruptionName } : {}),
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
  private async perform(
    node: ScenarioNode,
    variant: Variant,
    entry: RunEntry,
  ): Promise<string | void> {
    const { ctx, abort, healer, settings } = this.d;
    try {
      return await ctx.perform(variant, node.kind);
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
      const out = await ctx.perform(
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
      return out;
    }
  }

  /**
   * One more attempt for a step that failed in a way that proves it did nothing (component not found, check not met):
   * a slow render or an animation is the usual cause. Never after an error that may have happened mid-gesture, and never
   * for steps with an effect we cannot see (scroll, links, alerts, app lifecycle). Passing the second time marks the
   * step unstable instead of hiding the problem.
   */
  private async performWithRetry(
    node: ScenarioNode,
    variant: Variant,
    entry: RunEntry,
  ): Promise<string | void> {
    try {
      return await this.perform(node, variant, entry);
    } catch (error) {
      const { abort, settings, t } = this.d;
      const retryable =
        settings().retryFailedSteps &&
        !abort.signal.aborted &&
        error instanceof StepError &&
        ['missing', 'ambiguous', 'assertion'].includes(error.kind) &&
        (node.kind === 'test' ||
          ['tap', 'type', 'clear', 'longpress', 'doubletap', 'capture'].includes(
            variant.operation,
          ));
      if (!retryable) throw error;
      entry.retried = true;
      entry.message = t('Nouvel essai…', 'Trying again…');
      this.d.publish();
      this.current = undefined;
      try {
        const out = await this.perform(
          node,
          { ...variant, timeoutMs: Math.min(variant.timeoutMs, RETRY_TIMEOUT_MS) },
          entry,
        );
        entry.flaky = true;
        return out;
      } catch (second) {
        if (second instanceof StepError)
          throw new StepError(
            second.kind,
            second.message + t(' (après 2 essais)', ' (after 2 attempts)'),
          );
        throw second;
      }
    }
  }

  /* ---------- interruptions (popups, expired session, crash…) ---------- */
  private interruptionGuard(): InterruptionGuard {
    return (this.guard ??= new InterruptionGuard({
      ctx: this.d.ctx,
      os: this.os,
      application: this.d.application,
      handlers: () =>
        this.d.allNodes.filter(
          (n) =>
            n.handler &&
            (!n.platforms || n.platforms.includes(this.os)) &&
            n.handler.when.variants[this.os]?.markers.length,
        ),
      mode: () => this.d.settings().interruptionMode,
      advisor: this.d.advisor,
      runHandler: (h) => this.runHandler(h),
      afterRelaunch: () => this.settleApp(),
      signal: this.d.abort.signal,
      t: this.d.t,
    }));
  }
  /**
   * Run a step; when it fails because something got in the way (a popup, an expired session, a crash…), deal with that
   * and run it again — a few rounds at most. The original failure is what gets reported when nothing helped.
   */
  private async withRecovery<T>(
    node: ScenarioNode,
    variant: Variant,
    entry: RunEntry,
    attempt: () => Promise<T>,
  ): Promise<T> {
    const { settings, abort } = this.d;
    for (let round = 0; ; round++) {
      try {
        return await attempt();
      } catch (error) {
        const recoverable =
          round < MAX_RECOVERY_ROUNDS &&
          this.interruptionsHandled < MAX_INTERRUPTIONS_PER_RUN &&
          !this.interruptionName && // never inside a handler: it would call itself
          !abort.signal.aborted &&
          settings().interruptionMode !== 'off' &&
          !(error instanceof StepError && ['invalid', 'device'].includes(error.kind));
        if (!recoverable) throw error;
        const result = await this.interruptionGuard()
          .handle({
            step: node.name,
            description: node.description || variant.hint,
            error: String((error as Error).message ?? error),
            operation: variant.operation,
          })
          .catch((e) => {
            abort.signal.throwIfAborted();
            throw e;
          });
        if (!result) throw error;
        this.interruptionsHandled++;
        entry.interruptions = [...(entry.interruptions ?? []), ...result.events];
        entry.message = this.d.t(
          'Imprévu géré : nouvel essai…',
          'Interruption handled: trying again…',
        );
        this.d.publish();
        this.current = undefined;
        if (!result.handled) throw error;
        if (result.resume === 'return' && !(await this.returnTo(entry))) {
          entry.interruptions.push({
            kind: 'return',
            name: this.d.t(
              `Retour à l’écran « ${entry.screenBefore?.name ?? '?'} » impossible`,
              `Could not get back to “${entry.screenBefore?.name ?? '?'}”`,
            ),
            ok: false,
          });
          throw error;
        }
      }
    }
  }
  /** Back to the screen a step started from (known navigations, deep link), e.g. after logging in again. */
  private async returnTo(entry: RunEntry): Promise<boolean> {
    const ref = entry.screenBefore;
    // Nothing known about where the step was: stay where the handler left the app and just replay it.
    if (!ref?.identified) return true;
    const definition = screenDefinitions(this.d.allNodes).get(ref.id);
    const target = definition && screenTarget(definition, this.os);
    if (!target) return true;
    try {
      await this.prepareTarget(target, true);
      this.current = undefined;
      entry.interruptions?.push({
        kind: 'return',
        name: this.d.t(`Retour à l’écran « ${ref.name} »`, `Back on “${ref.name}”`),
        ok: true,
      });
      return true;
    } catch {
      this.d.abort.signal.throwIfAborted();
      return false;
    }
  }
  /** Play an interruption handler scenario in place; its entries are tagged with the handler's name. */
  private async runHandler(handler: ScenarioNode): Promise<boolean> {
    const saved = { hint: this.startHint, iteration: this.iteration };
    this.interruptionName = handler.name;
    try {
      const copy = structuredClone({ ...handler, dataset: undefined, startScreen: undefined });
      return !(await this.sequence([copy])).failed;
    } finally {
      this.interruptionName = undefined;
      this.startHint = saved.hint;
      this.iteration = saved.iteration;
      this.current = undefined;
    }
  }

  /** What the device said around a failure: the app's own lines, system errors, and signs of network trouble. */
  private async attachLog(entry: RunEntry) {
    try {
      const { entries, pid } = await this.d.ctx.deviceLog();
      if (!entries.length) return;
      const s = summarizeDeviceLog(entries, {
        application: this.d.application,
        pid,
        language: this.d.settings().language,
      });
      if (s.lines.length) entry.deviceLog = s.lines.join('\n').slice(-6000);
      if (s.networkHints.length) entry.networkHints = s.networkHints;
      this.d.publish();
    } catch {
      /* the log is a bonus: a failure to read it never changes the result */
    }
  }

  /**
   * Wait for the destination screen. If it does not show up quickly and the app sits idle on a screen that still offers
   * the tapped component, the tap was lost (the app was still starting or animating when it was sent): repeat it once.
   * Any sign of activity means the app is working on it: never tap again, keep waiting out the timeout.
   */
  private async confirmDestination(node: ScenarioNode, variant: Variant, entry: RunEntry) {
    const { ctx, abort, settings } = this.d;
    const wait = (ms: number) =>
      waitForMarkers((m) => ctx.markersPresent(m), node.screen!, this.os, ms, abort.signal);
    const canRetap = settings().retryFailedSteps && variant.operation === 'tap';
    if (!canRetap) return wait(variant.timeoutMs);
    const first = Math.min(variant.timeoutMs, CONFIRM_FIRST_MS);
    try {
      return await wait(first);
    } catch (error) {
      if (abort.signal.aborted) throw error;
      // Did the tap do nothing? Only when the screen is idle (two identical inspections apart) and the tapped
      // component is still there and enabled. A spinner, a disabled button or any other reaction means "wait".
      let lost = false;
      try {
        const a = await ctx.inspect();
        await new Promise((r) => setTimeout(r, IDLE_CHECK_MS));
        const b = await ctx.inspect();
        const targets = [variant.locator, ...variant.fallbacks].filter(Boolean);
        const still = b.components.some(
          (c) =>
            c.enabled !== false &&
            targets.some((l) => l && c.locator?.using === l.using && c.locator?.value === l.value),
        );
        lost = still && screenFingerprint(a) === screenFingerprint(b);
      } catch {
        /* cannot tell: do not tap again */
      }
      if (!lost) return wait(Math.max(variant.timeoutMs - first, 1000));
      entry.retried = true;
      entry.message = this.d.t('Appui perdu : nouvel essai…', 'Tap lost: trying again…');
      this.d.publish();
      this.current = undefined;
      await this.perform(
        node,
        { ...variant, timeoutMs: Math.min(variant.timeoutMs, RETRY_TIMEOUT_MS) },
        entry,
      );
      await wait(variant.timeoutMs);
      entry.flaky = true;
    }
  }

  /* ---------- scenario preparation (start state) ---------- */
  private async prepare(node: ScenarioNode) {
    const target = startingTarget(node, this.os);
    if (target) await this.prepareTarget(target);
  }
  /**
   * Get the app to a screen: deep link, then known routes, then (optionally) the AI. `force` makes it work even when
   * start-screen preparation is switched off (coming back after an interruption is not optional).
   */
  private async prepareTarget(target: StartTarget, force = false) {
    const { settings, abort, ctx, allNodes, report } = this.d;
    const configured = this.d.preparation ?? settings().executionPreparation;
    const mode = force && configured === 'off' ? 'existing' : configured;
    if (mode === 'off') return;
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
        openLink: (url) =>
          recordStep({
            ...makeNode('action', 'Lien profond · ' + url.slice(0, 80), [this.os]),
            variants: {
              [this.os]: makeVariant({ operation: 'deeplink', value: url, timeoutMs: 10000 }),
            },
          }),
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
      let condition: { met: boolean; reason: string } = { met: true, reason: '' };
      if (allowed && node.when) {
        try {
          condition = await this.condition(node);
        } catch (error) {
          condition = { met: true, reason: '' };
          allowed = false;
          ownFailure = failed = true;
          entry.status = abort.signal.aborted ? 'cancelled' : 'failed';
          entry.message = String((error as Error).message ?? error);
          await this.complete(entry, entry.status);
        }
      }
      if (!allowed && entry.status === 'running') {
        entry.status = 'skipped';
        entry.message = t('Précondition non satisfaite', 'Precondition not met');
      } else if (!allowed) {
        /* the condition itself failed: already reported */
      } else if (!condition.met) {
        entry.status = 'skipped';
        entry.message = condition.reason;
      } else if (node.call) {
        const called = this.d.allNodes.find((n) => n.id === node.call && n.kind === 'scenario');
        if (!called || this.callDepth >= 10) {
          ownFailure = failed = true;
          entry.status = 'failed';
          entry.message = called
            ? t('Appels de sous-scénarios trop imbriqués', 'Sub-scenario calls nested too deeply')
            : t('Sous-scénario introuvable', 'Sub-scenario not found');
          await this.complete(entry, entry.status);
        } else
          entry.message = t(`Sous-scénario « ${called.name} »`, `Sub-scenario “${called.name}”`);
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
          const observeStart = performance.now();
          entry.screenBefore = await this.observe();
          const observeMs = performance.now() - observeStart;
          let reached: ScreenReference | undefined;
          const performStart = performance.now();
          // A tap that leads nowhere is only safe to repeat when we can prove the app did not move: remember where it was.
          const before =
            node.kind === 'navigation' &&
            variant.operation === 'tap' &&
            !entry.screenBefore?.identified
              ? await this.d.ctx.inspect().catch(() => undefined)
              : undefined;
          try {
            if (node.kind === 'navigation' && !node.screen?.variants[this.os])
              throw new Error(
                t(
                  'Identité de l’écran destination non configurée pour ' + this.os,
                  'Destination screen identity not configured for ' + this.os,
                ),
              );
            const captured = await this.withRecovery(node, variant, entry, async () => {
              const out = await this.performWithRetry(node, variant, entry);
              if (node.kind === 'navigation') await this.confirmDestination(node, variant, entry);
              return out;
            });
            if (node.kind === 'navigation') {
              reached = {
                id: node.screen!.id,
                name: node.screen!.name,
                platform: this.os,
                identified: true,
              };
            }
            if (SCREEN_CHANGING_OPERATIONS.includes(variant.operation)) this.current = undefined;
            entry.status = 'passed';
            entry.message =
              (node.kind === 'test'
                ? t('Vérification réussie', 'Check passed')
                : t('Action effectuée', 'Action done')) +
              (entry.healing
                ? t(' · sélecteur réparé par l’IA', ' · selector repaired by AI')
                : '') +
              (entry.flaky
                ? t(' · réussi au 2e essai (instable)', ' · passed on the 2nd attempt (unstable)')
                : '') +
              (entry.interruptions?.length
                ? t(
                    ` · imprévu géré : ${entry.interruptions.map((e) => e.name).join(' ; ')}`.slice(
                      0,
                      220,
                    ),
                    ` · interruption handled: ${entry.interruptions.map((e) => e.name).join('; ')}`.slice(
                      0,
                      220,
                    ),
                  )
                : '') +
              (typeof captured === 'string'
                ? t(
                    ` · ${variant.value} = « ${captured.slice(0, 80)} »`,
                    ` · ${variant.value} = “${captured.slice(0, 80)}”`,
                  )
                : '');
          } catch (error) {
            ownFailure = failed = true;
            entry.status = abort.signal.aborted ? 'cancelled' : 'failed';
            entry.message = abort.signal.aborted
              ? t('Annulé', 'Cancelled')
              : String((error as Error).message ?? error);
            entry.analysisState = settings().analysisMode === 'off' ? 'off' : 'pending';
          }
          entry.performMs = Math.round(performance.now() - performStart);
          const proofStart = performance.now();
          await this.complete(entry, entry.status, entry.status === 'passed' ? reached : undefined);
          entry.proofMs = Math.round(observeMs + performance.now() - proofStart);
          if (entry.status === 'failed') await this.attachLog(entry);
          if (entry.status === 'failed' && settings().analysisMode === 'automatic')
            this.d.startAnalysis(entry.id);
        }
      } else {
        entry.message = t('Préparation du scénario…', 'Preparing the scenario…');
        this.d.publish();
        try {
          if (!node.handler) await this.prepare(node);
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
      const kids = this.childrenOf(node) ?? [];
      const run =
        (allowed || node.childrenOnPreconditionFailure) &&
        condition.met &&
        childrenAllowed &&
        !(ownFailure && (node.blocking || node.kind === 'scenario' || !!node.call)) &&
        !abort.signal.aborted;
      if (run) {
        if (node.call) this.callDepth++;
        try {
          child = await this.sequence(kids);
        } finally {
          if (node.call) this.callDepth--;
        }
      } else
        this.markAll(
          kids,
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
