import {
  alertChoiceJsonSchema,
  alertChoiceSchema,
  interruptionJsonSchema,
  interruptionSchema,
} from '../../../shared/ai/protocol.js';
import type { Settings } from '../../../shared/domain/settings.js';
import type { AiHub } from '../../infra/ai/hub.js';
import { askStructured } from '../../infra/ai/provider.js';
import { ALERT_SYSTEM, INTERRUPTION_SYSTEM } from '../prompts.js';
import { describeScreen, type InterruptionAdvisor } from './interruptions.js';

/** The AI's part in recovering from interruptions. Best effort: any problem means "no advice", never an error. */
export class AiInterruptionAdvisor implements InterruptionAdvisor {
  constructor(
    private hub: AiHub,
    private settings: () => Settings,
  ) {}

  async alertButton(input: Parameters<InterruptionAdvisor['alertButton']>[0]) {
    if (!(await this.hub.isReady())) return null;
    const prompt = JSON.stringify({
      language: this.settings().language,
      dialog: input.text,
      buttons: input.buttons,
      step: input.step,
    });
    try {
      const a = await this.hub.converse(ALERT_SYSTEM, input.signal, (c) =>
        askStructured(c, prompt, alertChoiceSchema, alertChoiceJsonSchema, { timeoutMs: 45000 }),
      );
      return a.button;
    } catch {
      input.signal.throwIfAborted();
      return null;
    }
  }

  async interruption(input: Parameters<InterruptionAdvisor['interruption']>[0]) {
    if (!(await this.hub.isReady())) return null;
    const prompt = JSON.stringify({
      language: this.settings().language,
      step: { name: input.step, intent: input.description },
      error: input.error,
      knownHandlers: input.handlers,
      screen: describeScreen(input.screen),
    });
    try {
      return await this.hub.converse(INTERRUPTION_SYSTEM, input.signal, (c) =>
        askStructured(c, prompt, interruptionSchema, interruptionJsonSchema, { timeoutMs: 60000 }),
      );
    } catch {
      input.signal.throwIfAborted();
      return null;
    }
  }
}
