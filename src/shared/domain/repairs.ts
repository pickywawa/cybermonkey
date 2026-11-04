import type { CampaignDetail, RunEntry } from './report.js';
import type { Project } from './project.js';
import { flatten } from './scenario.js';

export interface PendingRepair {
  runId: string;
  entry: RunEntry;
}
/**
 * Selectors the AI repaired during runs and that the scenarios do not carry yet: until applied, every run repairs them
 * again (slower) and the UI change stays hidden. Only the latest repair of each (OS, step) counts.
 */
export function pendingRepairs(
  detail: CampaignDetail | null,
  project: Pick<Project, 'nodes'>,
): PendingRepair[] {
  const latest = new Map<string, PendingRepair>();
  for (const report of detail?.reports ?? [])
    for (const entry of report.entries)
      if (entry.healing && entry.status === 'passed')
        latest.set(entry.platform + ':' + entry.nodeId, { runId: report.id, entry });
  const exists = new Set(flatten(project.nodes).map((n) => n.id));
  return [...latest.values()].filter(
    (x) => !x.entry.healing!.applied && exists.has(x.entry.nodeId),
  );
}
