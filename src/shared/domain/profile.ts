import { outcomeOf } from './campaign.js';
import type { CampaignDetail, RunEntry } from './report.js';
import type { OS } from './scenario.js';

export interface StepProfile {
  nodeId: string;
  name: string;
  os: OS;
  runs: number;
  /** Mean / worst wall time of the step, ms. */
  avgMs: number;
  maxMs: number;
  /** Mean time doing the step itself vs gathering evidence (when the engine measured them). */
  performMs?: number;
  proofMs?: number;
}
export interface DurationProfile {
  steps: number;
  totalMs: number;
  /** Share of the time spent by the engine on evidence (inspection, capture) rather than on the app. */
  proofShare?: number;
  perOs: Partial<Record<OS, { steps: number; totalMs: number }>>;
  slowest: StepProfile[];
}
/** Wall time of one entry: from start to the end of its evidence gathering. */
export const entryDurationMs = (e: RunEntry): number | undefined => {
  const end = e.completedAt ?? e.finishedAt;
  if (!end) return undefined;
  const ms = Date.parse(end) - Date.parse(e.startedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
};

/** Where a campaign's time goes: the slowest steps per OS, and how much of it is the engine's own evidence gathering. */
export function durationProfile(detail: CampaignDetail | null, limit = 10): DurationProfile {
  const groups = new Map<
    string,
    { entry: RunEntry; times: number[]; perform: number[]; proof: number[] }
  >();
  const perOs: DurationProfile['perOs'] = {};
  let totalMs = 0;
  let steps = 0;
  let proofSum = 0;
  let measured = 0;
  for (const report of detail?.reports ?? [])
    for (const e of report.entries) {
      if (
        e.kind === 'scenario' ||
        e.precondition ||
        e.preparation ||
        e.interruption ||
        e.nodeId === 'engine'
      )
        continue;
      if (!['passed', 'failed'].includes(outcomeOf(e))) continue;
      const ms = entryDurationMs(e);
      if (ms === undefined) continue;
      const key = e.platform + ':' + e.nodeId;
      const g = groups.get(key) ?? { entry: e, times: [], perform: [], proof: [] };
      g.entry = e;
      g.times.push(ms);
      if (e.performMs !== undefined) g.perform.push(e.performMs);
      if (e.proofMs !== undefined) {
        g.proof.push(e.proofMs);
        proofSum += e.proofMs;
        measured += ms;
      }
      groups.set(key, g);
      steps++;
      totalMs += ms;
      const o = (perOs[e.platform] ??= { steps: 0, totalMs: 0 });
      o.steps++;
      o.totalMs += ms;
    }
  const mean = (a: number[]) =>
    a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : undefined;
  const slowest = [...groups.values()]
    .map((g): StepProfile => ({
      nodeId: g.entry.nodeId,
      name: g.entry.nodeName,
      os: g.entry.platform,
      runs: g.times.length,
      avgMs: mean(g.times)!,
      maxMs: Math.max(...g.times),
      performMs: mean(g.perform),
      proofMs: mean(g.proof),
    }))
    .sort((a, b) => b.avgMs - a.avgMs)
    .slice(0, limit);
  return {
    steps,
    totalMs,
    ...(measured ? { proofShare: +(proofSum / measured).toFixed(2) } : {}),
    perOs,
    slowest,
  };
}
