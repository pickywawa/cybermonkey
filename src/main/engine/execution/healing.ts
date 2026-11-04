import { compactScreen, type Screen } from '../../../shared/domain/devices.js';
import { healingJsonSchema, healingSchema } from '../../../shared/ai/protocol.js';
import type { Locator, OS, ScenarioNode, Variant } from '../../../shared/domain/scenario.js';
import type { Settings } from '../../../shared/domain/settings.js';
import type { AiHub } from '../../infra/ai/hub.js';
import { askStructured } from '../../infra/ai/provider.js';
import { HEALING_SYSTEM } from '../prompts.js';

const same = (a?: Locator, b?: Locator) => !!a && !!b && a.using === b.using && a.value === b.value;

/**
 * Self-healing for broken selectors. It only ever repairs actions/navigation (never assertions:
 * silently re-pointing a check could hide a real regression) and every repair is recorded in the report.
 */
export class Healer {
  constructor(
    private hub: AiHub,
    private settings: () => Settings,
  ) {}

  async heal(input: {
    node: ScenarioNode;
    variant: Variant;
    os: OS;
    screen: Screen;
    error: string;
    signal: AbortSignal;
  }): Promise<{ locator: Locator; reason: string } | null> {
    if (this.settings().healing === 'off' || !(await this.hub.isReady())) return null;
    const { node, variant, os, screen, error, signal } = input;
    const candidates = screen.components.filter(
      (c) => c.locator && (!c.password || variant.operation === 'type'),
    );
    if (!candidates.length) return null;
    const prompt = JSON.stringify({
      step: {
        name: node.name,
        description: node.description,
        kind: node.kind,
        operation: variant.operation,
        value: variant.operation === 'type' ? '(hidden)' : variant.value,
        hint: variant.hint,
        originalLocator: variant.locator,
      },
      platform: os,
      error,
      screen: compactScreen({ ...screen, components: candidates }, 120),
    });
    try {
      const answer = await this.hub.converse(HEALING_SYSTEM, signal, (c) =>
        askStructured(c, prompt, healingSchema, healingJsonSchema, { timeoutMs: 60000 }),
      );
      if (!answer.componentId || answer.confidence === 'low') return null;
      const target = candidates.find((c) => c.id === answer.componentId);
      if (!target?.locator || same(target.locator, variant.locator)) return null;
      return { locator: target.locator, reason: answer.reason };
    } catch {
      signal.throwIfAborted();
      return null; // healing is best-effort: the original failure stays the reported one
    }
  }
}
