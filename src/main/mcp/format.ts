import { compactScreen, type Screen } from '../../shared/domain/devices.js';
import type { Project } from '../../shared/domain/project.js';
import { latestOutcomes, outcomeOf } from '../../shared/domain/campaign.js';
import type { CampaignDetail, RunEntry, RunReport } from '../../shared/domain/report.js';
import {
  OS_LIST,
  applicableOs,
  coverage,
  datasetColumns,
  flatten,
  type OS,
  type ScenarioNode,
  type Variant,
} from '../../shared/domain/scenario.js';
import { identifyScreen } from '../../shared/domain/screens.js';
import { stabilityOf } from '../../shared/domain/stability.js';
import { compareWithLastSuccess } from '../engine/execution/compare.js';
import { toImage, osName, type Ctx, type ToolImage } from './context.js';

/** One-line description of what a variant does, e.g. `tap "Continue" [accessibility id: continue]`. */
export function describeVariant(v: Variant | undefined): string | null {
  if (!v) return null;
  const target = v.point
    ? `position ${Math.round(v.point.x * 100)}%,${Math.round(v.point.y * 100)}%`
    : v.locator
      ? `${v.locator.using}: ${v.locator.value}`
      : '';
  const what =
    v.operation === 'assert'
      ? `assert ${v.assertion}${v.expected ? ` "${v.expected}"` : ''}`
      : v.operation === 'type'
        ? `type "${v.value}"`
        : v.operation === 'swipe'
          ? `swipe ${v.direction}`
          : v.operation === 'capture'
            ? `capture text into \${${v.value}}${v.expected ? ` (regex ${v.expected})` : ''}`
            : v.operation === 'scroll'
              ? `scroll ${v.direction} until visible (max ${v.value || 8})`
              : v.operation === 'wait'
                ? `wait ${v.value || v.timeoutMs}ms`
                : ['deeplink', 'alert', 'orientation', 'background', 'longpress'].includes(
                      v.operation,
                    ) && v.value
                  ? `${v.operation} "${v.value}"`
                  : v.operation;
  return `${what}${v.hint ? ` on “${v.hint}”` : ''}${target ? ` [${target}]` : ''}`;
}

export interface OutlineOptions {
  full?: boolean;
  query?: string;
  tag?: string;
  latest?: Map<string, string>;
}
export function outline(
  project: Project,
  nodes: ScenarioNode[],
  options: OutlineOptions = {},
): unknown[] {
  const q = options.query?.toLowerCase();
  const matches = (n: ScenarioNode): boolean =>
    (!q ||
      n.name.toLowerCase().includes(q) ||
      n.description.toLowerCase().includes(q) ||
      n.children.some(matches)) &&
    (!options.tag || n.tags.includes(options.tag) || n.children.some(matches));
  return nodes.filter(matches).map((n) => {
    const cov = n.kind === 'scenario' ? undefined : coverage(n, project.platforms);
    const latest =
      options.latest && n.kind !== 'scenario'
        ? Object.fromEntries(
            project.platforms.map((os) => [os, options.latest!.get(os + ':' + n.id) ?? 'not-run']),
          )
        : undefined;
    return {
      id: n.id,
      name: n.name,
      kind: n.kind,
      ...(n.tags.length ? { tags: n.tags } : {}),
      ...(n.platforms ? { only_on: n.platforms } : {}),
      ...(n.source ? { source: `${n.source.tool}:${n.source.id}` } : {}),
      ...(n.module ? { module: n.module } : {}),
      ...(n.screen ? { goes_to_screen: n.screen.name } : {}),
      ...(n.startScreen ? { start_screen: n.startScreen.name } : {}),
      ...(n.preconditionId ? { precondition: n.preconditionId } : {}),
      ...(n.blocking ? { blocking: true } : {}),
      ...(n.call
        ? {
            calls_scenario:
              project.nodes.find((r) => r.id === n.call)?.name ?? `missing scenario ${n.call}`,
            calls_scenario_id: n.call,
          }
        : {}),
      ...(n.handler
        ? {
            interruption_handler: {
              when_screen: n.handler.when.name,
              resume: n.handler.resume,
              note: 'Not part of campaigns. Runs automatically when a step fails and this screen is showing, then the step is replayed.',
            },
          }
        : {}),
      ...(n.dataset
        ? {
            dataset: {
              rows: n.dataset.rows.length,
              columns: datasetColumns(n.dataset),
              first_row: n.dataset.rows[0],
            },
          }
        : {}),
      ...(n.when
        ? {
            only_if: Object.fromEntries(
              OS_LIST.filter((os) => n.when![os]).map((os) => [os, describeVariant(n.when![os])]),
            ),
          }
        : {}),
      ...(cov
        ? {
            variants: Object.fromEntries(
              applicableOs(n, project.platforms).map((os) => [
                os,
                n.variants[os] ? 'ok' : 'MISSING',
              ]),
            ),
          }
        : {}),
      ...(latest ? { latest } : {}),
      ...(options.full && cov
        ? {
            actions: Object.fromEntries(
              OS_LIST.filter((os) => n.variants[os]).map((os) => [
                os,
                describeVariant(n.variants[os]),
              ]),
            ),
          }
        : {}),
      ...(n.children.length ? { children: outline(project, n.children, options) } : {}),
    };
  });
}
export async function latestFor(ctx: Ctx, project: Project): Promise<Map<string, string>> {
  if (!project.activeCampaignId) return new Map();
  try {
    return latestOutcomes(await ctx.c.runner.loadCampaign(project.id, project.activeCampaignId));
  } catch {
    return new Map();
  }
}

/** Current screen of a device in terms the AI can use: identified screen, components (with selectors), opaque regions. */
export function screenSummary(screen: Screen, os: OS, project: Project, limit = 90) {
  const identity = identifyScreen(screen, os, project.nodes);
  const compact = compactScreen(screen, limit);
  const byId = new Map(screen.components.map((c) => [c.id, c]));
  return {
    screen: identity.identified ? identity.name : 'unknown (not defined by any scenario)',
    screen_id: identity.identified ? identity.id : undefined,
    size: compact.size,
    components: compact.components.map(
      ({ id, type, label, text, tap, disabled, secure, selected }) => ({
        id,
        type,
        label,
        ...(text ? { text } : {}),
        ...(tap ? { tappable: true } : {}),
        ...(disabled ? { disabled: true } : {}),
        ...(secure ? { secure: true } : {}),
        ...(selected ? { selected: true } : {}),
        selector: byId.get(id)?.locator,
      }),
    ),
    ...(compact.truncated ? { truncated: true } : {}),
    ...(screen.opaque?.length
      ? {
          opaque_regions: screen.opaque,
          note: 'Web-view content is not readable here: use screenshot, then click with point (fractions of the screen).',
        }
      : {}),
  };
}

const failureHints = (entry: RunEntry): string[] => {
  const m = entry.message;
  const os = osName(entry.platform);
  if (/introuvable|not found|Composant/i.test(m))
    return [
      `The selector no longer matches on ${os}. Call inspect_screen (platform ${entry.platform}) on that screen, then update_node to fix variants.${entry.platform}.locator. A UI change is the usual cause.`,
    ];
  if (/ambigu|ambiguous/i.test(m))
    return [
      `Several components match the selector on ${os}: pick a more specific selector from inspect_screen and update_node.`,
    ];
  if (/Texte|text/i.test(m) && /attendu|expected/i.test(m))
    return [
      'The displayed text differs from the expectation: a regression, or a deliberate change. If deliberate, update_node variants.<os>.expected.',
    ];
  if (/Écran destination|destination/i.test(m))
    return [
      'The destination screen was not recognized: check the navigation markers (update_node screen.variants.<os>.markers) or whether the navigation really leads there.',
    ];
  if (/Variable absente|variable/i.test(m))
    return ['A ${VARIABLE} used by the scenario is missing: call list_variables.'];
  if (/Appareil|device|session/i.test(m))
    return [`Device problem on ${os}: call get_device_health.`];
  return [
    'Call screenshot and inspect_screen to see the real state of the app, then compare with the scenario (get_scenario).',
  ];
};

export async function summarizeRun(
  ctx: Ctx,
  report: RunReport,
  project: Project,
  extra: { maxImages?: number } = {},
) {
  // Entries of interruption handlers are not test results: they are reported apart, as what was done about a problem.
  const steps = report.entries.filter(
    (e) => e.kind !== 'scenario' && !e.precondition && e.nodeId !== 'engine' && !e.interruption,
  );
  const engine = report.entries.filter(
    (e) =>
      e.nodeId === 'engine' ||
      e.deviceId.startsWith('missing:') ||
      // The scenario itself could not start (start screen unreachable, app not launching…): its steps are then skipped.
      // (a scenario that "failed" only because a child failed is not a start problem: the child is listed in failures)
      (e.kind === 'scenario' &&
        !e.interruption &&
        ['failed', 'blocked'].includes(outcomeOf(e)) &&
        !/enfants ont échoué|child steps failed/i.test(e.message)),
  );
  const duration = (e: RunEntry) =>
    e.finishedAt
      ? +((Date.parse(e.finishedAt) - Date.parse(e.startedAt)) / 1000).toFixed(2)
      : undefined;
  const perOs = Object.fromEntries(
    (report.platforms ?? OS_LIST).map((os) => {
      const list = steps.filter((e) => e.platform === os);
      const count = (s: string) => list.filter((e) => outcomeOf(e) === s).length;
      const problem = engine.find((e) => e.platform === os);
      const status =
        problem && !count('passed') && !count('failed')
          ? 'blocked'
          : count('failed')
            ? 'failed'
            : count('blocked')
              ? 'blocked'
              : count('passed')
                ? 'passed'
                : count('skipped')
                  ? 'skipped'
                  : 'nothing-ran';
      return [
        os,
        {
          status,
          passed: count('passed'),
          failed: count('failed'),
          blocked: count('blocked'),
          skipped: count('skipped'),
          not_applicable: count('na'),
          ...(problem ? { problem: problem.message } : {}),
        },
      ];
    }),
  );
  const failures = steps.filter((e) => outcomeOf(e) === 'failed');
  // Steps of called sub-scenarios are not part of the snapshot roots: look them up in the project too.
  const nodes = new Map(flatten([...project.nodes, ...report.snapshot]).map((n) => [n.id, n]));
  const images: ToolImage[] = [];
  const imageOf: Record<string, number> = {};
  for (const e of failures.slice(0, extra.maxImages ?? 4)) {
    try {
      const url =
        report.campaignId &&
        (await ctx.c.campaigns.screenshot({
          projectId: project.id,
          campaignId: report.campaignId,
          runId: report.id,
          entryId: e.id,
        }));
      if (url) imageOf[e.id] = images.push(await toImage(url));
    } catch {
      /* the capture is a bonus */
    }
  }
  // What changed on screen since the last time this step passed (the first failures only: it costs a few image reads).
  const visual: Record<string, Record<string, unknown>> = {};
  for (const e of failures.slice(0, 2))
    try {
      if (!report.campaignId || !e.screenshot) continue;
      const cmp = await compareWithLastSuccess(
        { campaigns: ctx.c.campaigns, loadCampaign: (p, id) => ctx.c.runner.loadCampaign(p, id) },
        { projectId: project.id, campaignId: report.campaignId, runId: report.id, entryId: e.id },
      );
      if (!cmp) continue;
      if (!cmp.comparable) {
        visual[e.id] = { note: cmp.reason };
        continue;
      }
      let image: number | undefined;
      if (cmp.diff) image = images.push(await toImage(cmp.diff));
      visual[e.id] = {
        last_passed_at: cmp.baselineAt,
        changed_percent: cmp.changedPercent,
        changed_areas: cmp.regions
          .slice(0, 5)
          .map((r) => `${r.where} (${Math.round(r.share * 100)}% of the screen)`),
        ...(image
          ? {
              diff_image: `image #${image} of this response: failing screen, changed areas outlined in red`,
            }
          : {}),
        reading:
          cmp.changedPercent < 1
            ? 'The screen looks the same as when it last passed: the failure is probably timing, state or data, not the layout.'
            : cmp.changedPercent > 40
              ? 'Most of the screen differs: the app is on another screen, or in another state (login, error page, dialog).'
              : 'Part of the screen changed: compare the outlined areas with the step’s target.',
      };
    } catch {
      /* the comparison is a bonus */
    }
  const overall = Object.values(perOs).some((o) => o.status === 'failed')
    ? 'failed'
    : Object.values(perOs).some((o) => o.status === 'blocked')
      ? 'blocked'
      : Object.values(perOs).some((o) => o.status === 'passed')
        ? 'passed'
        : Object.values(perOs).some((o) => o.status === 'skipped')
          ? 'skipped'
          : 'nothing-ran';
  // History tells a regression from a fragile test: the single most useful fact when a step fails.
  const history = failures.length
    ? new Map(
        stabilityOf(await loadHistory(ctx, project, 4)).map((s) => [s.os + ':' + s.nodeId, s]),
      )
    : new Map<string, ReturnType<typeof stabilityOf>[number]>();
  const failureData = failures.map((e) => ({
    os: e.platform,
    node_id: e.nodeId,
    step: e.nodeName,
    ...(e.iteration
      ? { dataset_row: `${e.iteration.index}/${e.iteration.total} (${e.iteration.label})` }
      : {}),
    kind: e.kind,
    message: e.operationMessage ?? e.message,
    screen: e.screenAfter?.name ?? e.screenBefore?.name,
    action: describeVariant(nodes.get(e.nodeId)?.variants[e.platform]),
    ...(history.get(e.platform + ':' + e.nodeId)
      ? {
          history: {
            verdict: history.get(e.platform + ':' + e.nodeId)!.verdict,
            text: history.get(e.platform + ':' + e.nodeId)!.text,
            recent: history.get(e.platform + ':' + e.nodeId)!.recent.join(' '),
          },
        }
      : {}),
    ...(e.analysisData ? { analysis: e.analysisData } : e.analysis ? { analysis: e.analysis } : {}),
    ...(e.healing
      ? {
          selector_repaired_by_ai: {
            from: e.healing.from?.value,
            to: e.healing.to.value,
            reason: e.healing.reason,
          },
        }
      : {}),
    ...(imageOf[e.id] ? { capture: `image #${imageOf[e.id]} of this response` } : {}),
    ...(visual[e.id] ? { since_last_pass: visual[e.id] } : {}),
    ...(e.video
      ? {
          video: `Screen recording kept (starts ${e.videoAt ?? 0}s into it): in Cybermonkey open Execution → Results → this step → video. Not viewable through MCP.`,
        }
      : {}),
    ...(e.networkHints?.length ? { network_hints: e.networkHints } : {}),
    ...(e.deviceLog ? { device_log: e.deviceLog.split('\n').slice(-12) } : {}),
    what_to_do: failureHints(e),
  }));
  return {
    images,
    data: {
      run_id: report.id,
      campaign_id: report.campaignId,
      ...(report.environment ? { environment: report.environment } : {}),
      status: report.status === 'running' ? 'running' : overall,
      summary:
        `${overall.toUpperCase()}: ` +
        Object.entries(perOs)
          .map(
            ([os, o]) =>
              `${osName(os as OS)} ${o.status} (${o.passed} passed, ${o.failed} failed${o.blocked ? `, ${o.blocked} blocked` : ''}${o.skipped ? `, ${o.skipped} skipped` : ''}${o.not_applicable ? `, ${o.not_applicable} n/a` : ''})`,
          )
          .join(' · '),
      per_os: perOs,
      failures: failureData,
      interruptions_handled: steps
        .filter((e) => e.interruptions?.length)
        .map((e) => ({
          os: e.platform,
          step: e.nodeName,
          node_id: e.nodeId,
          step_result: outcomeOf(e),
          what_happened: e.interruptions!.map((i) => ({
            kind: i.kind,
            what: i.name,
            ...(i.detail ? { detail: i.detail } : {}),
            worked: i.ok,
          })),
          note: e.interruptions!.some((i) => i.kind === 'ai-dismiss')
            ? 'The AI closed an unexpected popup. If it comes back, make it permanent: add_nodes a scenario with "handler" (what is on screen + the steps to deal with it).'
            : undefined,
        })),
      flaky_steps: steps
        .filter((e) => e.flaky && outcomeOf(e) === 'passed')
        .map((e) => ({
          os: e.platform,
          step: e.nodeName,
          node_id: e.nodeId,
          note: 'Passed only on the second attempt: it works but is not reliable. Look for a slow render, an animation or an unstable selector (audit_selectors, flaky_steps).',
        })),
      healed_selectors: steps
        .filter((e) => e.healing && outcomeOf(e) === 'passed')
        .map((e) => ({
          os: e.platform,
          step: e.nodeName,
          node_id: e.nodeId,
          from: e.healing!.from?.value,
          to: e.healing!.to.value,
          how_to_keep: 'update_node with this selector, or the next run repairs it again.',
        })),
      gaps: steps
        .filter((e) => outcomeOf(e) === 'skipped' && /compl/i.test(e.message))
        .map((e) => ({ os: e.platform, step: e.nodeName, node_id: e.nodeId, message: e.message })),
      skipped_steps: steps
        .filter((e) => outcomeOf(e) === 'skipped')
        .map((e) => ({ os: e.platform, step: e.nodeName, node_id: e.nodeId, reason: e.message })),
      passed_steps: steps
        .filter((e) => outcomeOf(e) === 'passed')
        .slice(0, 60)
        .map(
          (e) =>
            `${e.platform}: ${e.nodeName}${duration(e) !== undefined ? ` (${duration(e)}s)` : ''}`,
        ),
      device_problems: engine.map((e) => ({ os: e.platform, message: e.message })),
    },
  };
}
/** The newest campaigns of a project with their reports (for step history). */
export async function loadHistory(
  ctx: Ctx,
  project: Project,
  count = 5,
): Promise<CampaignDetail[]> {
  const list = (await ctx.c.campaigns.list(project.id)).slice(0, count);
  const out: CampaignDetail[] = [];
  for (const c of list)
    try {
      out.push(await ctx.c.runner.loadCampaign(project.id, c.id));
    } catch {
      /* a damaged campaign never blocks the answer */
    }
  return out;
}
export async function loadCampaignDetail(
  ctx: Ctx,
  project: Project,
  campaignId?: string,
): Promise<CampaignDetail> {
  const id = campaignId ?? project.activeCampaignId;
  if (!id)
    throw new (await import('./context.js')).ToolError('This project has no campaign yet.', [
      'Run something (run_scenario creates a campaign) or call list_campaigns.',
    ]);
  return ctx.c.runner.loadCampaign(project.id, id);
}
