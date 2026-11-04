import type { CampaignStore } from '../../infra/storage/campaign-store.js';
import { compareImages, describeRegion, type VisualDiff } from '../../infra/visual.js';
import { findBaseline } from '../../../shared/domain/baseline.js';
import type { CampaignDetail } from '../../../shared/domain/report.js';
import type { VisualComparison } from '../../../shared/ipc.js';

/** What the screen looked like the last time this step passed, and what is different now. */
export async function compareWithLastSuccess(
  deps: {
    campaigns: Pick<CampaignStore, 'list' | 'screenshot'>;
    loadCampaign: (projectId: string, campaignId: string) => Promise<CampaignDetail>;
  },
  input: { projectId: string; campaignId: string; runId: string; entryId: string },
  history = 4,
): Promise<VisualComparison | null> {
  const first = await deps.loadCampaign(input.projectId, input.campaignId);
  const failing = first.reports
    .find((r) => r.id === input.runId)
    ?.entries.find((e) => e.id === input.entryId);
  if (!failing?.screenshot) return null;
  const details = [first];
  const baselineIn = () => findBaseline(details, failing);
  if (!baselineIn())
    for (const c of (await deps.campaigns.list(input.projectId)).slice(0, history + 1)) {
      if (c.id === input.campaignId) continue;
      try {
        details.push(await deps.loadCampaign(input.projectId, c.id));
      } catch {
        /* a damaged campaign never blocks the comparison */
      }
      if (baselineIn()) break;
    }
  const base = baselineIn();
  if (!base) return null;
  const [baseline, current] = await Promise.all([
    deps.campaigns.screenshot({
      projectId: input.projectId,
      campaignId: base.campaignId,
      runId: base.runId,
      entryId: base.entry.id,
    }),
    deps.campaigns.screenshot({
      projectId: input.projectId,
      campaignId: input.campaignId,
      runId: input.runId,
      entryId: input.entryId,
    }),
  ]);
  if (!baseline || !current) return null;
  const d: VisualDiff = await compareImages(baseline, current);
  return {
    baseline,
    current,
    diff: d.diff,
    comparable: d.comparable,
    reason: d.reason,
    changedPercent: d.changedPercent,
    regions: d.regions.map((r) => ({ ...r, where: describeRegion(r) })),
    baselineAt: base.entry.startedAt,
  };
}
