import { z } from 'zod';
import { activeEnvironment, effectiveVariables } from '../../../shared/domain/project.js';
import { flatten } from '../../../shared/domain/scenario.js';
import { referencedVariables } from '../../../shared/domain/variables.js';
import { afterSummary, onEachOs, settledScreen } from '../devices.js';
import { defineTool, osName, resolvePlatforms, resolveProject, ToolError } from '../context.js';

const platformsArg = z
  .array(z.enum(['android', 'ios']))
  .optional()
  .describe('OS to act on. Default: the OS currently ticked in the app.');
const projectArg = z.string().optional().describe('Project id or name. Default: the open project.');

export const utilityTools = [
  defineTool({
    name: 'relaunch_app',
    group: 'utility',
    title: 'Relaunch the app',
    description:
      'Closes and restarts the project’s application on each active OS (data kept), waits for it to settle and tells which screen it is on. Use to start from a known state before navigating.',
    input: { platforms: platformsArg, project: projectArg },
    async run(a, ctx) {
      const project = resolveProject(ctx, a.project);
      const results = await onEachOs(
        ctx,
        project,
        resolvePlatforms(project, a.platforms),
        async (id, os) => {
          const application = project.applications?.[os];
          if (!application)
            throw new ToolError(`No ${osName(os)} application is configured for this project.`, [
              'Set it in the project settings (Applications).',
            ]);
          await ctx.c.automation.ensureApplication(id, application, undefined, true, ctx.signal);
          return {
            application,
            screen: afterSummary(await settledScreen(ctx, id), os, project, 'summary'),
          };
        },
      );
      return {
        data: {
          summary: results
            .map((r) => `${osName(r.os)}: ${r.ok ? 'relaunched' : 'ERROR ' + r.error}`)
            .join(' | '),
          per_os: Object.fromEntries(
            results.map((r) => [r.os, r.ok ? r.value : { error: r.error, hints: r.hints }]),
          ),
        },
      };
    },
  }),
  defineTool({
    name: 'list_variables',
    group: 'utility',
    title: 'List project variables',
    readOnly: true,
    description:
      'Names of the project variables (${NAME} placeholders used in values, expectations and selectors) and where they are used. Values are never returned (they may be secrets). Variables absent from this list make a run fail with “Variable absente”.',
    input: { project: projectArg },
    async run(a, ctx) {
      const project = resolveProject(ctx, a.project);
      const usage = new Map<string, string[]>();
      for (const n of flatten(project.nodes))
        for (const v of Object.values(n.variants))
          for (const name of new Set(
            [
              v.value,
              v.expected,
              v.locator?.value ?? '',
              ...v.fallbacks.map((f) => f.value),
            ].flatMap(referencedVariables),
          ))
            usage.set(name, [...(usage.get(name) ?? []), n.name]);
      const effective = effectiveVariables(project);
      const defined = Object.keys(effective);
      const env = activeEnvironment(project);
      return {
        data: {
          summary: `${defined.length} variable(s) in use${env ? ` (environment “${env.name}” over the common variables)` : ' (no environment selected)'}.`,
          environment: env?.name ?? null,
          environments: (project.environments ?? []).map((e) => ({
            name: e.name,
            selected: e.id === project.activeEnvironmentId,
            overrides: Object.keys(e.variables),
          })),
          variables: defined.map((name) => ({
            name,
            source: env && Object.hasOwn(env.variables, name) ? 'environment' : 'common',
            has_value: !!effective[name],
            used_by: [...new Set(usage.get(name) ?? [])].slice(0, 10),
            uses: usage.get(name)?.length ?? 0,
          })),
          missing: [...usage.keys()]
            .filter((n) => !defined.includes(n))
            .map((name) => ({ name, used_by: [...new Set(usage.get(name))].slice(0, 10) })),
          note: 'Values are hidden. Add or edit variables in the Cybermonkey UI (Project → Variables) or ask the creation agent to create one.',
        },
      };
    },
  }),
  defineTool({
    name: 'select_environment',
    group: 'utility',
    title: 'Select the environment',
    description:
      'Selects the project environment (staging, pre-production…): its variables override the common ones for EVERYTHING that follows (runs, creation, manual actions), exactly like the selector in the app. Use name “none” for the common variables only. list_variables shows the environments.',
    input: {
      environment: z.string().describe('Environment name, or “none”.'),
      project: z.string().optional().describe('Project id or name. Default: the open project.'),
    },
    async run(a, ctx) {
      const project = resolveProject(ctx, a.project);
      const wanted = a.environment.trim().toLowerCase();
      const env =
        wanted === 'none' || wanted === ''
          ? undefined
          : (project.environments ?? []).find(
              (e) => e.id === a.environment || e.name.toLowerCase() === wanted,
            );
      if (wanted !== 'none' && wanted !== '' && !env)
        throw new ToolError(`No environment “${a.environment}” in this project.`, [
          'Available: ' +
            ((project.environments ?? []).map((e) => e.name).join(', ') || 'none') +
            '. Environments are created in the app (Variables).',
        ]);
      const next = await ctx.c.store.update({
        id: project.id,
        activeEnvironmentId: env?.id ?? null,
      });
      ctx.c.emit({ type: 'workspace' });
      return {
        data: {
          summary: env
            ? `Environment “${env.name}” selected.`
            : 'No environment: common variables only.',
          overrides: env ? Object.keys(env.variables) : [],
          project: next.name,
          next_steps: [
            'list_variables to see what is in use, then run_scenario etc. run against it.',
          ],
        },
      };
    },
  }),
  defineTool({
    name: 'open_project',
    group: 'utility',
    title: 'Open a project',
    description: 'Makes a project the open one in Cybermonkey (other tools default to it).',
    input: { project: z.string().describe('Id or name.') },
    async run(a, ctx) {
      const project = resolveProject(ctx, a.project);
      await ctx.c.store.select(project.id);
      ctx.c.emit({ type: 'workspace' });
      return {
        data: {
          summary: `Project “${project.name}” is now open.`,
          id: project.id,
          platforms: project.platforms,
          focus: project.focus,
          scenarios: project.nodes.filter((n) => !n.preparation).length,
          next_steps: ['list_scenarios, list_devices.'],
        },
      };
    },
  }),
];
