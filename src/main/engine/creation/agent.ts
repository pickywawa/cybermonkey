import type { Settings } from '../../../shared/domain/settings.js';
import type { CreationReply, LiveEvent } from '../../../shared/ipc.js';
import type { AiHub } from '../../infra/ai/hub.js';
import type { Automation } from '../../infra/appium/automation.js';
import type { Devices } from '../../infra/devices/scanner.js';
import type { WorkspaceStore } from '../../infra/storage/workspace-store.js';
import { translator } from '../i18n.js';
import { CreationRun, type CreationInput } from './run.js';
import { StartRecoveryAgent } from './recovery.js';

/** Entry point of AI-assisted creation: one run per project, questions routed to the UI. */
export class CreationAgent {
  private active = new Map<string, { controller: AbortController; run: CreationRun }>();
  private questions = new Map<string, { id: string; resolve: (answer: string) => void }>();
  readonly recovery: StartRecoveryAgent;

  constructor(
    private deps: {
      store: WorkspaceStore;
      devices: Devices;
      automation: Automation;
      hub: AiHub;
      settings: () => Settings;
      live: (e: LiveEvent) => void;
    },
  ) {
    this.recovery = new StartRecoveryAgent(deps);
  }

  isActive(projectId: string) {
    return this.active.has(projectId);
  }
  cancel(projectId: string) {
    const entry = this.active.get(projectId);
    if (!entry) return;
    entry.run.cancelledByUser = true;
    entry.controller.abort();
  }
  answer(input: { projectId: string; questionId: string; answer: string }) {
    const pending = this.questions.get(input.projectId);
    if (!pending || pending.id !== input.questionId) throw new Error('Question expirée');
    pending.resolve(input.answer);
  }
  stop() {
    for (const id of [...this.active.keys()]) this.cancel(id);
  }

  async ask(input: CreationInput): Promise<CreationReply> {
    const { settings, store } = this.deps;
    if (this.active.has(input.projectId))
      throw new Error('Une demande est déjà en cours pour ce projet');
    if (!input.deviceIds.length)
      throw new Error(
        'Associez un appareil et explorez ses composants avant de générer un scénario.',
      );
    store.get(input.projectId);
    const controller = new AbortController();
    const total = settings().creationTimeoutMinutes * 60 * 1000;
    const timer = setTimeout(() => controller.abort(new Error('timeout')), total);
    const run = new CreationRun(
      {
        ...this.deps,
        recovery: this.recovery,
        t: translator(settings),
        ask: (projectId, questionId, question, variableName, signal) =>
          this.question(projectId, questionId, question, variableName, signal),
      },
      input,
      controller.signal,
      Date.now() + total * 0.8,
    );
    this.active.set(input.projectId, { controller, run });
    try {
      return await run.execute();
    } finally {
      clearTimeout(timer);
      this.questions.delete(input.projectId);
      this.active.delete(input.projectId);
    }
  }

  private question(
    projectId: string,
    questionId: string,
    question: string,
    variableName: string | undefined,
    signal: AbortSignal,
  ) {
    return new Promise<string>((resolve, reject) => {
      const abort = () => {
        this.questions.delete(projectId);
        reject(new Error('Exploration interrompue'));
      };
      this.questions.set(projectId, {
        id: questionId,
        resolve: (value) => {
          signal.removeEventListener('abort', abort);
          this.questions.delete(projectId);
          resolve(value);
        },
      });
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) return abort();
      this.deps.live({ type: 'ai-question', projectId, questionId, question, variableName });
    });
  }
}
