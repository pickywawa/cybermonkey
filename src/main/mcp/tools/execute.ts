import { z } from 'zod';
import type { Project } from '../../../shared/domain/project.js';
import type { OS, ScenarioNode } from '../../../shared/domain/scenario.js';
import { flatten, isSupportScenario } from '../../../shared/domain/scenario.js';
import type { RunRequest } from '../../../shared/ipc.js';
import { partialRoot, routeTo, sequenceRoot } from '../../engine/execution/roots.js';
import { afterSummary, onEachOs } from '../devices.js';
import {
  defineTool,
  osName,
  readyDevices,
  resolveNode,
  resolvePlatforms,
  resolveProject,
  ToolError,
  type Ctx,
} from '../context.js';
import { summarizeRun } from '../format.js';

const platformsArg = z
  .array(z.enum(['android', 'ios']))
  .optional()
  .describe(
    'OS to run on. Default: the OS currently ticked in the app. Both are run in parallel when both are ticked.',
  );
const projectArg = z.string().optional().describe('Project id or name. Default: the open project.');
const campaignArg = z
  .enum(['current', 'new'])
  .default('current')
  .describe('Results are stored in a campaign: the active one, or a fresh one.');
const waitArgs = {
  wait: z
    .boolean()
    .default(true)
    .describe(
      'Wait for the end of the run and return its result. false: return at once with a run_id, poll with get_run_status.',
    ),
  timeout_s: z
    .number()
    .int()
    .min(10)
    .max(3600)
    .default(600)
    .describe('Max wait. On expiry the run keeps going and you get its progress.'),
};
const prepArg = z
  .enum(['off', 'existing', 'ai'])
  .default('existing')
  .describe(
    'How to reach the start screen of a partial run: off = trust the current screen, existing = replay known navigations, ai = let the AI find its way as a last resort.',
  );

export interface Launch {
  platforms: OS[];
  nodeId?: string;
  onlySelf?: boolean;
  roots?: ScenarioNode[];
  restartApp?: boolean;
  preparation: 'off' | 'existing' | 'ai';
  campaign: 'current' | 'new';
  wait: boolean;
  timeoutS: number;
}

async function ensureCampaign(ctx: Ctx, project: Project, mode: 'current' | 'new') {
  const { campaigns, store } = ctx.c;
  if (mode === 'current' && project.activeCampaignId) {
    const existing = await campaigns.load(project.id, project.activeCampaignId).catch(() => null);
    if (existing?.campaign.status === 'open') return project.activeCampaignId;
  }
  const created = await campaigns.create(project.id, 'MCP · ' + new Date().toLocaleString('en-GB'));
  await store.update({ id: project.id, activeCampaignId: created.id });
  ctx.c.emit({ type: 'workspace' });
  return created.id;
}

/** Start a run on the ready devices of the requested OS, optionally wait for its end, and describe the result. */
export async function launch(ctx: Ctx, project: Project, input: Launch) {
  if (ctx.c.runner.isRunning())
    throw new ToolError('A run is already in progress.', [
      'get_run_status to follow it, cancel_run to stop it.',
    ]);
  const { ready, skipped } = readyDevices(ctx, project, input.platforms);
  const campaignId = await ensureCampaign(ctx, project, input.campaign);
  const request: RunRequest = {
    projectId: project.id,
    campaignId,
    platforms: ready.map((r) => r.os),
    nodeId: input.nodeId,
    onlySelf: input.onlySelf,
    roots: input.roots,
    restartApp: input.restartApp,
    preparation: input.preparation,
    deviceIds: ready.map((r) => r.device.id),
  };
  const started = await ctx.c.runner.start(request);
  const header = {
    devices: Object.fromEntries(ready.map((r) => [r.os, r.device.name])),
    ...(skipped.length ? { skipped_os: skipped } : {}),
  };
  if (!input.wait)
    return {
      data: {
        run_id: started.id,
        status: 'running',
        summary: `Run started on ${ready.map((r) => osName(r.os)).join(' + ')}.`,
        ...header,
        next_steps: ['get_run_status {run_id} to follow it.'],
      },
    };
  const abort = () => ctx.c.runner.cancel();
  ctx.signal.addEventListener('abort', abort, { once: true });
  let finished: boolean;
  try {
    finished = await ctx.c.runner.waitForRun(started.id, input.timeoutS * 1000);
  } finally {
    ctx.signal.removeEventListener('abort', abort);
  }
  const report = ctx.c.runner.getReport(started.id) ?? started;
  const fresh = ctx.c.store.get(project.id);
  const summary = await summarizeRun(ctx, report, fresh);
  const data = { ...summary.data, ...header } as Record<string, unknown>;
  if (!finished) {
    data.summary = `STILL RUNNING after ${input.timeoutS}s. ${data.summary}`;
    data.next_steps = ['get_run_status {run_id} to wait more, cancel_run to stop.'];
  } else if (data.status === 'passed')
    data.next_steps = [
      'Nothing to fix. Replay other items with run_element / run_scenario if needed.',
    ];
  else if (data.status === 'skipped' || data.status === 'nothing-ran')
    data.next_steps = [
      'Nothing was actually executed: read skipped_steps[].reason (missing variant for this OS, precondition not met, not applicable). Fix with update_node / add_nodes, or pick the other OS.',
    ];
  else if (data.status === 'blocked')
    data.next_steps = [
      'The run could not start or reach the right screen: read device_problems[].message. Put the app on the start screen (run_navigation with restart_app, or click/back) then retry with preparation "off"; a missing device: get_device_health.',
    ];
  else
    data.next_steps = [
      'Read failures[].what_to_do and the capture; get_scenario / inspect_screen to compare; fix with update_node then run_element to confirm.',
    ];
  return { data, images: summary.images };
}

const stepsOf = (project: Project, ids: string[]) => ids.map((id) => resolveNode(project, id));

export const executeTools = [
  defineTool({
    name: 'run_scenario',
    group: 'execute',
    title: 'Run a scenario',
    description:
      'Runs a whole scenario (relaunches the app first by default) on each active OS in parallel and waits for the result: passed/failed per OS, failing step with message, AI analysis and screenshot, selector repairs. Results land in the campaign.',
    input: {
      scenario: z.string().describe('Scenario id or name.'),
      platforms: platformsArg,
      campaign: campaignArg,
      restart_app: z
        .boolean()
        .optional()
        .describe('Relaunch the app first (default true for a whole scenario).'),
      preparation: prepArg,
      project: projectArg,
      ...waitArgs,
    },
    async run(a, ctx) {
      const project = resolveProject(ctx, a.project);
      const node = resolveNode(project, a.scenario);
      if (node.kind !== 'scenario')
        throw new ToolError(`“${node.name}” is a ${node.kind}, not a scenario.`, [
          `Use run_element {"elements":["${node.id}"]} for a single item or run_folder for a group.`,
        ]);
      return launch(ctx, project, {
        platforms: resolvePlatforms(project, a.platforms),
        nodeId: node.id,
        restartApp: a.restart_app,
        preparation: a.preparation,
        campaign: a.campaign,
        wait: a.wait,
        timeoutS: a.timeout_s,
      });
    },
  }),
  defineTool({
    name: 'run_campaign',
    group: 'execute',
    title: 'Run the whole campaign',
    description:
      'Runs every scenario of the project (optionally only those carrying a tag) on each active OS and waits. Can take long: use wait=false and get_run_status for large projects.',
    input: {
      tag: z.string().optional().describe('Only scenarios carrying this tag.'),
      platforms: platformsArg,
      campaign: campaignArg,
      preparation: prepArg,
      project: projectArg,
      ...waitArgs,
    },
    async run(a, ctx) {
      const project = resolveProject(ctx, a.project);
      let roots: ScenarioNode[] | undefined;
      if (a.tag) {
        roots = structuredClone(
          project.nodes.filter(
            (n) => !isSupportScenario(n) && flatten([n]).some((x) => x.tags.includes(a.tag!)),
          ),
        );
        if (!roots.length)
          throw new ToolError(`No scenario carries the tag “${a.tag}”.`, [
            'Project tags: ' + (project.tags.join(', ') || 'none') + '.',
          ]);
      }
      return launch(ctx, project, {
        platforms: resolvePlatforms(project, a.platforms),
        roots,
        restartApp: roots ? true : undefined,
        preparation: a.preparation,
        campaign: a.campaign,
        wait: a.wait,
        timeoutS: a.timeout_s,
      });
    },
  }),
  defineTool({
    name: 'run_folder',
    group: 'execute',
    title: 'Run a folder of tests',
    description:
      'Runs one group of the scenario tree (an item with children) with its children, from the right start screen (its parent navigations are replayed first). Use it to replay a part of a scenario instead of all of it.',
    input: {
      folder: z.string().describe('Id or name of the group.'),
      platforms: platformsArg,
      campaign: campaignArg,
      restart_app: z.boolean().default(false),
      preparation: prepArg,
      project: projectArg,
      ...waitArgs,
    },
    async run(a, ctx) {
      const project = resolveProject(ctx, a.project);
      const node = resolveNode(project, a.folder);
      if (!node.children.length && node.kind !== 'scenario')
        throw new ToolError(`“${node.name}” has no children.`, [
          `Use run_element {"elements":["${node.id}"]} for a single item.`,
        ]);
      return launch(ctx, project, {
        platforms: resolvePlatforms(project, a.platforms),
        nodeId: node.id,
        restartApp: a.restart_app,
        preparation: a.preparation,
        campaign: a.campaign,
        wait: a.wait,
        timeoutS: a.timeout_s,
      });
    },
  }),
  defineTool({
    name: 'run_element',
    group: 'execute',
    title: 'Run single items',
    description:
      'Runs one or several items (test, action, navigation) in the order you give, independently of their scenario order. With navigate_first (default) the navigations/actions that lead to the first item in its scenario are replayed before it, so you can re-test one check after a fix without running everything. Use navigate_first=false when the app is already on the right screen (faster).',
    input: {
      elements: z.array(z.string()).min(1).describe('Ids or names, in the order to run.'),
      navigate_first: z.boolean().default(true),
      restart_app: z
        .boolean()
        .default(false)
        .describe('Relaunch the app before walking to the first item.'),
      platforms: platformsArg,
      campaign: campaignArg,
      preparation: prepArg,
      project: projectArg,
      ...waitArgs,
    },
    async run(a, ctx) {
      const project = resolveProject(ctx, a.project);
      const nodes = stepsOf(project, a.elements);
      const first = nodes[0];
      let roots: ScenarioNode[];
      let nodeId: string | undefined;
      let onlySelf: boolean | undefined;
      if (nodes.length === 1 && !a.navigate_first) {
        nodeId = first.id;
        onlySelf = true;
        roots = [];
      } else {
        const route =
          a.navigate_first && first.kind !== 'scenario' ? routeTo(project, first.id) : undefined;
        const lead = route
          ? [...route.steps.map((s) => s.node), ...(route.guard ? [route.guard] : [])]
          : [];
        const partial =
          !route && first.kind !== 'scenario' ? partialRoot(project, first.id, true) : undefined;
        roots = [
          sequenceRoot(
            'MCP · ' +
              nodes
                .map((n) => n.name)
                .join(' → ')
                .slice(0, 80),
            [...lead, ...nodes.map((n) => ({ ...n, children: [] }))],
            route?.scenario.startScreen ?? partial?.startScreen,
          ),
        ];
      }
      return launch(ctx, project, {
        platforms: resolvePlatforms(project, a.platforms),
        nodeId,
        onlySelf,
        roots: roots.length ? roots : undefined,
        restartApp: a.restart_app,
        preparation: a.preparation,
        campaign: a.campaign,
        wait: a.wait,
        timeoutS: a.timeout_s,
      });
    },
  }),
  defineTool({
    name: 'run_navigation',
    group: 'execute',
    title: 'Navigate the app to a screen',
    description:
      'Moves the app by replaying known navigations/actions: either the route that leads to an item (to) — the item itself is included when it is a navigation — or an explicit ordered list of items (path). restart_app relaunches the app first (clean start). Returns the screen the app ended on per OS, ready for inspect_screen / click / run_element.',
    input: {
      to: z.string().optional().describe('Item id or name to reach (see find_path).'),
      path: z.array(z.string()).optional().describe('Explicit ordered ids/names to replay.'),
      restart_app: z.boolean().default(false),
      platforms: platformsArg,
      preparation: prepArg,
      project: projectArg,
      timeout_s: waitArgs.timeout_s,
    },
    async run(a, ctx) {
      if (!a.to && !a.path?.length)
        throw new ToolError('Give “to” (an item to reach) or “path” (ordered items).', [
          'find_path {target} shows the route to an item.',
        ]);
      const project = resolveProject(ctx, a.project);
      const platforms = resolvePlatforms(project, a.platforms);
      let steps: ScenarioNode[];
      let startScreen: ScenarioNode['startScreen'];
      let target: string;
      if (a.to) {
        const node = resolveNode(project, a.to);
        const route = routeTo(project, node.id);
        if (!route) throw new ToolError('Item not found in any scenario.');
        steps = [...route.steps.map((s) => s.node), ...(node.kind === 'navigation' ? [node] : [])];
        startScreen = route.scenario.startScreen;
        target = node.name;
      } else {
        steps = stepsOf(project, a.path!);
        const route =
          steps[0] && steps[0].kind !== 'scenario' ? routeTo(project, steps[0].id) : undefined;
        startScreen = steps[0]?.startScreen ?? undefined;
        void route;
        target = steps.at(-1)!.name;
      }
      if (steps.some((s) => s.kind === 'test')) steps = steps.filter((s) => s.kind !== 'test');
      const result = await launch(ctx, project, {
        platforms,
        roots: [sequenceRoot('MCP · navigation → ' + target, steps, startScreen)],
        restartApp: a.restart_app,
        preparation: a.preparation,
        campaign: 'current',
        wait: true,
        timeoutS: a.timeout_s,
      });
      const data = result.data as Record<string, unknown>;
      // Where did the app end up? (best effort, per OS)
      try {
        const fresh = ctx.c.store.get(project.id);
        const here = await onEachOs(ctx, fresh, platforms, async (id, os) =>
          afterSummary(await ctx.c.automation.inspect(id), os, fresh, 'summary'),
        );
        data.now_on = Object.fromEntries(
          here.map((h) => [h.os, h.ok ? h.value : { error: h.error }]),
        );
      } catch {
        /* the navigation result is what matters */
      }
      data.summary = `Navigation to “${target}” (${steps.length} step(s)): ${data.summary}`;
      return { data, images: result.images };
    },
  }),
  defineTool({
    name: 'get_run_status',
    group: 'execute',
    title: 'Run status',
    readOnly: true,
    description:
      'Progress of the current run, or the final result of a given/last run (same structure as run_scenario).',
    input: { run_id: z.string().optional(), project: projectArg },
    async run(a, ctx) {
      const project = resolveProject(ctx, a.project);
      const report =
        (a.run_id && ctx.c.runner.getReport(a.run_id)) || (await ctx.c.runner.current(project.id));
      if (!report)
        throw new ToolError(
          a.run_id
            ? 'Unknown run (only runs of this session are kept in memory).'
            : 'No run yet for this project.',
          ['Call get_campaign_report for older results.'],
        );
      const s = await summarizeRun(ctx, report, project);
      const running = report.status === 'running';
      return {
        data: {
          ...s.data,
          ...(running
            ? {
                current_step: report.entries
                  .filter((e) => e.status === 'running')
                  .map((e) => `${e.platform}: ${e.nodeName}`),
              }
            : {}),
          next_steps: running ? ['Call again in a few seconds, or cancel_run.'] : [],
        },
        images: s.images,
      };
    },
  }),
  defineTool({
    name: 'cancel_run',
    group: 'execute',
    title: 'Cancel the current run',
    description:
      'Stops the run in progress (the device is released within a few seconds). Safe to call when nothing runs.',
    input: {},
    async run(_a, ctx) {
      const id = ctx.c.runner.currentRunId();
      if (!id) return { data: { summary: 'No run in progress.' } };
      ctx.c.runner.cancel();
      const stopped = await ctx.c.runner.waitForRun(id, 15_000);
      return {
        data: {
          summary: stopped ? 'Run cancelled.' : 'Cancel requested; the run is still winding down.',
          run_id: id,
        },
      };
    },
  }),
];
