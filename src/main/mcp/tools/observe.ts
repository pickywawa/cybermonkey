import { z } from 'zod';
import { campaignProgress, buildScreenGraph, outcomeOf } from '../../../shared/domain/campaign.js';
import { EXPORT_FORMATS, campaignExport } from '../../../shared/domain/campaign-export.js';
import type { RunEntry } from '../../../shared/domain/report.js';
import { OS_LIST, applicableOs, flatten } from '../../../shared/domain/scenario.js';
import { afterSummary, findComponent, onEachOs } from '../devices.js';
import {
  defineTool,
  osName,
  resolveNode,
  resolvePlatforms,
  resolveProject,
  toImage,
  ToolError,
  type ToolImage,
} from '../context.js';
import { describeVariant, loadCampaignDetail, loadHistory, screenSummary } from '../format.js';
import { routeTo } from '../../engine/execution/roots.js';
import { durationProfile } from '../../../shared/domain/profile.js';
import { stabilityOf, unstableSteps } from '../../../shared/domain/stability.js';

const platformsArg = z
  .array(z.enum(['android', 'ios']))
  .optional()
  .describe('OS to act on. Default: the OS currently ticked in the app.');
const projectArg = z.string().optional().describe('Project id or name. Default: the open project.');

export const observeTools = [
  defineTool({
    name: 'screenshot',
    group: 'observe',
    title: 'Screenshot',
    readOnly: true,
    description:
      'Takes a screenshot of each active OS (one image per OS, in the order listed in the text). Use it to SEE the app: after a click, after a failure, to read web-view content that inspect_screen cannot see.',
    input: { platforms: platformsArg, project: projectArg },
    async run(args, ctx) {
      const project = resolveProject(ctx, args.project);
      const results = await onEachOs(
        ctx,
        project,
        resolvePlatforms(project, args.platforms),
        async (id) => toImage(await ctx.c.devices.screenshot(id)),
      );
      const images: ToolImage[] = [];
      const order = results.map((r) => {
        if (r.ok && r.value) return `image #${images.push(r.value)}: ${osName(r.os)} — ${r.device}`;
        return `${osName(r.os)} — ${r.device}: NO IMAGE (${r.error})`;
      });
      return {
        data: {
          summary: order.join(' | '),
          images: order,
          next_steps: ['inspect_screen for the components and selectors, click to interact.'],
        },
        images,
      };
    },
  }),
  defineTool({
    name: 'inspect_screen',
    group: 'observe',
    title: 'Inspect the screen',
    readOnly: true,
    description:
      'Reads the current screen of each active OS: which known screen it is (from your scenarios’ destination markers), and its accessible components with id, label, tappable state AND selector (copy-paste into update_node / add_nodes). Web-view regions that cannot be read are reported as opaque_regions.',
    input: {
      platforms: platformsArg,
      project: projectArg,
      limit: z.number().int().min(10).max(200).default(90).describe('Max components per OS.'),
    },
    async run(args, ctx) {
      const project = resolveProject(ctx, args.project);
      const results = await onEachOs(
        ctx,
        project,
        resolvePlatforms(project, args.platforms),
        async (id, os) =>
          screenSummary(await ctx.c.automation.inspect(id), os, project, args.limit),
      );
      return {
        data: {
          summary: results
            .map(
              (r) =>
                `${osName(r.os)}: ${r.ok ? `on screen “${r.value!.screen}”, ${r.value!.components.length} components` : 'ERROR ' + r.error}`,
            )
            .join(' | '),
          per_os: Object.fromEntries(
            results.map((r) => [
              r.os,
              r.ok
                ? { device: r.device, ...r.value }
                : { device: r.device, error: r.error, hints: r.hints },
            ]),
          ),
          next_steps: [
            'click {component_id | text} to interact, wait_for to wait for a change, find_path to reach a scenario step.',
          ],
        },
      };
    },
  }),
  defineTool({
    name: 'flaky_steps',
    group: 'observe',
    title: 'Unstable and regressed steps',
    readOnly: true,
    description:
      'Reads the history of recent campaigns and tells, per step and OS, whether it is stable, flaky (passes and fails, or only passes on a retry), regressed (passed before, failing now) or always failing. Use it to decide whether a failure deserves a code fix (regression) or a test fix (flaky): “passed 8 of 10” is not a regression.',
    input: {
      campaigns: z
        .number()
        .int()
        .min(1)
        .max(10)
        .default(5)
        .describe('How many recent campaigns to read.'),
      limit: z.number().int().min(1).max(60).default(20),
      project: projectArg,
    },
    async run(args, ctx) {
      const project = resolveProject(ctx, args.project);
      const all = stabilityOf(await loadHistory(ctx, project, args.campaigns));
      const pick = (v: string) => all.filter((s) => s.verdict === v);
      const row = (s: (typeof all)[number]) => ({
        os: s.os,
        step: s.name,
        node_id: s.nodeId,
        verdict: s.verdict,
        pass_rate: `${s.passed}/${s.runs}`,
        recent: s.recent.join(' '),
        ...(s.retried ? { passed_only_on_retry: s.retried } : {}),
        note: s.text,
      });
      const flaky = unstableSteps(all, 2);
      const regressed = [
        ...pick('regression'),
        ...pick('always-failing'),
        ...pick('first-failure'),
      ];
      return {
        data: {
          summary: `${all.length} step/OS pairs read: ${flaky.length} unstable, ${pick('regression').length} regressed, ${pick('always-failing').length} always failing, ${pick('first-failure').length} failing once.`,
          unstable: flaky.slice(0, args.limit).map(row),
          failing: regressed.slice(0, args.limit).map(row),
          next_steps: [
            'regression → read the failure (get_campaign_report), then fix the app or update_node.',
            'unstable → run_element on it a few times with the screen visible; look for a slow render, an animation, a text that changes; audit_selectors for a fragile selector.',
          ],
        },
      };
    },
  }),
  defineTool({
    name: 'slowest_steps',
    group: 'observe',
    title: 'Slowest steps',
    readOnly: true,
    description:
      'Where the time of a campaign goes: the slowest steps per OS (mean / worst wall time over the runs), the total per OS, and how much of the time the engine itself spends gathering evidence (inspections, captures) rather than acting. Use it to speed up a slow campaign: shorten timeouts, replace a fixed wait, add a deep link or a start screen to a scenario, reduce the evidence level.',
    input: {
      campaign: z.string().optional().describe('Campaign id. Default: the active campaign.'),
      limit: z.number().int().min(1).max(40).default(10),
      project: projectArg,
    },
    async run(args, ctx) {
      const project = resolveProject(ctx, args.project);
      const detail = await loadCampaignDetail(ctx, project, args.campaign);
      const p = durationProfile(detail, args.limit);
      const s = (ms: number) => +(ms / 1000).toFixed(2);
      const tips: string[] = [];
      if (p.proofShare !== undefined && p.proofShare > 0.35)
        tips.push(
          `${Math.round(p.proofShare * 100)}% of the time is evidence gathering, not the app: the setting “execution proof” (Settings → Execution) can be lowered from all to key or failures.`,
        );
      const worst = p.slowest[0];
      if (worst && worst.avgMs > 8000)
        tips.push(
          `“${worst.name}” (${osName(worst.os)}) averages ${s(worst.avgMs)}s: check its timeout and whether it waits for something that never changes; run_element on it with the screen visible.`,
        );
      if (p.slowest.some((x) => x.maxMs > 3 * x.avgMs && x.runs > 2))
        tips.push(
          'Some steps vary a lot between runs (max ≫ mean): likely a flaky wait or a slow backend.',
        );
      if (!p.steps)
        tips.push('No timed step yet: run something first (run_scenario / run_campaign).');
      return {
        data: {
          summary: p.steps
            ? `${p.steps} timed steps, ${s(p.totalMs)}s in total` +
              (p.proofShare !== undefined
                ? `, ${Math.round(p.proofShare * 100)}% of it evidence gathering.`
                : '.')
            : 'No timed step in this campaign.',
          total_s: s(p.totalMs),
          per_os: Object.fromEntries(
            Object.entries(p.perOs).map(([os, v]) => [
              os,
              { steps: v!.steps, total_s: s(v!.totalMs) },
            ]),
          ),
          ...(p.proofShare !== undefined ? { evidence_share: p.proofShare } : {}),
          slowest: p.slowest.map((x) => ({
            os: x.os,
            step: x.name,
            node_id: x.nodeId,
            runs: x.runs,
            avg_s: s(x.avgMs),
            max_s: s(x.maxMs),
            ...(x.performMs !== undefined
              ? { acting_s: s(x.performMs), evidence_s: s(x.proofMs ?? 0) }
              : {}),
          })),
          ...(tips.length ? { suggestions: tips } : {}),
          next_steps: ['run_element {"elements":[<node_id>]} to reproduce a slow step.'],
        },
      };
    },
  }),
  defineTool({
    name: 'get_campaign_report',
    group: 'observe',
    title: 'Campaign report',
    readOnly: true,
    description:
      'Report of a campaign: progress per OS and scenario (latest result of each step), the failing steps with message / AI analysis / selector repairs, and the status of each screen. Use format=text|markdown|junit|csv|html|json for a full export.',
    input: {
      campaign: z.string().optional().describe('Campaign id. Default: the active campaign.'),
      format: z.enum(['summary', ...EXPORT_FORMATS]).default('summary'),
      project: projectArg,
    },
    async run(args, ctx) {
      const project = resolveProject(ctx, args.project);
      const detail = await loadCampaignDetail(ctx, project, args.campaign);
      if (args.format !== 'summary')
        return {
          data: {
            campaign: detail.campaign.label,
            format: args.format,
            content: campaignExport(detail, args.format, project).slice(0, 120_000),
          },
        };
      const progress = campaignProgress(detail, project);
      const latest = new Map<string, RunEntry>();
      for (const report of detail.reports)
        for (const e of report.entries)
          if (
            e.kind !== 'scenario' &&
            !e.precondition &&
            !e.preparation &&
            !e.interruption &&
            e.nodeId !== 'engine'
          )
            latest.set(e.platform + ':' + e.nodeId, e);
      const failing = [...latest.values()].filter((e) => outcomeOf(e) === 'failed');
      const graph = buildScreenGraph(detail, project);
      return {
        data: {
          summary: `Campaign “${detail.campaign.label}” (${detail.campaign.status}): ${progress.overall.percent}% done, ${progress.overall.passed} passed, ${progress.overall.failed} failed, ${progress.overall.pending} not run yet.`,
          progress: {
            overall: progress.overall,
            per_os: progress.byOs,
            per_scenario: progress.byScenario.map((s) => ({
              scenario: s.name,
              id: s.id,
              per_os: s.byOs,
            })),
          },
          failing_steps: failing.map((e) => ({
            os: e.platform,
            node_id: e.nodeId,
            step: e.nodeName,
            message: e.operationMessage ?? e.message,
            screen: e.screenAfter?.name,
            analysis: e.analysisData ?? e.analysis,
          })),
          selector_repairs: [...latest.values()]
            .filter((e) => e.healing)
            .map((e) => ({
              os: e.platform,
              node_id: e.nodeId,
              step: e.nodeName,
              from: e.healing!.from?.value,
              to: e.healing!.to.value,
              applied_to_scenario: !!e.healing!.applied,
            })),
          screens: graph.screens.map((s) => ({
            name: s.name,
            status: s.status,
            per_os: Object.fromEntries(
              OS_LIST.filter((os) => s.stats[os]).map((os) => [
                os,
                `${s.stats[os]!.passed} passed / ${s.stats[os]!.failed} failed`,
              ]),
            ),
          })),
          runs: detail.reports.length,
          next_steps: failing.length
            ? ['get_scenario on a failing node_id, then run_element to retry after a fix.']
            : ['Nothing failing in the latest results.'],
        },
      };
    },
  }),
  defineTool({
    name: 'find_path',
    group: 'observe',
    title: 'Find the path to a step',
    readOnly: true,
    description:
      'How to reach a scenario item in the app: the ordered navigations/actions that precede it in its scenario, the screens they lead to (checkpoints you can start from if the app is already on one), its precondition and which OS can follow the path (a missing implementation blocks that OS). Then run_navigation {to} walks there, or run_element {navigate_first} walks and runs it.',
    input: {
      target: z
        .string()
        .describe('Item id or name (a test, an action, a navigation or a scenario).'),
      project: projectArg,
      platforms: platformsArg,
    },
    async run(args, ctx) {
      const project = resolveProject(ctx, args.project);
      const platforms = resolvePlatforms(project, args.platforms);
      const node = resolveNode(project, args.target);
      const route = routeTo(project, node.id);
      if (!route) throw new ToolError('Item not found in any scenario.');
      const steps = route.steps.map(({ node: n, checkpoint }, i) => ({
        order: i + 1,
        id: n.id,
        name: n.name,
        kind: n.kind,
        ...(n.screen ? { leads_to_screen: n.screen.name } : {}),
        ...(checkpoint ? { checkpoint: true } : {}),
        does: Object.fromEntries(
          platforms.map((os) => [
            os,
            describeVariant(n.variants[os]) ??
              (n.platforms && !n.platforms.includes(os) ? 'not applicable' : 'MISSING'),
          ]),
        ),
      }));
      const blocked = platforms.filter((os) =>
        [...route.steps.map((s) => s.node), node].some(
          (n) =>
            n.kind !== 'scenario' &&
            applicableOs(n, project.platforms).includes(os) &&
            !n.variants[os],
        ),
      );
      const targetOs = Object.fromEntries(
        platforms.map((os) => [
          os,
          node.kind === 'scenario'
            ? 'whole scenario'
            : (describeVariant(node.variants[os]) ?? 'MISSING'),
        ]),
      );
      return {
        data: {
          summary: `To reach “${node.name}” in scenario “${route.scenario.name}”: ${steps.length} step(s) first${route.scenario.startScreen ? `, starting from screen “${route.scenario.startScreen.name}”` : ''}.${blocked.length ? ` Blocked on ${blocked.map(osName).join(', ')}: a step has no implementation there.` : ''}`,
          target: { id: node.id, name: node.name, kind: node.kind, does: targetOs },
          scenario: {
            id: route.scenario.id,
            name: route.scenario.name,
            start_screen: route.scenario.startScreen?.name,
          },
          steps,
          precondition_check: route.guard
            ? { id: route.guard.id, name: route.guard.name }
            : undefined,
          blocked_on: blocked,
          how_to: [
            `run_navigation {"to":"${node.id}"} walks the app along these steps (and onto the target itself when it is a navigation) (add "restart_app": true to start from a fresh launch).`,
            `run_element {"elements":["${node.id}"]} walks AND runs it (navigate_first defaults to true).`,
            'If the app is already on a checkpoint screen (check with inspect_screen), run_navigation {"path":[ids after that checkpoint]} is faster.',
          ],
        },
      };
    },
  }),
  defineTool({
    name: 'wait_for',
    group: 'observe',
    title: 'Wait for something on screen',
    readOnly: true,
    description:
      'Waits until a text or a component appears on each active OS (or the timeout expires). Use after an action that triggers loading or a transition.',
    input: {
      text: z.string().optional().describe('Text contained in a label.'),
      component_id: z.string().optional(),
      locator: z
        .object({ using: z.enum(['id', 'accessibility id', 'xpath']), value: z.string() })
        .optional(),
      timeout_s: z.number().min(1).max(60).default(15),
      platforms: platformsArg,
      project: projectArg,
    },
    async run(args, ctx) {
      if (!args.text && !args.component_id && !args.locator)
        throw new ToolError('Give text, component_id or locator.');
      const project = resolveProject(ctx, args.project);
      const started = Date.now();
      const results = await onEachOs(
        ctx,
        project,
        resolvePlatforms(project, args.platforms),
        async (id, os) => {
          let screen = await ctx.c.automation.inspect(id);
          while (true) {
            let found: ReturnType<typeof findComponent>;
            try {
              found = findComponent(screen, {
                text: args.text,
                component_id: args.component_id,
                locator: args.locator,
              });
            } catch {
              found = screen.components[0]; // several matches: it is there
            }
            if (found || Date.now() - started > args.timeout_s * 1000)
              return {
                found: !!found,
                waited_s: +((Date.now() - started) / 1000).toFixed(1),
                screen: afterSummary(screen, os, project, 'summary'),
              };
            await new Promise((r) => setTimeout(r, 300));
            screen = await ctx.c.automation.inspect(id);
          }
        },
      );
      return {
        data: {
          summary: results
            .map(
              (r) =>
                `${osName(r.os)}: ${r.ok ? (r.value!.found ? `found after ${r.value!.waited_s}s` : `NOT found after ${r.value!.waited_s}s`) : 'ERROR ' + r.error}`,
            )
            .join(' | '),
          per_os: Object.fromEntries(
            results.map((r) => [r.os, r.ok ? r.value : { error: r.error, hints: r.hints }]),
          ),
        },
      };
    },
  }),
];
void flatten;
