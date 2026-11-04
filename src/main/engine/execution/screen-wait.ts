import type { Screen } from '../../../shared/domain/devices.js';
import type { OS, ScenarioNode, ScreenDefinition } from '../../../shared/domain/scenario.js';
import {
  identifyScreen,
  isUnstableLabel,
  observedDefinition,
} from '../../../shared/domain/screens.js';
import type { Locator } from '../../../shared/domain/scenario.js';

/** Wait until the destination screen's markers are all visible, and that it is not ambiguous. */
export async function waitForScreenDefinition(
  inspect: () => Promise<Screen>,
  definition: ScreenDefinition,
  platform: OS,
  nodes: ScenarioNode[],
  timeoutMs: number,
  signal: AbortSignal,
) {
  const deadline = Date.now() + timeoutMs;
  do {
    signal.throwIfAborted();
    const screen = await inspect();
    if (observedDefinition(definition, screen, platform)) {
      const identity = identifyScreen(screen, platform, nodes);
      if (!identity.identified || identity.id !== definition.id)
        throw new Error('Écran destination ambigu : ' + definition.name);
      return identity;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise<void>((resolve, reject) => {
      const abort = () => (clearTimeout(timer), reject(signal.reason));
      const timer = setTimeout(
        () => (signal.removeEventListener('abort', abort), resolve()),
        Math.min(200, remaining),
      );
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) (signal.removeEventListener('abort', abort), abort());
    });
  } while (Date.now() <= deadline);
  throw new Error('Écran destination non confirmé : ' + definition.name);
}

/**
 * Fast screen-change detection: ask the device whether each marker resolves to exactly one element (a few small
 * requests, no page-source download) and move on the instant they all do. Checks immediately, then every ~80 ms.
 */
export async function waitForMarkers(
  present: (markers: Locator[]) => Promise<boolean>,
  definition: ScreenDefinition,
  platform: OS,
  timeoutMs: number,
  signal: AbortSignal,
) {
  const all = definition.variants[platform]?.markers ?? [];
  const stable = all.filter((m) => !isUnstableLabel(m.value));
  const markers = stable.length ? stable : all;
  const deadline = Date.now() + timeoutMs;
  do {
    signal.throwIfAborted();
    if (await present(markers)) return;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(80, remaining)));
  } while (Date.now() <= deadline);
  throw new Error('Écran destination non confirmé : ' + definition.name);
}
