import type { CampaignDetail, RunEntry } from './report.js';

/** A step is « slow » when it takes at least this many times its usual duration… */
export const SLOW_RATIO = 1.5;
/** …and at least this much longer (so a 0.2 s step turning into 0.4 s is not news). */
export const SLOW_MIN_EXTRA_MS = 1000;
export const SLOW_MIN_EXTRA_SCENARIO_MS = 2500;
/** Earlier campaigns kept as the yardstick. */
export const BASELINE_CAMPAIGNS = 5;

export interface Slowness {
  ms: number;
  baselineMs: number;
  ratio: number;
}

/**
 * How long the step itself took: the time spent acting (locating, gesture, waiting for the screen), not the time the
 * framework spent gathering evidence afterwards.
 */
export function durationOf(e: RunEntry): number | undefined {
  if (e.performMs !== undefined) return e.performMs;
  if (!e.finishedAt) return undefined;
  const ms = Date.parse(e.finishedAt) - Date.parse(e.startedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms : undefined;
}

export const median = (values: number[]): number => {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/** The passed, plainly timed entries of a campaign: the ones whose duration means something. */
const timed = (e: RunEntry) =>
  !e.precondition &&
  !e.preparation &&
  !e.interruption &&
  !e.iteration &&
  e.kind !== 'scenario' &&
  e.nodeId !== 'engine' &&
  (e.outcome ?? e.status) === 'passed' &&
  durationOf(e) !== undefined;

/** Per « os:nodeId », the duration of each passed run in time order. */
export function durationHistory(detail: CampaignDetail | null): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const report of [...(detail?.reports ?? [])].sort((a, b) =>
    a.startedAt.localeCompare(b.startedAt),
  ))
    for (const e of report.entries)
      if (timed(e)) {
        const key = e.platform + ':' + e.nodeId;
        out.set(key, [...(out.get(key) ?? []), durationOf(e)!]);
      }
  return out;
}

/**
 * What earlier campaigns say a step normally takes: for every step, the last passed duration of each campaign (one
 * value per campaign, so a campaign run ten times does not outweigh the others).
 */
export function baselinesFrom(previous: CampaignDetail[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const detail of previous)
    for (const [key, durations] of durationHistory(detail))
      (out[key] ??= []).push(durations[durations.length - 1]!);
  return out;
}

/** Slower than usual, or undefined: no yardstick yet, not slow enough, or the value is not comparable. */
export function slownessOf(
  ms: number | undefined,
  samples: number[] | undefined,
  minExtra = SLOW_MIN_EXTRA_MS,
): Slowness | undefined {
  if (ms === undefined || !samples?.length) return undefined;
  const baselineMs = median(samples);
  if (baselineMs <= 0) return undefined;
  const ratio = ms / baselineMs;
  return ratio >= SLOW_RATIO && ms - baselineMs >= minExtra
    ? { ms, baselineMs, ratio: Math.round(ratio * 10) / 10 }
    : undefined;
}
