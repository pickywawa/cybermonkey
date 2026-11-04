import {
  applicableOs,
  flatten,
  isSupportScenario,
  type OS,
  type ScenarioNode,
} from './scenario.js';
import type { CampaignDetail, ReplayFrame, RunEntry, RunStatus } from './report.js';
import type { Project } from './project.js';

export const outcomeOf = (e: RunEntry): RunStatus => e.outcome ?? e.status;

export function campaignFrames(detail: CampaignDetail | null): ReplayFrame[] {
  return (detail?.reports ?? [])
    .flatMap((r) =>
      r.entries
        .filter((e) => !e.precondition && e.kind !== 'scenario' && !!e.completedAt)
        .map((entry) => ({ runId: r.id, entry })),
    )
    .sort(
      (a, b) =>
        a.entry.completedAt!.localeCompare(b.entry.completedAt!) ||
        (a.runId === b.runId
          ? (a.entry.sequence ?? 0) - (b.entry.sequence ?? 0)
          : a.runId.localeCompare(b.runId)) ||
        a.entry.id.localeCompare(b.entry.id),
    );
}

const planned = (project: Pick<Project, 'nodes' | 'platforms'>, oses: readonly OS[]) => {
  const keys = new Map<string, { os: OS; node: ScenarioNode; scenarioId: string }>();
  for (const root of project.nodes.filter((n) => !isSupportScenario(n)))
    for (const node of flatten([root]))
      if (node.kind !== 'scenario')
        for (const os of applicableOs(node, project.platforms).filter((o) => oses.includes(o)))
          keys.set(os + ':' + node.id, { os, node, scenarioId: root.id });
  return keys;
};

/** Latest outcome per (os, step): retries never inflate completion. */
export function latestOutcomes(detail: CampaignDetail | null) {
  const latest = new Map<string, RunStatus>();
  for (const report of [...(detail?.reports ?? [])].sort((a, b) =>
    a.startedAt.localeCompare(b.startedAt),
  )) {
    const kinds = new Map(flatten(report.snapshot).map((n) => [n.id, n.kind]));
    // A step played once per dataset row counts as its worst outcome; a plain retry replaces the previous result.
    const rank = (s: RunStatus) =>
      ({ failed: 5, blocked: 4, cancelled: 3, skipped: 2, passed: 1 })[s as 'failed'] ?? 0;
    const within = new Map<string, RunStatus>();
    for (const e of report.entries) {
      if (
        e.preparation ||
        e.interruption ||
        e.precondition ||
        (e.kind ?? kinds.get(e.nodeId)) === 'scenario' ||
        e.nodeId === 'engine'
      )
        continue;
      const key = e.platform + ':' + e.nodeId;
      const outcome = outcomeOf(e);
      const previous = within.get(key);
      if (e.iteration && previous !== undefined && rank(outcome) <= rank(previous)) continue;
      within.set(key, outcome);
    }
    for (const [key, outcome] of within) latest.set(key, outcome);
  }
  return latest;
}

export interface Progress {
  total: number;
  passed: number;
  failed: number;
  pending: number;
  percent: number;
}
const emptyProgress = (): Progress => ({ total: 0, passed: 0, failed: 0, pending: 0, percent: 0 });
const finish = (p: Progress): Progress => {
  p.pending = p.total - p.passed - p.failed;
  p.percent = p.total ? Math.round(((p.passed + p.failed) / p.total) * 100) : 0;
  return p;
};
export interface CampaignProgress {
  overall: Progress;
  byOs: Partial<Record<OS, Progress>>;
  byScenario: {
    id: string;
    name: string;
    overall: Progress;
    byOs: Partial<Record<OS, Progress>>;
  }[];
}
export function campaignProgress(
  detail: CampaignDetail | null,
  project: Pick<Project, 'nodes' | 'platforms'>,
  oses: readonly OS[] = project.platforms,
): CampaignProgress {
  const latest = latestOutcomes(detail);
  const overall = emptyProgress();
  const byOs: Partial<Record<OS, Progress>> = {};
  const scenarios = new Map<
    string,
    { id: string; name: string; overall: Progress; byOs: Partial<Record<OS, Progress>> }
  >();
  for (const [key, { os, scenarioId }] of planned(project, oses)) {
    const root = project.nodes.find((n) => n.id === scenarioId)!;
    const sc = scenarios.get(scenarioId) ?? {
      id: scenarioId,
      name: root.name,
      overall: emptyProgress(),
      byOs: {},
    };
    scenarios.set(scenarioId, sc);
    const outcome = latest.get(key);
    for (const bucket of [
      overall,
      (byOs[os] ??= emptyProgress()),
      sc.overall,
      (sc.byOs[os] ??= emptyProgress()),
    ]) {
      bucket.total++;
      if (outcome === 'passed') bucket.passed++;
      else if (outcome === 'failed') bucket.failed++;
    }
  }
  [
    overall,
    ...Object.values(byOs),
    ...[...scenarios.values()].flatMap((s) => [s.overall, ...Object.values(s.byOs)]),
  ].forEach(finish);
  return { overall, byOs, byScenario: [...scenarios.values()] };
}

/* ---------- screen graph (planned + observed) ---------- */

export type ScreenStatus = 'untested' | 'passed' | 'failed' | 'partial';
export interface OsScreenStats {
  /** Attempts (retries included). */
  passed: number;
  failed: number;
  actions: number;
  visited: boolean;
  /** Latest result of each check on this screen: what decides the screen's status. */
  latest: Map<string, RunStatus>;
}
export interface GraphScreen {
  id: string;
  name: string;
  identified: boolean;
  status: ScreenStatus;
  planned: boolean;
  stats: Partial<Record<OS, OsScreenStats>>;
  frames: ReplayFrame[];
  /** Latest capture frame, for the card thumbnail. */
  thumbnail?: ReplayFrame;
}
export interface GraphEdge {
  from: string;
  to: string;
  count: number;
  planned: boolean;
}
export function buildScreenGraph(
  detail: CampaignDetail | null,
  project: Pick<Project, 'nodes' | 'platforms'>,
  oses: readonly OS[] = project.platforms,
  options: { includeUnidentified?: boolean } = {},
) {
  const screens = new Map<string, GraphScreen>();
  const edges = new Map<string, GraphEdge>();
  const ensure = (id: string, name: string, identified: boolean, planned: boolean) => {
    let s = screens.get(id);
    if (!s)
      screens.set(
        id,
        (s = { id, name, identified, status: 'untested', planned, stats: {}, frames: [] }),
      );
    if (planned) s.planned = true;
    return s;
  };
  const stat = (s: GraphScreen, os: OS) =>
    (s.stats[os] ??= { passed: 0, failed: 0, actions: 0, visited: false, latest: new Map() });
  const link = (from: string, to: string, planned: boolean) => {
    if (from === to) return;
    const key = from + '>' + to;
    const edge = edges.get(key) ?? { from, to, count: 0, planned };
    if (!planned) {
      edge.count++;
      edge.planned = edge.planned && planned;
    }
    edges.set(key, edge);
  };
  // Planned graph: navigation order inside each scenario.
  for (const root of project.nodes.filter((n) => !isSupportScenario(n))) {
    let previous: string | undefined = root.startScreen?.id;
    if (root.startScreen) ensure(root.startScreen.id, root.startScreen.name, true, true);
    for (const node of flatten(root.children)) {
      if (node.kind !== 'navigation' || !node.screen) continue;
      ensure(node.screen.id, node.screen.name, true, true);
      if (previous) link(previous, node.screen.id, true);
      previous = node.screen.id;
    }
  }
  // Observed graph.
  for (const frame of campaignFrames(detail)) {
    const e = frame.entry;
    if (!oses.includes(e.platform)) continue;
    const ref = (r: NonNullable<RunEntry['screenBefore']>) =>
      ensure(r.id, r.name, r.identified, false);
    if (e.screenBefore) ref(e.screenBefore);
    if (e.screenAfter) ref(e.screenAfter);
    const target =
      e.kind === 'navigation'
        ? (e.screenAfter ?? e.screenBefore)
        : (e.screenBefore ?? e.screenAfter);
    if (target) {
      const s = screens.get(target.id)!;
      const st = stat(s, e.platform);
      st.visited = true;
      s.frames.push(frame);
      if (e.kind === 'test') {
        if (outcomeOf(e) === 'passed') st.passed++;
        if (outcomeOf(e) === 'failed') st.failed++;
        st.latest.set(e.nodeId, outcomeOf(e));
      } else st.actions++;
      if (e.screenshot) s.thumbnail = frame;
    }
    if (e.screenBefore && e.screenAfter) link(e.screenBefore.id, e.screenAfter.id, false);
  }
  for (const s of screens.values()) {
    const results = (os: OS) => [...(s.stats[os]?.latest.values() ?? [])];
    const tested = oses.filter((os) => results(os).some((r) => r === 'passed' || r === 'failed'));
    const failed = tested.some((os) => results(os).includes('failed'));
    s.status = failed
      ? 'failed'
      : !tested.length
        ? 'untested'
        : tested.length < oses.filter((o) => project.platforms.includes(o)).length
          ? 'partial'
          : 'passed';
  }
  let list = [...screens.values()];
  if (!options.includeUnidentified) {
    // Collapse unidentified screens: keep paths through them but hide the nodes.
    const hidden = new Set(list.filter((s) => !s.identified && !s.planned).map((s) => s.id));
    list = list.filter((s) => !hidden.has(s.id));
    const all = [...edges.values()];
    const out: GraphEdge[] = [];
    for (const e of all) {
      if (hidden.has(e.from)) continue;
      let target = e.to;
      const seen = new Set<string>();
      while (hidden.has(target) && !seen.has(target)) {
        seen.add(target);
        const next = all.find((x) => x.from === target && !seen.has(x.to));
        if (!next) break;
        target = next.to;
      }
      if (!hidden.has(target) && target !== e.from) out.push({ ...e, to: target });
    }
    const merged = new Map<string, GraphEdge>();
    for (const e of out) {
      const k = e.from + '>' + e.to;
      const m = merged.get(k);
      merged.set(k, m ? { ...m, count: m.count + e.count, planned: m.planned && e.planned } : e);
    }
    return { screens: list, edges: [...merged.values()] };
  }
  return { screens: list, edges: [...edges.values()] };
}

/** Layered left-to-right layout; deterministic and cycle-safe. */
export function layoutGraph(
  screens: { id: string }[],
  edges: { from: string; to: string }[],
  cell = { w: 220, h: 150, gx: 70, gy: 34 },
) {
  const ids = screens.map((s) => s.id);
  const layer = new Map<string, number>();
  const incoming = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const e of edges)
    if (incoming.has(e.to) && ids.includes(e.from)) incoming.set(e.to, incoming.get(e.to)! + 1);
  const roots = ids.filter((id) => incoming.get(id) === 0);
  const queue = (roots.length ? roots : ids.slice(0, 1)).map((id) => (layer.set(id, 0), id));
  for (let i = 0; i < queue.length; i++)
    for (const e of edges.filter((x) => x.from === queue[i]))
      if (!layer.has(e.to) && ids.includes(e.to)) {
        layer.set(e.to, layer.get(queue[i])! + 1);
        queue.push(e.to);
      }
  for (const id of ids) if (!layer.has(id)) layer.set(id, 0);
  const columns = new Map<number, string[]>();
  for (const id of ids) columns.set(layer.get(id)!, [...(columns.get(layer.get(id)!) ?? []), id]);
  const positions = new Map<string, { x: number; y: number }>();
  let height = 0;
  for (const [col, members] of columns) {
    members.forEach((id, row) =>
      positions.set(id, { x: col * (cell.w + cell.gx), y: row * (cell.h + cell.gy) }),
    );
    height = Math.max(height, members.length * (cell.h + cell.gy));
  }
  const width = (Math.max(0, ...columns.keys()) + 1) * (cell.w + cell.gx);
  return { positions, width, height, cell };
}
