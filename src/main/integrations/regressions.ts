import { outcomeOf } from '../../shared/domain/campaign.js';
import { effectiveVariables, type Project } from '../../shared/domain/project.js';
import type { CampaignDetail, RunEntry, RunReport } from '../../shared/domain/report.js';
import type { OS } from '../../shared/domain/scenario.js';
import { redact } from '../../shared/domain/variables.js';
import { stabilityOf } from '../../shared/domain/stability.js';

/** Entries that are results of the tests themselves (no preconditions, preparation, handlers or engine notes). */
export const isResult = (e: RunEntry) =>
  e.kind !== 'scenario' &&
  !e.precondition &&
  !e.preparation &&
  !e.interruption &&
  e.nodeId !== 'engine';

export interface Regression {
  os: OS;
  nodeId: string;
  name: string;
  message: string;
  entryId: string;
  /** « passed 8 of the last 10 runs… » */
  history: string;
  analysis?: string;
  fix?: string;
  verdict?: string;
}

/**
 * Steps that fail in `report` after having passed before. Unreliable steps (passing only sometimes) and steps that
 * never worked are not regressions: reporting them as such would teach people to ignore the message.
 * `others` is the history, `report` is added to it (a persisted copy of `report` in `others` is ignored).
 */
export function findRegressions(
  report: RunReport,
  others: (CampaignDetail | null)[],
): Regression[] {
  const details: CampaignDetail[] = [
    ...others
      .filter((d): d is CampaignDetail => !!d)
      .map((d) => ({ ...d, reports: d.reports.filter((r) => r.id !== report.id) })),
    { campaign: { id: 'now', projectId: report.projectId } as never, reports: [report] },
  ];
  const stability = new Map(stabilityOf(details).map((s) => [s.os + ':' + s.nodeId, s]));
  const latest = new Map<string, RunEntry>();
  for (const e of report.entries) if (isResult(e)) latest.set(e.platform + ':' + e.nodeId, e);
  const out: Regression[] = [];
  for (const [key, e] of latest) {
    if (outcomeOf(e) !== 'failed') continue;
    const s = stability.get(key);
    if (!s || s.passed === 0) continue;
    if (s.verdict !== 'regression' && s.verdict !== 'first-failure') continue;
    out.push({
      os: e.platform,
      nodeId: e.nodeId,
      name: e.nodeName,
      message: (e.operationMessage ?? e.message ?? '').replace(/\s+/g, ' ').trim(),
      entryId: e.id,
      history: s.text,
      analysis: e.analysisData?.summary ?? e.analysis,
      fix: e.analysisData?.fix,
      verdict: e.analysisData?.verdict,
    });
  }
  return out;
}

const SECRET_NAME = /pass|pin|secret|token|code|key|pwd/i;
/** Values of the project's secret-looking variables: never to appear in a message sent outside. */
export const secretsOf = (
  project: Pick<Project, 'variables' | 'environments' | 'activeEnvironmentId'>,
) =>
  Object.entries(effectiveVariables(project))
    .filter(([name, value]) => SECRET_NAME.test(name) && value)
    .map(([, value]) => value);
export const clean = (text: string, secrets: string[]) => redact(text, secrets);
