import { z } from 'zod';
import {
  OPERATIONS,
  ASSERTIONS,
  DIRECTIONS,
  appendChildren,
  findNode,
  flatten,
  insertAfter,
  locatorSchema,
  makeVariant,
  nodeSchema,
  osSchema,
  removeNode,
  updateNode,
  screenDefinitionSchema,
  type ScenarioNode,
  type Variant,
} from '../../../shared/domain/scenario.js';
import type { Project } from '../../../shared/domain/project.js';
import { routeTo, sequenceRoot } from '../../engine/execution/roots.js';
import {
  defineTool,
  readyDevices,
  resolveNode,
  resolvePlatforms,
  resolveProject,
  ToolError,
  type Ctx,
  type ProposalRecord,
} from '../context.js';
import { describeVariant, loadCampaignDetail, outline } from '../format.js';
import { pendingRepairs } from '../../../shared/domain/repairs.js';
import { launch } from './execute.js';

const platformsArg = z
  .array(z.enum(['android', 'ios']))
  .optional()
  .describe('OS to act on. Default: the OS currently ticked in the app.');
const projectArg = z.string().optional().describe('Project id or name. Default: the open project.');

/** The scenario to run for a proposal: whole scenarios as they are, loose steps wrapped (and reached via their parent's route). */
function proposalRoots(project: Project, record: ProposalRecord): ScenarioNode[] {
  const nodes = structuredClone(record.nodes);
  if (!record.parentId && nodes.every((n) => n.kind === 'scenario')) return nodes;
  const parent = record.parentId ? findNode(project.nodes, record.parentId) : undefined;
  const route = parent ? routeTo(project, parent.id) : undefined;
  const lead = route
    ? [...route.steps.map((s) => s.node), ...(parent?.kind === 'navigation' ? [parent] : [])]
    : [];
  const root = sequenceRoot('Proposal', lead, route?.scenario.startScreen ?? parent?.startScreen);
  root.children.push(...nodes);
  return [root];
}

async function replayRecord(
  ctx: Ctx,
  project: Project,
  record: ProposalRecord,
  platforms: ReturnType<typeof resolvePlatforms>,
  restartApp: boolean,
  timeoutS: number,
) {
  return launch(ctx, project, {
    platforms,
    roots: proposalRoots(project, record),
    restartApp,
    preparation: 'existing',
    campaign: 'current',
    wait: true,
    timeoutS,
  });
}

const reviewOf = (
  project: Project,
  record: ProposalRecord,
  extra: Record<string, unknown> = {},
) => ({
  proposal_id: record.id,
  parent: record.parentId ?? null,
  items: flatten(record.nodes).length,
  tree: outline(project, record.nodes, { full: true }),
  ...extra,
});

/* ---- lenient input for add_nodes / update_node ---- */
const variantInput = variantSchema_();
function variantSchema_() {
  return z.object({
    locator: locatorSchema.optional(),
    fallbacks: z.array(locatorSchema).max(5).optional(),
    point: z
      .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
      .nullable()
      .optional()
      .describe('Fractions of the screen, for web-view content only.'),
    hint: z.string().max(300).optional().describe('Human description of the component.'),
    operation: z.enum(OPERATIONS).optional(),
    value: z
      .string()
      .max(5000)
      .optional()
      .describe(
        'Text to type; ${VARIABLE} placeholders are resolved at run time. For capture: the variable name that receives the text (then use ${NAME} later); for deeplink: the URL; for alert: accept|dismiss|button label; for longpress/background: duration; for scroll: max swipes.',
      ),
    assertion: z.enum(ASSERTIONS).optional(),
    expected: z.string().max(5000).optional(),
    direction: z.enum(DIRECTIONS).optional(),
    timeoutMs: z.number().int().min(0).max(120000).optional(),
  });
}
const whenInput = z
  .object({ android: variantInput.optional(), ios: variantInput.optional() })
  .describe(
    'Run condition per OS: an assertion (assertion visible|absent|text|contains|matches|count|enabled|selected, locator, expected) checked right before the step. Not met = the step and its children are skipped (not a failure). Keep timeoutMs short (1500) so a missing banner costs little. Give it for every OS the step runs on.',
  );
const datasetInput = z
  .array(z.record(z.string(), z.string().max(2000)))
  .min(1)
  .max(50)
  .describe(
    'Scenario only: one object per row, keys = variable names usable as ${NAME} in the steps (e.g. [{"LOGIN":"a","PASSWORD":"x"},{"LOGIN":"b","PASSWORD":"y"}]). The scenario is played once per row, the app relaunched in between.',
  );
const markers = z.object({
  markers: z.array(locatorSchema).min(1).max(12),
  link: z
    .string()
    .max(500)
    .optional()
    .describe(
      'Deep link opening this screen directly (e.g. myapp://orders). On a scenario start_screen it lets runs skip the app restart + route replay. Only give a link you know works.',
    ),
});
const screenInput = z.object({
  name: z.string().min(1).max(180),
  id: z
    .string()
    .max(120)
    .optional()
    .describe('Same id on both OS for the same screen. Default: derived from the name.'),
  variants: z.object({ android: markers.optional(), ios: markers.optional() }),
});
const handlerInput = z
  .object({
    when: screenInput,
    resume: z.enum(['retry', 'return']).default('return'),
    max_per_run: z.number().int().min(1).max(20).default(5),
  })
  .describe(
    'Scenario only: makes it an INTERRUPTION HANDLER (popup, expired-session message, login screen after a session expiry, error banner…). When a step fails and the screen described by "when" is showing, this scenario\'s steps run, then the failed step is replayed. resume "return" first goes back to the screen the step started from through known navigations (use it after logging in again); "retry" replays the step where the app is. Handlers are not part of campaigns. Chain them: a popup handler (tap OK) then a login handler (log in again, e.g. an action with "call" on your login scenario).',
  );
const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'screen';
const leaf = z.object({
  name: z.string().min(1).max(180),
  kind: z.enum(['action', 'test', 'navigation']),
  description: z.string().max(5000).optional(),
  tags: z.array(z.string()).optional(),
  platforms: z.array(osSchema).optional().describe('Restrict to some OS (default: all).'),
  blocking: z.boolean().optional(),
  screen: screenInput.optional().describe('Destination screen of a navigation (markers per OS).'),
  variants: z
    .object({ android: variantInput.optional(), ios: variantInput.optional() })
    .describe('How to do it on each OS. One entry per OS you want covered.'),
  when: whenInput.optional(),
  call: z
    .string()
    .optional()
    .describe(
      'kind=action only, no variants: id/name of a scenario whose steps run here, in place (reuse “Log in” without copying it).',
    ),
});
const nodeInput = leaf.extend({
  kind: z.enum(['scenario', 'action', 'test', 'navigation']),
  start_screen: screenInput.optional(),
  dataset: datasetInput.optional(),
  handler: handlerInput.optional(),
  children: z.array(leaf).optional(),
});
type LeafInput = z.infer<typeof nodeInput>;

const clean = <T extends object>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
const screenOf = (s: z.infer<typeof screenInput> | undefined) =>
  s
    ? screenDefinitionSchema.parse({ id: s.id ?? slug(s.name), name: s.name, variants: s.variants })
    : undefined;
const whenOf = (w: z.infer<typeof whenInput>): NonNullable<ScenarioNode['when']> => {
  const out: NonNullable<ScenarioNode['when']> = {};
  for (const os of ['android', 'ios'] as const)
    if (w[os])
      out[os] = makeVariant({
        ...clean(w[os]!),
        point: w[os]!.point ?? undefined,
        operation: 'assert',
        timeoutMs: w[os]!.timeoutMs ?? 1500,
      });
  return out;
};
function buildNode(input: LeafInput): ScenarioNode {
  const variants: ScenarioNode['variants'] = {};
  if (input.kind !== 'scenario')
    for (const os of ['android', 'ios'] as const)
      if (input.variants?.[os])
        variants[os] = makeVariant({
          operation: input.kind === 'test' ? 'assert' : 'tap',
          ...clean(input.variants[os]!),
          point: input.variants[os]!.point ?? undefined,
        });
  return {
    id: crypto.randomUUID(),
    name: input.name,
    kind: input.kind,
    description: input.description ?? '',
    tags: input.tags ?? [],
    preconditionId: null,
    childrenOnPreconditionFailure: false,
    blocking: input.blocking ?? false,
    ...(input.platforms ? { platforms: input.platforms } : {}),
    ...(input.screen ? { screen: screenOf(input.screen) } : {}),
    ...(input.start_screen ? { startScreen: screenOf(input.start_screen) } : {}),
    ...(input.when ? { when: whenOf(input.when) } : {}),
    ...(input.call ? { call: input.call } : {}),
    ...(input.dataset ? { dataset: { rows: input.dataset } } : {}),
    ...(input.handler && input.kind === 'scenario'
      ? {
          handler: {
            when: screenOf(input.handler.when)!,
            resume: input.handler.resume,
            maxPerRun: input.handler.max_per_run,
          },
        }
      : {}),
    variants,
    children: (input.children ?? []).map((c) =>
      buildNode({ ...c, children: undefined } as LeafInput),
    ),
  };
}
/** `call` may be given by scenario name: store the id. */
function resolveCalls(project: Project, nodes: ScenarioNode[]): ScenarioNode[] {
  return nodes.map((n) => {
    const out: ScenarioNode = { ...n, children: resolveCalls(project, n.children) };
    if (n.call) {
      const target = resolveNode(project, n.call);
      if (target.kind !== 'scenario')
        throw new ToolError(`“${target.name}” is not a scenario: only scenarios can be called.`);
      out.call = target.id;
      out.variants = {};
    }
    return out;
  });
}
async function save(ctx: Ctx, project: Project, nodes: ScenarioNode[]) {
  try {
    const next = await ctx.c.store.update({ id: project.id, nodes });
    ctx.c.emit({ type: 'workspace' });
    return next;
  } catch (e) {
    throw new ToolError(
      'The scenario was not saved: ' + (e instanceof Error ? e.message.split('\n')[0] : String(e)),
      ['Check ids, screen markers and that every navigation has a destination screen.'],
    );
  }
}

export const createTools = [
  defineTool({
    name: 'create_scenario_from_prompt',
    group: 'create',
    title: 'Create a scenario with the AI',
    description:
      'Cybermonkey’s creation agent explores the app on the active OS(es) from your instruction and proposes a scenario (navigations with destination screens, actions, tests) with a selector per OS. It can take several minutes. The result is a PROPOSAL (proposal_id), not saved: read it, then replay_proposal (done automatically with replay=true) and accept_proposal to insert it. No human is asked questions: the agent decides.',
    input: {
      prompt: z
        .string()
        .min(5)
        .describe(
          'What to test, in plain language, with the path to follow and what to check. E.g. “Log in with ${LOGIN}/${PASSWORD} and check the home screen shows the agenda”.',
        ),
      parent: z
        .string()
        .optional()
        .describe('Insert under this item (id/name) instead of creating a new scenario.'),
      replay: z
        .boolean()
        .default(true)
        .describe(
          'Replay the proposal on the device(s) right after creation and report the result.',
        ),
      platforms: platformsArg,
      project: projectArg,
    },
    async run(a, ctx) {
      const project = resolveProject(ctx, a.project);
      const platforms = resolvePlatforms(project, a.platforms);
      const { ready, skipped } = readyDevices(ctx, project, platforms);
      const parent = a.parent ? resolveNode(project, a.parent) : undefined;
      const abort = () => ctx.c.creation.cancel(project.id);
      ctx.signal.addEventListener('abort', abort, { once: true });
      let reply;
      try {
        reply = await ctx.c.creation.ask({
          projectId: project.id,
          prompt: a.prompt,
          nodeId: parent?.id,
          deviceIds: ready.map((r) => r.device.id),
          overrides: { autoApprove: true, replay: false },
        });
      } catch (e) {
        throw new ToolError(e instanceof Error ? e.message.split('\n')[0] : String(e), [
          'If a run or exploration is in progress: get_run_status / cancel_run.',
          'Check get_device_health and that the AI provider is signed in (Settings → AI).',
        ]);
      } finally {
        ctx.signal.removeEventListener('abort', abort);
      }
      const fresh = ctx.c.store.get(project.id);
      if (!reply.proposal?.length)
        return {
          data: {
            summary: 'The agent produced no scenario.',
            agent_message: reply.text,
            warnings: reply.warnings,
            coverage: reply.coverage,
            next_steps: [
              'Refine the instruction (path, expected checks) and retry, or use explore to learn the app first.',
            ],
          },
        };
      const record: ProposalRecord = {
        id: crypto.randomUUID().slice(0, 8),
        projectId: project.id,
        nodes: reply.proposal,
        parentId: reply.parentId,
        createdAt: Date.now(),
      };
      ctx.state.proposals.set(record.id, record);
      const base = reviewOf(fresh, record, {
        agent_message: reply.text,
        quality: reply.quality,
        warnings: reply.warnings,
        coverage: reply.coverage,
        ...(skipped.length ? { skipped_os: skipped } : {}),
      });
      if (!a.replay)
        return {
          data: {
            summary: `Proposal ${record.id}: ${base.items} items (${reply.quality}). Not replayed, not saved.`,
            ...base,
            next_steps: [
              `replay_proposal {"proposal_id":"${record.id}"} to verify it, then accept_proposal.`,
            ],
          },
        };
      const replayed = await replayRecord(ctx, fresh, record, platforms, true, 600).catch((e) => ({
        data: { status: 'error', summary: String(e instanceof Error ? e.message : e) },
        images: [],
      }));
      const r = replayed.data as Record<string, unknown>;
      return {
        data: {
          summary: `Proposal ${record.id}: ${base.items} items (${reply.quality}). Replay: ${r.summary}`,
          ...base,
          replay: r,
          next_steps:
            r.status === 'passed'
              ? [`accept_proposal {"proposal_id":"${record.id}"} to insert it into the project.`]
              : [
                  'Fix the proposal (update_node cannot edit proposals: accept it then edit, or re-run create_scenario_from_prompt with clearer instructions), see replay.failures.',
                ],
        },
        images: (replayed as { images?: never[] }).images,
      };
    },
  }),
  defineTool({
    name: 'replay_proposal',
    group: 'create',
    title: 'Replay a proposal',
    description:
      'Replays a not-yet-saved proposal (from create_scenario_from_prompt) — or steps you pass as JSON — on the device(s) from a clean app start, like a real run, and returns passed/failed per OS with the failing step, analysis and screenshot. Nothing is inserted into the project.',
    input: {
      proposal_id: z.string().optional(),
      nodes: z
        .array(nodeInput)
        .optional()
        .describe('Alternative: steps to try (same shape as add_nodes).'),
      parent: z.string().optional().describe('With nodes: the item they would be inserted under.'),
      restart_app: z.boolean().default(true),
      platforms: platformsArg,
      project: projectArg,
      timeout_s: z.number().int().min(10).max(3600).default(600),
    },
    async run(a, ctx) {
      const project = resolveProject(ctx, a.project);
      let record: ProposalRecord | undefined;
      if (a.proposal_id) {
        record = ctx.state.proposals.get(a.proposal_id);
        if (!record)
          throw new ToolError(`Unknown proposal “${a.proposal_id}”.`, [
            'Proposals live until the app restarts or they are accepted. Known: ' +
              ([...ctx.state.proposals.keys()].join(', ') || 'none') +
              '.',
          ]);
      } else if (a.nodes?.length) {
        const parent = a.parent ? resolveNode(project, a.parent) : undefined;
        record = {
          id: 'adhoc',
          projectId: project.id,
          nodes: a.nodes.map(buildNode),
          parentId: parent?.id,
          createdAt: Date.now(),
        };
      } else throw new ToolError('Give proposal_id or nodes.');
      return replayRecord(
        ctx,
        project,
        record,
        resolvePlatforms(project, a.platforms),
        a.restart_app,
        a.timeout_s,
      );
    },
  }),
  defineTool({
    name: 'accept_proposal',
    group: 'create',
    title: 'Insert a proposal into the project',
    description:
      'Inserts a proposal into the project (as a new scenario, or under the item it was created for). Call after replay_proposal passed.',
    input: {
      proposal_id: z.string(),
      parent: z.string().optional().describe('Override the target item.'),
      exclude: z.array(z.string()).optional().describe('Ids of proposal items to leave out.'),
      project: projectArg,
    },
    async run(a, ctx) {
      const record = ctx.state.proposals.get(a.proposal_id);
      if (!record) throw new ToolError(`Unknown proposal “${a.proposal_id}”.`);
      const project = resolveProject(ctx, record.projectId);
      const parentId = a.parent ? resolveNode(project, a.parent).id : record.parentId;
      if (parentId && !findNode(project.nodes, parentId))
        throw new ToolError('The target item no longer exists.', ['Pass parent explicitly.']);
      let nodes = structuredClone(record.nodes);
      for (const id of a.exclude ?? []) nodes = removeNode(nodes, id);
      const next = await save(ctx, project, appendChildren(project.nodes, parentId, nodes));
      ctx.state.proposals.delete(record.id);
      return {
        data: {
          summary: `Inserted ${flatten(nodes).length} item(s)${parentId ? '' : ' as new scenario(s)'}.`,
          inserted: outline(next, nodes),
          next_steps: ['run_scenario / run_element to run it from the campaign.'],
        },
      };
    },
  }),
  defineTool({
    name: 'update_node',
    group: 'create',
    title: 'Edit a scenario item',
    description:
      'Edits an existing item: name, description, tags, platforms, destination screen, and per-OS variant fields (locator, hint, operation, value, expected, …) — only the fields you pass change; null removes a variant. Typical use: fix a selector after a failure (copy the selector from inspect_screen), then run_element to confirm.',
    input: {
      node: z.string().describe('Id or name.'),
      name: z.string().optional(),
      description: z.string().optional(),
      tags: z.array(z.string()).optional(),
      platforms: z.array(osSchema).nullable().optional().describe('null = all OS.'),
      blocking: z.boolean().optional(),
      precondition: z
        .string()
        .nullable()
        .optional()
        .describe('Id of the preceding test that must pass first; null to remove.'),
      screen: screenInput.nullable().optional(),
      variants: z
        .object({
          android: variantInput.nullable().optional(),
          ios: variantInput.nullable().optional(),
        })
        .optional(),
      when: whenInput.nullable().optional().describe('null removes the condition.'),
      call: z
        .string()
        .nullable()
        .optional()
        .describe('Scenario (id/name) to run in place of this action; null removes the call.'),
      dataset: datasetInput.nullable().optional().describe('null removes the dataset.'),
      handler: handlerInput
        .nullable()
        .optional()
        .describe('null makes it a normal scenario again.'),
      project: projectArg,
    },
    async run(a, ctx) {
      const project = resolveProject(ctx, a.project);
      const node = resolveNode(project, a.node);
      const before = Object.fromEntries(
        (['android', 'ios'] as const).map((os) => [os, describeVariant(node.variants[os])]),
      );
      const next = await save(
        ctx,
        project,
        updateNode(project.nodes, node.id, (n) => {
          const out: ScenarioNode = { ...n };
          if (a.name !== undefined) out.name = a.name;
          if (a.description !== undefined) out.description = a.description;
          if (a.tags) out.tags = a.tags;
          if (a.blocking !== undefined) out.blocking = a.blocking;
          if (a.platforms !== undefined) out.platforms = a.platforms ?? undefined;
          if (a.precondition !== undefined) out.preconditionId = a.precondition;
          if (a.screen !== undefined) out.screen = screenOf(a.screen ?? undefined);
          if (a.when !== undefined) out.when = a.when ? whenOf(a.when) : undefined;
          if (a.dataset !== undefined) out.dataset = a.dataset ? { rows: a.dataset } : undefined;
          if (a.handler !== undefined)
            out.handler = a.handler
              ? {
                  when: screenOf(a.handler.when)!,
                  resume: a.handler.resume,
                  maxPerRun: a.handler.max_per_run,
                }
              : undefined;
          if (a.call !== undefined) {
            if (a.call === null) out.call = undefined;
            else {
              const target = resolveNode(project, a.call);
              if (target.kind !== 'scenario')
                throw new ToolError(
                  `“${target.name}” is not a scenario: only scenarios can be called.`,
                );
              out.call = target.id;
              out.variants = {};
            }
          }
          if (a.variants) {
            out.variants = { ...n.variants };
            for (const os of ['android', 'ios'] as const) {
              const patch = a.variants[os];
              if (patch === null) delete out.variants[os];
              else if (patch)
                out.variants[os] = makeVariant({
                  ...(n.variants[os] ?? { operation: n.kind === 'test' ? 'assert' : 'tap' }),
                  ...clean(patch),
                  ...(patch.point === null ? { point: undefined } : {}),
                } as Partial<Variant>);
            }
          }
          return out;
        }),
      );
      const after = findNode(next.nodes, node.id)!;
      return {
        data: {
          summary: `Updated “${after.name}”.`,
          id: after.id,
          before,
          after: Object.fromEntries(
            (['android', 'ios'] as const).map((os) => [os, describeVariant(after.variants[os])]),
          ),
          next_steps: [`run_element {"elements":["${after.id}"]} to verify on the device(s).`],
        },
      };
    },
  }),
  defineTool({
    name: 'add_nodes',
    group: 'create',
    title: 'Add items to a scenario',
    description:
      'Adds new items (action / test / navigation, or a whole scenario with children) to the project. parent = a scenario or group to append to; after = a sibling to insert right after. Omit both to create a new scenario at the root. Give a variant per OS you want covered; a navigation needs a destination screen (markers per OS) so the app can recognise where it is.',
    input: {
      nodes: z.array(nodeInput).min(1).max(40),
      parent: z.string().optional(),
      after: z.string().optional(),
      project: projectArg,
    },
    async run(a, ctx) {
      const project = resolveProject(ctx, a.project);
      const built = resolveCalls(project, a.nodes.map(buildNode));
      let nodes: ScenarioNode[];
      if (a.after) {
        const sibling = resolveNode(project, a.after);
        nodes = project.nodes;
        let prev = sibling.id;
        for (const n of built) {
          nodes = insertAfter(nodes, prev, n);
          prev = n.id;
        }
      } else
        nodes = appendChildren(
          project.nodes,
          a.parent ? resolveNode(project, a.parent).id : null,
          built,
        );
      const next = await save(ctx, project, nodes);
      return {
        data: {
          summary: `Added ${flatten(built).length} item(s).`,
          added: outline(next, built, { full: true }),
          next_steps: ['run_element on the new ids to check them on the device(s).'],
        },
      };
    },
  }),
  defineTool({
    name: 'delete_node',
    group: 'create',
    title: 'Delete a scenario item',
    description: 'Deletes an item and its children. Irreversible: requires confirm=true.',
    input: { node: z.string(), confirm: z.boolean().default(false), project: projectArg },
    async run(a, ctx) {
      const project = resolveProject(ctx, a.project);
      const node = resolveNode(project, a.node);
      const count = flatten([node]).length;
      if (!a.confirm)
        throw new ToolError(`This would delete “${node.name}” and ${count - 1} child item(s).`, [
          'Call again with confirm=true to proceed.',
        ]);
      await save(ctx, project, removeNode(project.nodes, node.id));
      return { data: { summary: `Deleted “${node.name}” (${count} item(s)).` } };
    },
  }),
  defineTool({
    name: 'apply_healed_selectors',
    group: 'create',
    title: 'Apply AI-repaired selectors to the scenarios',
    description:
      'During runs the AI repairs actions whose component vanished (the step passes with another selector). Until applied, every run repairs it again, which is slower and hides the UI change. This writes the repaired selector into the scenarios (the old one becomes a fallback). Only repairs from steps that passed, and only for steps that still exist. dry_run lists them without changing anything.',
    input: {
      campaign: z.string().optional().describe('Campaign id. Default: the active campaign.'),
      dry_run: z.boolean().default(false),
      project: projectArg,
    },
    async run(a, ctx) {
      const project = resolveProject(ctx, a.project);
      const detail = await loadCampaignDetail(ctx, project, a.campaign);
      const pending = pendingRepairs(detail, project);
      const describe = (x: (typeof pending)[number]) => ({
        os: x.entry.platform,
        step: x.entry.nodeName,
        node_id: x.entry.nodeId,
        from: x.entry.healing!.from?.value,
        to: x.entry.healing!.to.value,
        reason: x.entry.healing!.reason,
      });
      if (a.dry_run || !pending.length)
        return {
          data: {
            summary: pending.length
              ? `${pending.length} repaired selector(s) not applied yet.`
              : 'No repaired selector waiting.',
            pending: pending.map(describe),
          },
        };
      const applied: unknown[] = [];
      const failed: unknown[] = [];
      for (const x of pending)
        try {
          await ctx.c.runner.applyHealing({
            projectId: project.id,
            campaignId: detail.campaign.id,
            runId: x.runId,
            entryId: x.entry.id,
          });
          applied.push(describe(x));
        } catch (e) {
          failed.push({ ...describe(x), error: e instanceof Error ? e.message : String(e) });
        }
      ctx.c.emit({ type: 'workspace' });
      return {
        data: {
          summary: `Applied ${applied.length} repaired selector(s)${failed.length ? `, ${failed.length} could not be applied` : ''}.`,
          applied,
          ...(failed.length ? { failed } : {}),
          next_steps: ['run_scenario to confirm they now pass without repair.'],
        },
      };
    },
  }),
];
