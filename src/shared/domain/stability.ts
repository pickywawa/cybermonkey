import { outcomeOf } from './campaign.js';
import type { CampaignDetail } from './report.js';
import type { OS } from './scenario.js';

export type StabilityVerdict =
  | 'stable'
  /** Passes and fails (or only passes after a retry) without a lasting change: a fragile test. */
  | 'flaky'
  /** Passed before, fails now and keeps failing: something changed. */
  | 'regression'
  /** One failure after a clean history: rerun before concluding. */
  | 'first-failure'
  | 'always-failing'
  | 'new';

export interface StepStability {
  os: OS;
  nodeId: string;
  name: string;
  runs: number;
  passed: number;
  failed: number;
  /** Runs that passed only on a retry. */
  retried: number;
  passRate: number;
  /** Oldest → newest, at most `window` results. */
  recent: ('passed' | 'failed')[];
  verdict: StabilityVerdict;
  /** One sentence for a human or an AI. */
  text: string;
}

/** Where a step stands over its recent runs: passed 8 times out of 10 and failing now are different problems. */
export function stabilityOf(details: (CampaignDetail | null)[], window = 10): StepStability[] {
  const reports = details
    .flatMap((d) => d?.reports ?? [])
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const groups = new Map<
    string,
    { os: OS; nodeId: string; name: string; results: ('passed' | 'failed')[]; retried: number }
  >();
  for (const report of reports)
    for (const e of report.entries) {
      if (
        e.kind === 'scenario' ||
        e.precondition ||
        e.preparation ||
        e.interruption ||
        e.nodeId === 'engine'
      )
        continue;
      const outcome = outcomeOf(e);
      if (outcome !== 'passed' && outcome !== 'failed') continue;
      const key = e.platform + ':' + e.nodeId;
      const g = groups.get(key) ?? {
        os: e.platform,
        nodeId: e.nodeId,
        name: e.nodeName,
        results: [],
        retried: 0,
      };
      g.name = e.nodeName;
      g.results.push(outcome);
      if (e.flaky && outcome === 'passed') g.retried++;
      groups.set(key, g);
    }
  return [...groups.values()].map((g): StepStability => {
    const recent = g.results.slice(-window);
    const passed = recent.filter((r) => r === 'passed').length;
    const failed = recent.length - passed;
    let trailing = 0;
    for (let i = recent.length - 1; i >= 0 && recent[i] === 'failed'; i--) trailing++;
    const retried = Math.min(g.retried, recent.length);
    let verdict: StabilityVerdict;
    if (recent.length < 2 && !retried) verdict = recent[0] === 'failed' ? 'first-failure' : 'new';
    else if (!failed) verdict = retried ? 'flaky' : 'stable';
    else if (!passed) verdict = 'always-failing';
    else if (trailing >= 2 && trailing === failed) verdict = 'regression';
    else if (trailing === 1 && failed === 1) verdict = 'first-failure';
    else verdict = 'flaky';
    const rate = recent.length ? passed / recent.length : 0;
    const text = {
      stable: `passed ${passed} of the last ${recent.length} runs`,
      new: 'not enough history yet',
      'first-failure': `failed once after ${passed} pass(es): rerun to tell a regression from a hiccup`,
      regression: `passed before, now failing ${trailing} runs in a row: something changed`,
      'always-failing': `failed all of the last ${recent.length} runs: never worked in this history`,
      flaky: `passed ${passed} of the last ${recent.length} runs${retried ? `, ${retried} only on a retry` : ''}: unreliable, fix the test before trusting a failure`,
    }[verdict];
    return {
      os: g.os,
      nodeId: g.nodeId,
      name: g.name,
      runs: recent.length,
      passed,
      failed,
      retried,
      passRate: +rate.toFixed(2),
      recent,
      verdict,
      text,
    };
  });
}
export const unstableSteps = (list: StepStability[], minRuns = 2) =>
  list
    .filter((s) => s.verdict === 'flaky' && s.runs >= minRuns)
    .sort((a, b) => a.passRate - b.passRate || b.runs - a.runs);
