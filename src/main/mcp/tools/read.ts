import { z } from 'zod';
import { activeOs } from '../../../shared/domain/project.js';
import { campaignProgress } from '../../../shared/domain/campaign.js';
import {
  flatten,
  nodePath,
  applicableOs,
  needsComponent,
  isSupportScenario,
} from '../../../shared/domain/scenario.js';
import {
  howToAddIdentifier,
  reviewVariant,
  suggestIdentifier,
} from '../../../shared/domain/selectors.js';
import { describeDiagnostic } from '../../infra/devices/diagnostic-text.js';
import {
  defineTool,
  osName,
  pairedDevices,
  pathNames,
  resolveNode,
  resolvePlatforms,
  resolveProject,
  ToolError,
} from '../context.js';
import { describeVariant, latestFor, loadCampaignDetail, outline } from '../format.js';

const platformsArg = z
  .array(z.enum(['android', 'ios']))
  .optional()
  .describe('OS to act on. Default: the OS currently ticked in the app (Android + iOS, or one).');
const projectArg = z
  .string()
  .optional()
  .describe('Project id or name. Default: the project open in the app.');

export const readTools = [
  defineTool({
    name: 'list_projects',
    group: 'read',
    title: 'List projects',
    readOnly: true,
    description:
      'Lists the Cybermonkey projects with their platforms, application ids, the OS currently active in the app and the paired devices. Start here to know which project to work on.',
    input: {},
    async run(_args, ctx) {
      const { projects, activeProjectId } = ctx.c.store.state;
      return {
        data: {
          summary: `${projects.length} project(s); active: ${projects.find((p) => p.id === activeProjectId)?.name ?? 'none'}.`,
          projects: projects.map((p) => ({
            id: p.id,
            name: p.name,
            active: p.id === activeProjectId,
            platforms: p.platforms,
            active_os: activeOs(p),
            applications: p.applications,
            devices: Object.fromEntries(
              p.platforms.map((os) => [
                os,
                p.deviceIds[os]
                  ? (ctx.c.devices.known.get(p.deviceIds[os]!)?.name ?? 'not detected')
                  : 'none paired',
              ]),
            ),
            scenarios: p.nodes.filter((n) => !isSupportScenario(n)).length,
            steps: flatten(p.nodes).filter((n) => n.kind !== 'scenario').length,
            variables: Object.keys(p.variables),
            environments: (p.environments ?? []).map((e) => e.name),
            environment:
              (p.environments ?? []).find((e) => e.id === p.activeEnvironmentId)?.name ?? null,
          })),
          next_steps: ['open_project to switch project, list_scenarios to see its content.'],
        },
      };
    },
  }),
  defineTool({
    name: 'list_scenarios',
    group: 'read',
    title: 'List scenarios',
    readOnly: true,
    description:
      'Returns the scenario tree of a project: ids, names, kinds (scenario / navigation / action / test), destination screens, tags, which OS have an implementation (MISSING = gap) and the latest result of each step per OS. Use it to analyse which scenarios a code change impacts, then get_scenario for details. Filter with query (name/description/tag text).',
    input: {
      project: projectArg,
      query: z
        .string()
        .optional()
        .describe('Keep only items whose name or description contains this text.'),
      tag: z.string().optional(),
      detail: z
        .enum(['outline', 'full'])
        .default('outline')
        .describe('full adds, per OS, what each step does (operation, target, selector).'),
    },
    async run(args, ctx) {
      const project = resolveProject(ctx, args.project);
      const latest = await latestFor(ctx, project);
      const tree = outline(
        project,
        project.nodes.filter((n) => !isSupportScenario(n)),
        { full: args.detail === 'full', query: args.query, tag: args.tag, latest },
      );
      const steps = flatten(project.nodes).filter((n) => n.kind !== 'scenario');
      return {
        data: {
          summary: `Project “${project.name}”: ${project.nodes.filter((n) => !isSupportScenario(n)).length} scenario(s), ${steps.length} step(s). Active OS: ${activeOs(project).map(osName).join(' + ')}.`,
          tags: project.tags,
          scenarios: tree,
          next_steps: [
            'get_scenario for the full detail of an item, find_path to know how to reach it, run_element / run_scenario to run it.',
          ],
        },
      };
    },
  }),
  defineTool({
    name: 'get_scenario',
    group: 'read',
    title: 'Get a scenario item',
    readOnly: true,
    description:
      'Full detail of one item (by id or name): per-OS variants (operation, selector, fallbacks, value, assertion), destination screen markers, preconditions, children and its parents. Use before editing with update_node.',
    input: {
      node: z.string().describe('Item id or name.'),
      project: projectArg,
      with_children: z.boolean().default(true),
    },
    async run(args, ctx) {
      const project = resolveProject(ctx, args.project);
      const node = resolveNode(project, args.node);
      const strip = (n: typeof node): unknown => ({
        ...n,
        children: args.with_children ? n.children.map(strip) : n.children.map((c) => c.id),
      });
      const latest = await latestFor(ctx, project);
      return {
        data: {
          summary: `${node.kind} “${node.name}” — ${pathNames(project, node).join(' › ')}`,
          latest_results: Object.fromEntries(
            project.platforms.map((os) => [os, latest.get(os + ':' + node.id) ?? 'not-run']),
          ),
          what_it_does: Object.fromEntries(
            project.platforms.map((os) => [
              os,
              describeVariant(node.variants[os]) ??
                (node.kind === 'scenario' ? undefined : 'MISSING (not implemented on this OS)'),
            ]),
          ),
          node: strip(node),
          parents: nodePath(project.nodes, node.id)
            .slice(0, -1)
            .map((n) => ({ id: n.id, name: n.name, kind: n.kind })),
        },
      };
    },
  }),
  defineTool({
    name: 'list_devices',
    group: 'read',
    title: 'List devices',
    readOnly: true,
    description:
      'Scans and lists Android devices/emulators and iOS simulators/iPhones with their state (ready / unauthorized / offline), which one is paired with the project for each OS and whether a run or exploration currently holds it.',
    input: {
      all: z.boolean().default(false).describe('Also list offline simulators (hidden by default).'),
      project: projectArg,
    },
    async run(args, ctx) {
      const project = resolveProject(ctx, args.project);
      const scan = await ctx.c.devices.scan();
      const paired = new Set(Object.values(project.deviceIds));
      const hidden = args.all
        ? 0
        : scan.devices.filter(
            (d) => d.kind === 'simulator' && d.status === 'offline' && !paired.has(d.id),
          ).length;
      const shown = scan.devices.filter(
        (d) => args.all || !(d.kind === 'simulator' && d.status === 'offline' && !paired.has(d.id)),
      );
      return {
        data: {
          summary:
            `${scan.devices.filter((d) => d.status === 'ready').length} ready device(s) of ${scan.devices.length}; paired with “${project.name}”: ` +
            project.platforms
              .map(
                (os) =>
                  `${osName(os)} → ${project.deviceIds[os] ? (ctx.c.devices.known.get(project.deviceIds[os]!)?.name ?? 'missing') : 'none'}`,
              )
              .join(', '),
          ...(hidden ? { hidden_offline_simulators: hidden } : {}),
          devices: shown.map((d) => ({
            id: d.id,
            name: d.name,
            os: d.platform,
            kind: d.kind,
            status: d.status,
            detail: d.detail,
            paired_with_project: paired.has(d.id),
            busy_with: ctx.c.automation.leaseOwner(d.id)?.split(':')[0],
          })),
          diagnostics: scan.diagnostics.map((code) => describeDiagnostic(code)),
          next_steps: ['get_device_health for the exact fix of a device that is not ready.'],
        },
      };
    },
  }),
  defineTool({
    name: 'get_device_health',
    group: 'read',
    title: 'Device diagnostics',
    readOnly: true,
    description:
      'Readiness checks of a device (connection, Appium, driver, signing, agent…) with, for each problem, the cause, how to fix it and a command when one exists. Pass a device id, or a platform to check the paired device.',
    input: {
      device: z.string().optional().describe('Device id from list_devices.'),
      platform: z.enum(['android', 'ios']).optional(),
      project: projectArg,
    },
    async run(args, ctx) {
      const project = resolveProject(ctx, args.project);
      const ids = args.device
        ? [args.device]
        : (args.platform ? [args.platform] : activeOs(project))
            .map((os) => project.deviceIds[os])
            .filter((x): x is string => !!x);
      if (!ids.length)
        throw new ToolError('No paired device for the active OS and none given.', [
          'Call list_devices, then pair a device in the Devices panel.',
        ]);
      const reports = await Promise.all(
        ids.map(async (id) => {
          const health = await ctx.c.diagnostics.health(ctx.c.devices.known.get(id), id);
          const bad = health.checks.filter((c) => c.state === 'error');
          return {
            device: ctx.c.devices.known.get(id)?.name ?? id,
            id,
            summary: bad.length
              ? `${bad.length} problem(s): ${bad.map((c) => c.label).join(', ')}.`
              : 'Everything is ready.',
            checks: health.checks.map((c) => ({
              check: c.label,
              state: c.state,
              detail: c.detail,
              ...(c.state !== 'ok' && c.fix ? { fix: c.fix } : {}),
              ...(c.command ? { command: c.command } : {}),
              ...(c.documentation ? { docs: c.documentation } : {}),
            })),
          };
        }),
      );
      return {
        data: {
          summary: reports.map((r) => `${r.device}: ${r.summary}`).join(' | '),
          devices: reports,
        },
      };
    },
  }),
  defineTool({
    name: 'list_campaigns',
    group: 'read',
    title: 'List campaigns',
    readOnly: true,
    description:
      'Lists the campaigns of a project (label, open/completed, date) and flags the active one. Runs are recorded in a campaign.',
    input: { project: projectArg },
    async run(args, ctx) {
      const project = resolveProject(ctx, args.project);
      const list = await ctx.c.campaigns.list(project.id);
      let progress: unknown;
      if (project.activeCampaignId) {
        const detail = await ctx.c.runner
          .loadCampaign(project.id, project.activeCampaignId)
          .catch(() => null);
        progress = detail && campaignProgress(detail, project).overall;
      }
      return {
        data: {
          summary: `${list.length} campaign(s).`,
          campaigns: list.map((c) => ({
            id: c.id,
            label: c.label,
            status: c.status,
            created: c.createdAt,
            active: c.id === project.activeCampaignId,
          })),
          active_progress: progress,
          next_steps: ['get_campaign_report for the details of one campaign.'],
        },
      };
    },
  }),
  defineTool({
    name: 'audit_selectors',
    group: 'read',
    title: 'Audit selector durability',
    readOnly: true,
    description:
      'Reviews how well each step’s selector will survive UI changes: durable (technical id / developer identifier), fair (accessibility label = displayed text, breaks when the copy or the translation changes), fragile (positional or text XPath) and position (screen coordinates, web views). For every non-durable step it proposes an identifier the app developers can add (accessibilityIdentifier / resource-id / testTag / Semantics) and how.',
    input: {
      include_fair: z
        .boolean()
        .default(false)
        .describe('Also list steps relying on displayed text (many on Flutter).'),
      platforms: platformsArg,
      project: projectArg,
    },
    async run(args, ctx) {
      const project = resolveProject(ctx, args.project);
      const oses = resolvePlatforms(project, args.platforms);
      const counts = { durable: 0, fair: 0, fragile: 0, position: 0 };
      const items: Record<string, unknown>[] = [];
      for (const n of flatten(project.nodes)) {
        if (n.kind === 'scenario' || n.call) continue;
        for (const os of applicableOs(n, oses)) {
          const v = n.variants[os];
          if (!v || (n.kind !== 'test' && !needsComponent(v.operation))) continue;
          const r = reviewVariant(v);
          counts[r.quality]++;
          if (r.quality === 'durable' || (r.quality === 'fair' && !args.include_fair)) continue;
          const id = suggestIdentifier(n.name, v.hint);
          items.push({
            os,
            step: n.name,
            node_id: n.id,
            quality: r.quality,
            selector: describeVariant(v),
            why: r.reason,
            suggested_identifier: id,
            how_to_add: howToAddIdentifier(os, id),
          });
        }
      }
      const order = { fragile: 0, position: 1, fair: 2 } as Record<string, number>;
      items.sort((a, b) => order[a.quality as string] - order[b.quality as string]);
      return {
        data: {
          summary: `${counts.durable} durable, ${counts.fair} fair (text-based), ${counts.fragile} fragile, ${counts.position} by position.`,
          counts,
          to_improve: items.slice(0, 60),
          next_steps: [
            'Ask the app developers to add the suggested identifiers, then update_node with the new accessibility id (inspect_screen shows it) and run_element to check.',
          ],
        },
      };
    },
  }),
];
export { loadCampaignDetail };
