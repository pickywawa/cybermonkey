import type { Project } from '../../../shared/domain/project.js';
import { flatten, nodePath, type OS, type ScenarioNode } from '../../../shared/domain/scenario.js';

/**
 * A runnable root for ONE node of the tree: the whole scenario, or the node (with or without its children) wrapped in a
 * partial copy of its scenario that keeps its precondition guard and the screen it must start from.
 */
export function partialRoot(
  project: Project,
  nodeId: string,
  onlySelf = false,
): ScenarioNode | undefined {
  const path = nodePath(project.nodes, nodeId);
  const selected = path.at(-1);
  if (!selected) return undefined;
  // Partial runs play ONE pass: with a dataset, the first row (a whole scenario keeps every row).
  const firstRow = (n: ScenarioNode) =>
    n.dataset ? { ...n.dataset, rows: n.dataset.rows.slice(0, 1) } : undefined;
  if (selected.kind === 'scenario' && !onlySelf) return structuredClone(selected);
  if (selected.kind === 'scenario')
    return structuredClone({ ...selected, dataset: firstRow(selected), children: [] });
  const parent = path.at(-2)!;
  const index = parent.children.findIndex((n) => n.id === selected.id);
  const guard = selected.preconditionId ? parent.children[index - 1] : undefined;
  const previous = parent.children
    .slice(0, index)
    .reverse()
    .find((n) => n.kind !== 'test');
  const startScreen =
    selected.startScreen ??
    (previous?.kind === 'navigation'
      ? previous.screen
      : index === 0
        ? parent.startScreen
        : undefined);
  return structuredClone({
    ...path[0],
    name: path[0].name + ' (partiel)',
    dataset: firstRow(path[0]),
    startScreen,
    children: [
      ...(guard ? [{ ...guard, preconditionId: null, children: [] }] : []),
      onlySelf ? { ...selected, children: [] } : selected,
    ],
  });
}

export interface RouteStep {
  node: ScenarioNode;
  /** Steps whose destination screen is declared: positions where the app can be recognized and the route can start. */
  checkpoint: boolean;
}
export interface Route {
  scenario: ScenarioNode;
  target: ScenarioNode;
  /** Everything that runs BEFORE the target in execution order and moves the app (navigations, actions). */
  steps: RouteStep[];
  /** Precondition test re-checked right before the target, if any. */
  guard?: ScenarioNode;
}
/**
 * How to get to a node: the steps that precede it in its scenario, in execution order. Tests before it are not part of the
 * route (they do not move the app) except its precondition guard.
 */
export function routeTo(project: Project, nodeId: string): Route | undefined {
  const path = nodePath(project.nodes, nodeId);
  const target = path.at(-1);
  if (!target) return undefined;
  const scenario = path[0];
  const ordered = flatten([scenario]);
  const index = ordered.findIndex((n) => n.id === target.id);
  const ancestors = new Set(path.slice(0, -1).map((n) => n.id));
  const steps = ordered
    .slice(1, index)
    .filter((n) => n.kind === 'navigation' || n.kind === 'action' || ancestors.has(n.id))
    .filter((n) => n.kind !== 'scenario' && n.kind !== 'test')
    .map((node) => ({ node, checkpoint: node.kind === 'navigation' && !!node.screen }));
  const parent = path.at(-2);
  const guard = target.preconditionId
    ? parent?.children.find((n) => n.id === target.preconditionId)
    : undefined;
  return { scenario, target, steps, guard };
}

/** A plain scenario made of copies of the given steps (no children, no preconditions): "replay these, in this order". */
export function sequenceRoot(
  name: string,
  steps: ScenarioNode[],
  startScreen?: ScenarioNode['startScreen'],
): ScenarioNode {
  const copy = structuredClone(steps).map((n) => ({
    ...n,
    children: [],
    preconditionId: null,
    blocking: false,
  }));
  return {
    id: crypto.randomUUID(),
    name,
    kind: 'scenario',
    description: '',
    tags: [],
    preconditionId: null,
    childrenOnPreconditionFailure: false,
    blocking: false,
    startScreen,
    variants: {},
    children: copy,
  };
}
export const osLabel = (os: OS) => (os === 'ios' ? 'iOS' : 'Android');
