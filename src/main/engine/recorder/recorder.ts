import { compactScreen, screenFingerprint, type Screen } from '../../../shared/domain/devices.js';
import { tapResolutionJsonSchema, tapResolutionSchema } from '../../../shared/ai/protocol.js';
import type { RecordedStep } from '../../../shared/domain/recording.js';
import type { LiveEvent } from '../../../shared/ipc.js';
import type { Settings } from '../../../shared/domain/settings.js';
import type { AiHub } from '../../infra/ai/hub.js';
import { askStructured } from '../../infra/ai/provider.js';
import type { Automation } from '../../infra/appium/automation.js';
import type { Devices } from '../../infra/devices/scanner.js';
import type { WorkspaceStore } from '../../infra/storage/workspace-store.js';
import { translator } from '../i18n.js';
import { TAP_SYSTEM } from '../prompts.js';
import { inferStep } from './inference.js';

interface Session {
  deviceId: string;
  owner: string;
  withAssertions: boolean;
  steps: RecordedStep[];
  stable: Screen;
  pending?: { since: number; latest: Screen };
  history: Screen[];
  timer?: ReturnType<typeof setTimeout>;
  errors: number;
  stopped: boolean;
}
const POLL_MS = 1000;
const SETTLE_MS = 1300;

/**
 * Records a scenario while the user drives the phone by hand: the screen is polled, every settled
 * change is turned into a step (by deterministic inference, refined by the AI for ambiguous taps).
 */
export class Recorder {
  private sessions = new Map<string, Session>();
  constructor(
    private deps: {
      store: WorkspaceStore;
      devices: Devices;
      automation: Automation;
      hub: AiHub;
      settings: () => Settings;
      live: (e: LiveEvent) => void;
    },
  ) {}

  private emit(projectId: string, s: Session) {
    this.deps.live({
      type: 'recorder',
      projectId,
      steps: s.steps.map((x) => ({ ...x })),
      running: !s.stopped,
    });
  }
  status(projectId: string) {
    const s = this.sessions.get(projectId);
    return { running: !!s && !s.stopped, steps: s?.steps ?? [] };
  }

  async start(input: { projectId: string; deviceId: string; withAssertions: boolean }) {
    const { automation, devices, store } = this.deps;
    if (this.sessions.get(input.projectId) && !this.sessions.get(input.projectId)!.stopped)
      throw new Error('Un enregistrement est déjà en cours');
    const device = devices.known.get(input.deviceId);
    if (!device || device.status !== 'ready') throw new Error('Appareil non connecté');
    const project = store.get(input.projectId);
    if (!project.platforms.includes(device.platform))
      throw new Error('Le projet ne cible pas cet OS');
    const owner = 'rec:' + input.projectId;
    automation.acquire([input.deviceId], owner);
    try {
      const app = project.applications?.[device.platform];
      if (app) await automation.ensureApplication(input.deviceId, app, owner, false);
      const stable = await automation.inspect(input.deviceId, owner);
      const session: Session = {
        deviceId: input.deviceId,
        owner,
        withAssertions: input.withAssertions,
        steps: [],
        stable,
        history: [stable],
        errors: 0,
        stopped: false,
      };
      this.sessions.set(input.projectId, session);
      this.emit(input.projectId, session);
      this.schedule(input.projectId, session);
    } catch (error) {
      automation.release(owner);
      throw error;
    }
  }

  private schedule(projectId: string, s: Session) {
    s.timer = setTimeout(() => void this.tick(projectId, s), POLL_MS);
  }
  private async tick(projectId: string, s: Session) {
    if (s.stopped) return;
    try {
      const screen = await this.deps.automation.inspect(s.deviceId, s.owner);
      s.errors = 0;
      const changed = screenFingerprint(screen) !== screenFingerprint(s.stable);
      if (changed)
        s.pending = {
          since:
            s.pending && screenFingerprint(s.pending.latest) === screenFingerprint(screen)
              ? s.pending.since
              : Date.now(),
          latest: screen,
        };
      else s.pending = undefined;
      if (s.pending && Date.now() - s.pending.since >= SETTLE_MS)
        await this.commit(projectId, s, s.pending.latest);
    } catch {
      if (++s.errors >= 6) {
        s.stopped = true;
        this.deps.automation.release(s.owner);
        this.emit(projectId, s);
        return;
      }
    }
    if (!s.stopped) this.schedule(projectId, s);
  }

  private async commit(projectId: string, s: Session, after: Screen) {
    const { store, devices } = this.deps;
    const os = devices.known.get(s.deviceId)!.platform;
    const t = translator(this.deps.settings);
    const inferred = inferStep(s.stable, after, os, store.get(projectId).nodes, t, s.history);
    const before = s.stable;
    s.stable = after;
    s.pending = undefined;
    s.history.push(after);
    if (s.history.length > 12) s.history.shift();
    if (!inferred) return;
    if (!s.withAssertions) delete inferred.assertion;
    const step: RecordedStep = {
      ...inferred,
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      platform: os,
      deviceId: s.deviceId,
    };
    s.steps.push(step);
    this.emit(projectId, s);
    if (step.confidence === 'low') void this.refine(projectId, s, step, before, after);
  }

  /** Ask the AI which component explains an ambiguous change; silently keep the candidates otherwise. */
  private async refine(
    projectId: string,
    s: Session,
    step: RecordedStep,
    before: Screen,
    after: Screen,
  ) {
    const { hub, settings } = this.deps;
    try {
      if (!(await hub.isReady())) return;
      const prompt = JSON.stringify({
        language: settings().language,
        before: compactScreen(before, 100),
        after: compactScreen(after, 100),
        candidates: step.candidates?.map((c) => c.hint),
      });
      const answer = await hub.converse(TAP_SYSTEM, AbortSignal.timeout(90000), (c) =>
        askStructured(c, prompt, tapResolutionSchema, tapResolutionJsonSchema, {
          timeoutMs: 60000,
        }),
      );
      const component = before.components.find((c) => c.id === answer.componentId && c.locator);
      if (!component?.locator || answer.confidence === 'low') return;
      Object.assign(step, {
        operation: answer.operation,
        locator: component.locator,
        hint: component.label || component.text,
        name: answer.stepName,
        value: answer.value ?? step.value,
        source: 'ai',
        confidence: answer.confidence,
        candidates: undefined,
      });
      this.emit(projectId, s);
    } catch {
      /* the deterministic guess and its candidates remain */
    }
  }

  discard(projectId: string, stepId: string) {
    const s = this.sessions.get(projectId);
    if (!s) return;
    s.steps = s.steps.filter((x) => x.id !== stepId);
    this.emit(projectId, s);
  }
  stop(projectId: string): RecordedStep[] {
    const s = this.sessions.get(projectId);
    if (!s) return [];
    clearTimeout(s.timer);
    if (!s.stopped) this.deps.automation.release(s.owner);
    s.stopped = true;
    this.emit(projectId, s);
    this.sessions.delete(projectId);
    return s.steps;
  }
  stopAll() {
    for (const id of [...this.sessions.keys()]) this.stop(id);
  }
}
