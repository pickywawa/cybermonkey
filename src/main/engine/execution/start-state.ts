import {
  flatten,
  type OS,
  type ScenarioNode,
  type Variant,
} from '../../../shared/domain/scenario.js';

export type StartTarget = { name: string; checks: Variant[] };
export type StartRecovery = {
  projectId: string;
  deviceId: string;
  platform: OS;
  owner: string;
  target: StartTarget;
  signal: AbortSignal;
};
type Perform = (variant: Variant, kind: ScenarioNode['kind']) => Promise<void>;

const assertVisible = (locator: NonNullable<Variant['locator']>): Variant => ({
  locator,
  fallbacks: [],
  hint: '',
  operation: 'assert',
  assertion: 'visible',
  value: '',
  expected: '',
  direction: 'up',
  timeoutMs: 10000,
});

/** Only positive assertions establish a starting screen. Never infer it from an absent control. */
export function startingTarget(node: ScenarioNode, platform: OS): StartTarget | undefined {
  const markers = node.startScreen?.variants[platform]?.markers;
  if (markers?.length) return { name: node.startScreen!.name, checks: markers.map(assertVisible) };
  const first =
    node.kind === 'scenario' ? flatten(node.children).find((c) => c.kind !== 'scenario') : node;
  const variant = first?.variants[platform];
  if (first?.kind !== 'test' || !variant?.locator || variant.assertion === 'absent') return;
  return { name: first.name, checks: [{ ...variant }] };
}

export async function targetReached(
  target: StartTarget,
  perform: Perform,
  signal: AbortSignal,
  wait = false,
) {
  signal.throwIfAborted();
  try {
    for (const check of target.checks)
      await perform({ ...check, timeoutMs: wait ? check.timeoutMs : 0 }, 'test');
    return true;
  } catch {
    signal.throwIfAborted();
    return false;
  }
}

/** Reuse a verified prefix; never run an unrelated whole scenario to search for a screen. */
export function preparationRoutes(nodes: ScenarioNode[], target: StartTarget, platform: OS) {
  const routes: ScenarioNode[][] = [];
  const sameLocator = (a: Variant, b: Variant) =>
    JSON.stringify(a.locator) === JSON.stringify(b.locator);
  for (const root of nodes) {
    if (!startingTarget(root, platform)) continue;
    const prefix: ScenarioNode[] = [];
    for (const step of flatten(root.children)) {
      const variant = step.variants[platform];
      // Conditional/nested routes need a proper graph; do not flatten away their semantics.
      if (step.children.length || step.preconditionId || !variant) break;
      if (
        step.kind === 'test' &&
        target.checks.every(
          (c) =>
            sameLocator(c, variant) &&
            c.assertion === variant.assertion &&
            c.expected === variant.expected,
        )
      ) {
        if (prefix.some((n) => n.kind !== 'test')) routes.push(prefix);
        break;
      }
      // Arbitrary taps could mutate business data: only navigation, field entry and checks are eligible.
      if (
        step.kind !== 'test' &&
        step.kind !== 'navigation' &&
        !['type', 'clear', 'back', 'swipe', 'wait'].includes(variant.operation)
      )
        break;
      prefix.push(
        !prefix.length && root.startScreen ? { ...step, startScreen: root.startScreen } : step,
      );
      if (
        step.kind === 'navigation' &&
        target.checks.every((c) =>
          step.screen?.variants[platform]?.markers.some(
            (m) => JSON.stringify(m) === JSON.stringify(c.locator),
          ),
        )
      ) {
        routes.push(prefix);
        break;
      }
    }
  }
  return routes.sort((a, b) => a.length - b.length);
}

export async function prepareStart(input: {
  target: StartTarget;
  nodes: ScenarioNode[];
  platform: OS;
  signal: AbortSignal;
  restart: () => Promise<void>;
  perform: Perform;
  execute: (node: ScenarioNode) => Promise<void>;
  explore?: () => Promise<void>;
}) {
  const reached = () => targetReached(input.target, input.perform, input.signal);
  if (await reached()) return;
  await input.restart();
  if (await targetReached(input.target, input.perform, input.signal, true)) return;
  for (const route of preparationRoutes(input.nodes, input.target, input.platform).slice(0, 10)) {
    if (
      !(await targetReached(startingTarget(route[0], input.platform)!, input.perform, input.signal))
    )
      continue;
    // Once a route starts, never replay it after an uncertain outcome (e.g. OTP).
    for (const step of route) {
      input.signal.throwIfAborted();
      await input.execute(step);
      if (await reached()) return;
    }
    if (route.some((s) => s.variants[input.platform]?.operation === 'type'))
      throw new Error(
        'Le parcours de préparation a saisi des identifiants sans confirmer l’écran de départ. Aucun nouvel essai automatique.',
      );
    break;
  }
  if (input.explore) {
    await input.explore();
    if (await reached()) return;
  }
  throw new Error(
    'Écran de départ non retrouvé : ' + input.target.name + '. Le test n’a pas été exécuté.',
  );
}
