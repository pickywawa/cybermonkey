import { tr } from './i18n.js';
import { outcomeOf } from '../../shared/domain/campaign.js';
import type { TrackerKind, TrackerSettings } from '../../shared/domain/integrations.js';
import type { RunReport } from '../../shared/domain/report.js';
import { flatten, type ScenarioNode } from '../../shared/domain/scenario.js';
import type { Settings } from '../../shared/domain/settings.js';
import type { Confirmer, FinishedRun, Journal } from './context.js';
import { basicAuth, request, trimSlash } from './http.js';
import { clean, isResult } from './regressions.js';
import type { SecretStore } from './secrets.js';

export interface CaseResult {
  caseId: string;
  scenario: string;
  status: 'passed' | 'failed';
  elapsedS: number;
  comment: string;
}

/** `[testrail:C123]`, `azure:456`… The reference an imported test case carries on its scenario. */
export function caseIdFor(node: ScenarioNode, kind: TrackerKind): string | undefined {
  const ref = node.source;
  if (!ref || !ref.tool.toLowerCase().includes(kind)) return undefined;
  const id = ref.id.replace(/^[A-Za-z]+[-_ ]?/, '').trim();
  return /^\d+$/.test(id) ? id : undefined;
}

/**
 * One result per scenario linked to a case of the tool. Both OS are folded into one verdict (a case has a single
 * status): failed if anything failed on either OS, passed if something passed and nothing failed. A scenario that
 * did not run at all is left out rather than reported as skipped.
 */
export function collectResults(
  report: RunReport,
  kind: TrackerKind,
  secrets: string[],
): { results: CaseResult[]; unlinked: number } {
  const roots = report.snapshot.filter((n) => n.kind === 'scenario');
  const results: CaseResult[] = [];
  let unlinked = 0;
  for (const root of roots) {
    const caseId = caseIdFor(root, kind);
    if (!caseId) {
      unlinked++;
      continue;
    }
    const ids = new Set(flatten([root]).map((n) => n.id));
    const entries = report.entries.filter((e) => isResult(e) && ids.has(e.nodeId) && e.finishedAt);
    const failed = entries.filter((e) => outcomeOf(e) === 'failed');
    const passed = entries.filter((e) => outcomeOf(e) === 'passed');
    if (!failed.length && !passed.length) continue;
    const elapsedMs = entries.reduce(
      (sum, e) => sum + Math.max(0, Date.parse(e.finishedAt!) - Date.parse(e.startedAt)),
      0,
    );
    const comment = failed.length
      ? failed
          .slice(0, 5)
          .map(
            (e) =>
              `[${e.platform}] ${e.nodeName} — ${(e.operationMessage ?? e.message ?? '').replace(/\s+/g, ' ').slice(0, 300)}`,
          )
          .join('\n')
      : `${passed.length} step(s) passed`;
    results.push({
      caseId,
      scenario: root.name,
      status: failed.length ? 'failed' : 'passed',
      elapsedS: Math.max(1, Math.round(elapsedMs / 1000)),
      comment: clean(
        `Cybermonkey${report.environment ? ' · ' + report.environment : ''}\n${comment}`,
        secrets,
      ),
    });
  }
  return { results, unlinked };
}

/* ---------- TestRail ---------- */
const TESTRAIL_STATUS = { passed: 1, failed: 5 } as const;
export async function pushTestrail(
  c: TrackerSettings['testrail'],
  apiKey: string,
  runName: string,
  results: CaseResult[],
  fetchImpl?: typeof fetch,
): Promise<string> {
  if (!c.url || !c.username || !c.projectId)
    throw new Error(
      tr(
        'TestRail : URL, utilisateur et identifiant de projet requis',
        'TestRail: URL, user and project id are required',
      ),
    );
  const api = `${trimSlash(c.url)}/index.php?/api/v2/`;
  const opts = {
    headers: { Authorization: basicAuth(c.username, apiKey) },
    secrets: [apiKey],
    fetchImpl,
  };
  const run = await request<{ id: number; url?: string }>(
    `${api}add_run/${encodeURIComponent(c.projectId)}`,
    {
      ...opts,
      body: {
        name: runName,
        ...(c.suiteId ? { suite_id: Number(c.suiteId) } : {}),
        include_all: false,
        case_ids: results.map((r) => Number(r.caseId)),
      },
    },
  );
  await request(`${api}add_results_for_cases/${run.id}`, {
    ...opts,
    body: {
      results: results.map((r) => ({
        case_id: Number(r.caseId),
        status_id: TESTRAIL_STATUS[r.status],
        comment: r.comment,
        elapsed: `${r.elapsedS}s`,
      })),
    },
  });
  return run.url ?? `${trimSlash(c.url)}/index.php?/runs/view/${run.id}`;
}

/* ---------- Azure Test Plans ---------- */
const AZURE_VERSION = 'api-version=7.1';
export async function pushAzure(
  c: TrackerSettings['azure'],
  pat: string,
  runName: string,
  results: CaseResult[],
  fetchImpl?: typeof fetch,
): Promise<string> {
  if (!c.url || !c.project || !c.planId || !c.suiteId)
    throw new Error(
      tr(
        'Azure Test Plans : URL, projet, plan et suite requis',
        'Azure Test Plans: URL, project, plan and suite are required',
      ),
    );
  const base = `${trimSlash(c.url)}/${encodeURIComponent(c.project)}/_apis`;
  const opts = { headers: { Authorization: basicAuth('', pat) }, secrets: [pat], fetchImpl };
  // A case is run through its « test point » (case × configuration) in the plan's suite.
  const points = new Map<string, number[]>();
  for (const r of results) {
    const found = await request<{ value?: { id: number }[] }>(
      `${base}/testplan/Plans/${c.planId}/Suites/${c.suiteId}/TestPoint?testCaseId=${r.caseId}&${AZURE_VERSION}`,
      opts,
    );
    points.set(
      r.caseId,
      (found.value ?? []).map((p) => p.id),
    );
  }
  const linked = results.filter((r) => points.get(r.caseId)?.length);
  if (!linked.length)
    throw new Error(
      tr(
        'Azure Test Plans : aucun des cas n’est dans cette suite du plan',
        'Azure Test Plans: none of the cases is in this suite of the plan',
      ),
    );
  const run = await request<{ id: number; webAccessUrl?: string }>(
    `${base}/test/runs?${AZURE_VERSION}`,
    {
      ...opts,
      body: {
        name: runName,
        plan: { id: Number(c.planId) },
        pointIds: linked.flatMap((r) => points.get(r.caseId)!),
      },
    },
  );
  const created = await request<{
    value?: { id: number; testCase?: { id?: string }; testPoint?: { id?: string } }[];
  }>(`${base}/test/Runs/${run.id}/results?${AZURE_VERSION}`, opts);
  const byCase = new Map(linked.map((r) => [r.caseId, r]));
  const patch = (created.value ?? []).flatMap((row) => {
    const r = byCase.get(String(row.testCase?.id ?? ''));
    return r
      ? [
          {
            id: row.id,
            outcome: r.status === 'passed' ? 'Passed' : 'Failed',
            state: 'Completed',
            comment: r.comment,
            durationInMs: r.elapsedS * 1000,
          },
        ]
      : [];
  });
  if (!patch.length)
    throw new Error(
      tr(
        'Azure Test Plans : le run a été créé mais ses résultats sont introuvables',
        'Azure Test Plans: the run was created but its results cannot be found',
      ),
    );
  await request(`${base}/test/Runs/${run.id}/results?${AZURE_VERSION}`, {
    ...opts,
    method: 'PATCH',
    body: patch,
  });
  await request(`${base}/test/runs/${run.id}?${AZURE_VERSION}`, {
    ...opts,
    method: 'PATCH',
    body: { state: 'Completed' },
  });
  return (
    run.webAccessUrl ??
    `${trimSlash(c.url)}/${encodeURIComponent(c.project)}/_testManagement/runs?runId=${run.id}`
  );
}

/* ---------- service ---------- */
export class TrackerService {
  constructor(
    private d: {
      settings: () => Settings;
      secrets: SecretStore;
      journal: Journal;
      confirm?: Confirmer;
      fetchImpl?: typeof fetch;
    },
  ) {}
  private cfg() {
    return this.d.settings().integrations.trackers;
  }

  async onFinished(f: FinishedRun) {
    const c = this.cfg();
    if (c.mode === 'off' || f.report.status === 'running' || f.report.status === 'cancelled')
      return;
    const label = c.kind === 'testrail' ? 'TestRail' : 'Azure Test Plans';
    const fr = this.d.settings().language !== 'en';
    try {
      const { results, unlinked } = collectResults(f.report, c.kind, f.secrets);
      if (!results.length) {
        this.d.journal.add(
          c.kind,
          true,
          fr
            ? `Aucun scénario lié à un cas ${label} dans cette exécution${unlinked ? ` (${unlinked} non lié(s) : importez le cas depuis ${label} pour conserver le lien)` : ''}.`
            : `No scenario linked to a ${label} case in this run${unlinked ? ` (${unlinked} unlinked: import the case from ${label} to keep the link)` : ''}.`,
        );
        return;
      }
      let runName = `Cybermonkey · ${f.project.name} · ${f.campaignLabel}`;
      if (c.mode === 'ask') {
        const answer = await this.d.confirm?.({
          kind: 'tracker',
          title: fr ? `Envoyer les résultats vers ${label} ?` : `Send the results to ${label}?`,
          message: fr
            ? `${results.length} cas lié(s) (${results.filter((r) => r.status === 'failed').length} en échec)${unlinked ? `, ${unlinked} scénario(s) sans lien ignoré(s)` : ''}. Un nouveau run sera créé.`
            : `${results.length} linked case(s) (${results.filter((r) => r.status === 'failed').length} failed)${unlinked ? `, ${unlinked} unlinked scenario(s) ignored` : ''}. A new run will be created.`,
          details: results
            .slice(0, 10)
            .map((r) => `${r.status === 'passed' ? '✔' : '✘'} C${r.caseId} — ${r.scenario}`),
          editable: { label: fr ? 'Nom du run' : 'Run name', value: runName, rows: 1 },
          confirmLabel: fr ? 'Envoyer' : 'Send',
        });
        if (!answer) {
          this.d.journal.add(
            c.kind,
            true,
            tr(
              'Envoi proposé mais aucune fenêtre pour répondre : ignoré.',
              'Push offered but no window to answer: skipped.',
            ),
          );
          return;
        }
        if (!answer.accepted) return;
        runName = (answer.edited ?? '').trim() || runName;
      }
      const url =
        c.kind === 'testrail'
          ? await pushTestrail(
              c.testrail,
              await this.need('testrailApiKey', tr('Clé d’API TestRail', 'TestRail API key')),
              runName,
              results,
              this.d.fetchImpl,
            )
          : await pushAzure(
              c.azure,
              await this.need('azurePat', tr('Jeton Azure DevOps', 'Azure DevOps token')),
              runName,
              results,
              this.d.fetchImpl,
            );
      this.d.journal.add(
        c.kind,
        true,
        tr(
          `${results.length} résultat(s) envoyé(s) : ${url}`,
          `${results.length} result(s) sent: ${url}`,
        ),
      );
    } catch (error) {
      this.d.journal.add(c.kind, false, String((error as Error).message).slice(0, 300));
    }
  }
  private async need(key: 'testrailApiKey' | 'azurePat', label: string) {
    const v = await this.d.secrets.get(key);
    if (!v) throw new Error(label + tr(' non renseigné', ' not set'));
    return v;
  }

  /** Read-only check of the credentials and of the target. */
  async test(): Promise<{ ok: boolean; message: string }> {
    const c = this.cfg();
    try {
      if (c.kind === 'testrail') {
        const t = c.testrail;
        if (!t.url || !t.username)
          throw new Error(tr('URL et utilisateur requis', 'URL and user are required'));
        const key = await this.need('testrailApiKey', tr('Clé d’API TestRail', 'TestRail API key'));
        const project = await request<{ name: string }>(
          `${trimSlash(t.url)}/index.php?/api/v2/get_project/${encodeURIComponent(t.projectId)}`,
          {
            headers: { Authorization: basicAuth(t.username, key) },
            secrets: [key],
            fetchImpl: this.d.fetchImpl,
          },
        );
        return {
          ok: true,
          message: tr(
            `Projet TestRail « ${project.name} » accessible.`,
            `TestRail project “${project.name}” reachable.`,
          ),
        };
      }
      const a = c.azure;
      if (!a.url || !a.project)
        throw new Error(tr('URL et projet requis', 'URL and project are required'));
      const pat = await this.need('azurePat', tr('Jeton Azure DevOps', 'Azure DevOps token'));
      const plan = await request<{ name?: string }>(
        `${trimSlash(a.url)}/${encodeURIComponent(a.project)}/_apis/testplan/plans/${a.planId}?${AZURE_VERSION}`,
        {
          headers: { Authorization: basicAuth('', pat) },
          secrets: [pat],
          fetchImpl: this.d.fetchImpl,
        },
      );
      return {
        ok: true,
        message: tr(
          `Plan de test « ${plan.name ?? a.planId} » accessible.`,
          `Test plan “${plan.name ?? a.planId}” reachable.`,
        ),
      };
    } catch (error) {
      return { ok: false, message: String((error as Error).message) };
    }
  }
}
