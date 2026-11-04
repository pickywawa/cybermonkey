import { z } from 'zod';
import { variableName } from './variables.js';

export const OS_LIST = ['android', 'ios'] as const;
export type OS = (typeof OS_LIST)[number];
export const osSchema = z.enum(OS_LIST);

export const locatorSchema = z.object({
  using: z.enum(['id', 'accessibility id', 'xpath']),
  value: z.string().min(1).max(3000),
});
export type Locator = z.infer<typeof locatorSchema>;

export const OPERATIONS = [
  'tap',
  'type',
  'clear',
  'back',
  'assert',
  'swipe',
  'wait',
  // Gestures
  'longpress',
  'doubletap',
  'scroll',
  // Read a value from the screen into a variable
  'capture',
  // Application lifecycle
  'launch',
  'relaunch',
  'terminate',
  'background',
  // Links and system
  'deeplink',
  'alert',
  'orientation',
  'hidekeyboard',
] as const;
export type Operation = (typeof OPERATIONS)[number];
export const ASSERTIONS = [
  'visible',
  'absent',
  'text',
  'contains',
  'enabled',
  'selected',
  'matches',
  'count',
] as const;
export type Assertion = (typeof ASSERTIONS)[number];
export const DIRECTIONS = ['up', 'down', 'left', 'right'] as const;

/** Operations that act on the device or the app as a whole: no component to find. */
export const DEVICE_OPERATIONS: readonly Operation[] = [
  'back',
  'swipe',
  'wait',
  'launch',
  'relaunch',
  'terminate',
  'background',
  'deeplink',
  'alert',
  'orientation',
  'hidekeyboard',
];
/** Operations that may target a screen position instead of a selector (web views). */
export const POINT_OPERATIONS: readonly Operation[] = [
  'tap',
  'type',
  'clear',
  'longpress',
  'doubletap',
];
/** Operations after which the screen the engine remembers can no longer be trusted. */
export const SCREEN_CHANGING_OPERATIONS: readonly Operation[] = [
  'back',
  'swipe',
  'scroll',
  'launch',
  'relaunch',
  'terminate',
  'background',
  'deeplink',
  'alert',
  'orientation',
  'hidekeyboard',
];
export const needsComponent = (operation: Operation): boolean =>
  !DEVICE_OPERATIONS.includes(operation);

/** How one step is performed on ONE operating system. */
export const variantSchema = z.object({
  locator: locatorSchema.optional(),
  /** Alternative selectors tried in order when the primary one finds nothing. */
  fallbacks: z.array(locatorSchema).max(5).default([]),
  /**
   * Screen position (fractions 0..1 of the window) for content the accessibility tree cannot expose,
   * typically a web view. Used instead of a selector; always a last resort.
   */
  point: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
  /** Human description of the target component; feeds self-healing and cross-OS mapping. */
  hint: z.string().max(300).default(''),
  operation: z.enum(OPERATIONS).default('tap'),
  value: z.string().max(5000).default(''),
  assertion: z.enum(ASSERTIONS).default('visible'),
  expected: z.string().max(5000).default(''),
  direction: z.enum(DIRECTIONS).default('up'),
  timeoutMs: z.number().int().min(0).max(120000).default(10000),
});
export type Variant = z.infer<typeof variantSchema>;
export const makeVariant = (partial: Partial<Variant> = {}): Variant =>
  variantSchema.parse(partial);

const markersSchema = z.object({
  markers: z.array(locatorSchema).min(1).max(12),
  /**
   * Deep link that opens this screen directly (e.g. myapp://orders). When a scenario starts here, the runner tries it
   * before restarting the app and replaying a route: seconds instead of tens of seconds.
   */
  link: z.string().trim().min(1).max(500).optional(),
});
export const screenDefinitionSchema = z.object({
  id: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(180),
  variants: z.object({ android: markersSchema.optional(), ios: markersSchema.optional() }),
});
export type ScreenDefinition = z.infer<typeof screenDefinitionSchema>;

export const externalRefSchema = z.object({
  tool: z.string().max(60),
  id: z.string().max(200),
  title: z.string().max(400).optional(),
});
export type ExternalRef = z.infer<typeof externalRefSchema>;

export const NODE_KINDS = ['scenario', 'action', 'test', 'navigation'] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export interface ScenarioNode {
  id: string;
  name: string;
  kind: NodeKind;
  description: string;
  tags: string[];
  preconditionId: string | null;
  childrenOnPreconditionFailure: boolean;
  blocking: boolean;
  /** Operating systems this step applies to. Absent = every platform of the project. */
  platforms?: OS[];
  preparation?: boolean;
  startScreen?: ScreenDefinition;
  screen?: ScreenDefinition;
  source?: ExternalRef;
  variants: Partial<Record<OS, Variant>>;
  /**
   * Run condition, per OS: an assertion evaluated right before the step. When it is not met the step (and its children)
   * is skipped, which is not a failure: "if the cookie banner is visible, close it".
   */
  when?: Partial<Record<OS, Variant>>;
  /** Id of a scenario whose steps run here, in place: reuse "Log in" everywhere without copying it. */
  call?: string;
  /**
   * Scenario only: an interruption handler. When a step fails and this screen is showing (a popup, an expired-session
   * message, the login screen…), the scenario runs to deal with it, then the failed step is replayed.
   * Handlers are never part of a campaign on their own.
   */
  handler?: Handler;
  /** Scenario only: played once per row, each column being a variable (accounts, languages…). */
  dataset?: Dataset;
  children: ScenarioNode[];
}

export const handlerSchema = z.object({
  /** What is on screen when this interruption is there (markers per OS, like any screen identity). */
  when: screenDefinitionSchema,
  /**
   * After the handler: "retry" replays the failed step where the app now is; "return" first goes back to the screen the
   * step started from (through the known navigations), e.g. after logging in again.
   */
  resume: z.enum(['retry', 'return']).default('return'),
  /** Safety valve against a handler that keeps coming back during one run. */
  maxPerRun: z.number().int().min(1).max(20).default(5),
});
export type Handler = z.infer<typeof handlerSchema>;
/** Scenarios that exist to support others (preparation routes, interruption handlers): not run on their own. */
export const isSupportScenario = (n: ScenarioNode): boolean => !!n.preparation || !!n.handler;

export const MAX_DATASET_ROWS = 50;
export const datasetSchema = z.object({
  rows: z
    .array(z.record(variableName, z.string().max(2000)))
    .min(1)
    .max(MAX_DATASET_ROWS),
});
export type Dataset = z.infer<typeof datasetSchema>;
/** Column names of a dataset, in first-seen order. */
export const datasetColumns = (d: Dataset): string[] => [...new Set(d.rows.flatMap(Object.keys))];
/** Short label of one row for reports: its first values. */
export const datasetRowLabel = (row: Record<string, string>): string =>
  Object.entries(row)
    .slice(0, 2)
    .map(([k, v]) => `${k}=${/pass|pin|secret|token|code/i.test(k) ? '•••' : v.slice(0, 24)}`)
    .join(', ');

export const nodeSchema: z.ZodType<ScenarioNode> = z.lazy(() =>
  z.object({
    id: z.string().min(1).max(100),
    name: z.string().trim().min(1).max(180),
    kind: z.enum(NODE_KINDS),
    description: z.string().max(5000).default(''),
    tags: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
    preconditionId: z.string().nullable().default(null),
    childrenOnPreconditionFailure: z.boolean().default(false),
    blocking: z.boolean().default(false),
    platforms: z.array(osSchema).max(2).optional(),
    preparation: z.boolean().optional(),
    startScreen: screenDefinitionSchema.optional(),
    screen: screenDefinitionSchema.optional(),
    source: externalRefSchema.optional(),
    variants: z
      .object({ android: variantSchema.optional(), ios: variantSchema.optional() })
      .default({}),
    when: z.object({ android: variantSchema.optional(), ios: variantSchema.optional() }).optional(),
    call: z.string().min(1).max(100).optional(),
    dataset: datasetSchema.optional(),
    handler: handlerSchema.optional(),
    children: z.array(nodeSchema).max(500).default([]),
  }),
);

export const newId = () => crypto.randomUUID();

export function makeNode(kind: NodeKind, name: string, oses: readonly OS[] = []): ScenarioNode {
  return {
    id: newId(),
    kind,
    name,
    description: '',
    tags: [],
    preconditionId: null,
    childrenOnPreconditionFailure: false,
    blocking: false,
    variants:
      kind === 'scenario'
        ? {}
        : Object.fromEntries(
            oses.map((os) => [os, makeVariant({ operation: kind === 'test' ? 'assert' : 'tap' })]),
          ),
    children: [],
  };
}

/* ---------- tree helpers (pure, shared by UI and engine) ---------- */

export function flatten(nodes: ScenarioNode[]): ScenarioNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}
export function findNode(nodes: ScenarioNode[], id: string): ScenarioNode | undefined {
  return flatten(nodes).find((n) => n.id === id);
}
export function nodePath(nodes: ScenarioNode[], id: string): ScenarioNode[] {
  for (const n of nodes) {
    if (n.id === id) return [n];
    const rest = nodePath(n.children, id);
    if (rest.length) return [n, ...rest];
  }
  return [];
}
export function mapNodes(
  nodes: ScenarioNode[],
  fn: (n: ScenarioNode) => ScenarioNode,
): ScenarioNode[] {
  return nodes.map((n) => fn({ ...n, children: mapNodes(n.children, fn) }));
}
export function updateNode(
  nodes: ScenarioNode[],
  id: string,
  patch: Partial<ScenarioNode> | ((n: ScenarioNode) => ScenarioNode),
): ScenarioNode[] {
  return mapNodes(nodes, (n) =>
    n.id === id ? (typeof patch === 'function' ? patch(n) : { ...n, ...patch }) : n,
  );
}
export function removeNode(nodes: ScenarioNode[], id: string): ScenarioNode[] {
  return nodes
    .filter((n) => n.id !== id)
    .map((n) => ({
      ...n,
      preconditionId: n.preconditionId === id ? null : n.preconditionId,
      children: removeNode(n.children, id),
    }));
}
/** Append children to a parent, or append roots when parentId is null. */
export function appendChildren(
  nodes: ScenarioNode[],
  parentId: string | null | undefined,
  added: ScenarioNode[],
): ScenarioNode[] {
  if (!parentId) return [...nodes, ...added];
  return mapNodes(nodes, (n) =>
    n.id === parentId ? { ...n, children: [...n.children, ...added] } : n,
  );
}
/** Insert a node right after a sibling (used when adding a step below the selected one). */
export function insertAfter(
  nodes: ScenarioNode[],
  afterId: string,
  added: ScenarioNode,
): ScenarioNode[] {
  const index = nodes.findIndex((n) => n.id === afterId);
  if (index >= 0) return [...nodes.slice(0, index + 1), added, ...nodes.slice(index + 1)];
  return nodes.map((n) => ({ ...n, children: insertAfter(n.children, afterId, added) }));
}
/** Move a node one position among its siblings. */
export function moveNode(nodes: ScenarioNode[], id: string, delta: -1 | 1): ScenarioNode[] {
  const swap = (list: ScenarioNode[]): ScenarioNode[] => {
    const i = list.findIndex((n) => n.id === id);
    if (i < 0) return list.map((n) => ({ ...n, children: swap(n.children) }));
    const j = i + delta;
    if (j < 0 || j >= list.length) return list;
    const copy = [...list];
    [copy[i], copy[j]] = [copy[j], copy[i]];
    // A precondition must stay glued to the test right before it.
    return copy.map((n, k) =>
      n.preconditionId && copy[k - 1]?.id !== n.preconditionId ? { ...n, preconditionId: null } : n,
    );
  };
  return swap(nodes);
}
/** Deep copy with brand-new ids; preconditions are remapped. */
export function cloneWithNewIds(node: ScenarioNode): ScenarioNode {
  const ids = new Map<string, string>();
  const copy = (n: ScenarioNode): ScenarioNode => {
    const id = newId();
    ids.set(n.id, id);
    return { ...structuredClone({ ...n, children: [] }), id, children: n.children.map(copy) };
  };
  const cloned = copy(node);
  return mapNodes([cloned], (n) => ({
    ...n,
    preconditionId: n.preconditionId ? (ids.get(n.preconditionId) ?? null) : null,
  }))[0];
}

/** OS on which a node must run, given the project platforms. */
export function applicableOs(node: ScenarioNode, projectOs: readonly OS[]): OS[] {
  return projectOs.filter((os) => !node.platforms || node.platforms.includes(os));
}
export function variantFor(node: ScenarioNode, os: OS): Variant | undefined {
  return node.variants[os];
}
/** Per-OS coverage of a leaf: which OS have a configured variant. */
export function coverage(node: ScenarioNode, projectOs: readonly OS[]) {
  const expected = applicableOs(node, projectOs);
  // A sub-scenario call carries no selector: it is complete by itself.
  const has = (os: OS) => !!node.call || !!node.variants[os];
  return {
    expected,
    configured: expected.filter(has),
    missing: expected.filter((os) => !has(os)),
  };
}

export function validateTree(nodes: ScenarioNode[]) {
  const ids = new Set<string>();
  const visit = (list: ScenarioNode[], depth: number) => {
    if (depth > 20) throw new Error('Arbre trop profond');
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if ((depth === 0) !== (n.kind === 'scenario'))
        throw new Error(
          'Seuls les scénarios sont autorisés à la racine ; aucun scénario imbriqué.',
        );
      if (ids.has(n.id)) throw new Error('Identifiants dupliqués : ' + n.id);
      ids.add(n.id);
      if (
        n.preconditionId &&
        (i === 0 || list[i - 1].kind !== 'test' || list[i - 1].id !== n.preconditionId)
      )
        throw new Error('La précondition doit désigner le test immédiatement précédent.');
      if (n.call && (n.kind !== 'action' || n.children.length))
        throw new Error('Un appel de sous-scénario est un élément « action » sans enfants.');
      if (n.handler && n.kind !== 'scenario')
        throw new Error('Un gestionnaire d’imprévu est un scénario.');
      // A handler without markers yet is a draft: it never triggers until it says what it reacts to.
      if (n.dataset && n.kind !== 'scenario')
        throw new Error('Un jeu de données ne s’applique qu’à un scénario.');
      visit(n.children, depth + 1);
    }
  };
  visit(nodes, 0);
  validateCalls(nodes);
}

/** Every `call` must target an existing root scenario, and scenarios may not call each other in a loop. */
export function validateCalls(nodes: ScenarioNode[]) {
  const roots = new Map(nodes.map((n) => [n.id, n]));
  const callsOf = (root: ScenarioNode) =>
    flatten(root.children)
      .map((n) => n.call)
      .filter((id): id is string => !!id);
  for (const root of nodes)
    for (const id of callsOf(root))
      if (!roots.has(id))
        throw new Error(`Sous-scénario introuvable (appelé depuis « ${root.name} ») : ${id}`);
  const visiting = new Set<string>();
  const done = new Set<string>();
  const walk = (root: ScenarioNode) => {
    if (done.has(root.id)) return;
    if (visiting.has(root.id))
      throw new Error(`Appels de sous-scénarios circulaires autour de « ${root.name} ».`);
    visiting.add(root.id);
    for (const id of callsOf(root)) walk(roots.get(id)!);
    visiting.delete(root.id);
    done.add(root.id);
  };
  nodes.forEach(walk);
}
/** Scenarios that call this one (to warn before deleting it). */
export function callersOf(nodes: ScenarioNode[], scenarioId: string): ScenarioNode[] {
  return nodes.filter((root) => flatten(root.children).some((n) => n.call === scenarioId));
}
