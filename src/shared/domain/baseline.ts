import { outcomeOf } from './campaign.js';
import type { CampaignDetail, RunEntry } from './report.js';

export interface Baseline {
  campaignId: string;
  runId: string;
  entry: RunEntry;
}
/**
 * The last time the same step passed with a capture, before the given failure: the reference to compare a failing screen
 * with. Searches every campaign given, newest result first.
 */
export function findBaseline(
  details: CampaignDetail[],
  failing: Pick<RunEntry, 'platform' | 'nodeId' | 'startedAt' | 'id'>,
): Baseline | undefined {
  let best: Baseline | undefined;
  for (const d of details)
    for (const report of d.reports)
      for (const e of report.entries) {
        if (e.platform !== failing.platform || e.nodeId !== failing.nodeId || e.id === failing.id)
          continue;
        if (!e.screenshot || outcomeOf(e) !== 'passed' || e.precondition) continue;
        if (e.startedAt >= failing.startedAt) continue;
        if (!best || e.startedAt > best.entry.startedAt)
          best = { campaignId: d.campaign.id, runId: report.id, entry: e };
      }
  return best;
}
