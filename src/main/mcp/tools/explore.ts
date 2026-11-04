import { z } from 'zod';
import { effectiveVariables } from '../../../shared/domain/project.js';
import { makeVariant, type Variant } from '../../../shared/domain/scenario.js';
import {
  afterSummary,
  describeTarget,
  findComponent,
  onEachOs,
  settledScreen,
  type Target,
} from '../devices.js';
import {
  defineTool,
  osName,
  readyDevices,
  resolvePlatforms,
  resolveProject,
  ToolError,
  type ProposalRecord,
} from '../context.js';
import { outline } from '../format.js';

const platformsArg = z
  .array(z.enum(['android', 'ios']))
  .optional()
  .describe('OS to act on. Default: the OS currently ticked in the app.');
const projectArg = z.string().optional().describe('Project id or name. Default: the open project.');
const targetArgs = {
  component_id: z
    .string()
    .optional()
    .describe('Component id from inspect_screen (specific to one OS: use text for both OS).'),
  text: z
    .string()
    .optional()
    .describe('Text/label of the component; resolved on each OS separately.'),
  locator: z
    .object({ using: z.enum(['id', 'accessibility id', 'xpath']), value: z.string() })
    .optional(),
  point: z
    .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
    .optional()
    .describe('Screen position as fractions (0–1), e.g. for web-view content: see screenshot.'),
  after: z
    .enum(['summary', 'full', 'none'])
    .default('summary')
    .describe('Screen state returned after the action.'),
  platforms: platformsArg,
  project: projectArg,
};

/** Perform one operation on every active OS and report the resulting screen. */
async function act(
  ctx: Parameters<NonNullable<ReturnType<typeof defineTool>['run']>>[1],
  args: { project?: string; platforms?: ('android' | 'ios')[]; after: 'summary' | 'full' | 'none' },
  build: (
    screen: Awaited<ReturnType<typeof ctx.c.automation.inspect>>,
    os: 'android' | 'ios',
  ) => { variant: Partial<Variant>; what: string; kind?: 'action' | 'test' },
) {
  const project = resolveProject(ctx, args.project);
  const results = await onEachOs(
    ctx,
    project,
    resolvePlatforms(project, args.platforms),
    async (id, os) => {
      const screen = await ctx.c.automation.inspect(id);
      const { variant, what, kind } = build(screen, os);
      await ctx.c.automation.perform(
        id,
        makeVariant(variant),
        kind ?? 'action',
        undefined,
        ctx.signal,
        effectiveVariables(project),
        true,
        project.applications?.[os],
      );
      return {
        did: what,
        screen: afterSummary(await settledScreen(ctx, id), os, project, args.after),
      };
    },
  );
  return {
    data: {
      summary: results
        .map((r) => `${osName(r.os)}: ${r.ok ? r.value!.did : 'ERROR ' + r.error}`)
        .join(' | '),
      per_os: Object.fromEntries(
        results.map((r) => [
          r.os,
          r.ok
            ? { device: r.device, ...r.value }
            : { device: r.device, error: r.error, hints: r.hints },
        ]),
      ),
      next_steps: ['screenshot to see the result, inspect_screen for details.'],
    },
  };
}
const locate = (
  screen: Parameters<typeof findComponent>[0],
  t: Target & { point?: { x: number; y: number } },
  os: string,
): { variant: Partial<Variant>; what: string } => {
  if (t.point)
    return {
      variant: { point: t.point },
      what: `position ${Math.round(t.point.x * 100)}%,${Math.round(t.point.y * 100)}%`,
    };
  if (!t.component_id && !t.text && !t.locator)
    throw new ToolError('Give component_id, text, locator or point.', [
      'inspect_screen lists the components.',
    ]);
  const found = findComponent(screen, t);
  if (!found)
    throw new ToolError(
      `No matching component on the ${os} screen (“${screen.components.length}” components visible).`,
      [
        'inspect_screen to see what is there; for web-view content use point (fractions) after a screenshot.',
      ],
    );
  return {
    variant: { locator: found.locator!, hint: found.label || found.text },
    what: describeTarget(found),
  };
};

/** Like `locate`, but the component may be off screen or absent (scroll, absence checks): text becomes an accessibility id. */
const locateLoose = (
  screen: Parameters<typeof findComponent>[0],
  t: Target,
  os: string,
): { variant: Partial<Variant>; what: string } => {
  if (!t.component_id && !t.text && !t.locator)
    throw new ToolError('Give text, locator or component_id.', [
      'text is matched as an accessibility id / label even when the component is not on screen.',
    ]);
  const found = t.component_id || t.locator ? findComponent(screen, t) : undefined;
  if (found)
    return {
      variant: { locator: found.locator!, hint: found.label || found.text },
      what: describeTarget(found),
    };
  if (t.locator)
    return {
      variant: { locator: t.locator, hint: t.text },
      what: `${t.locator.using}: ${t.locator.value}`,
    };
  if (t.component_id)
    throw new ToolError(`Component ${t.component_id} is not on the ${os} screen.`, [
      'Use text or locator for a component that is off screen.',
    ]);
  return {
    variant: { locator: { using: 'accessibility id', value: t.text! }, hint: t.text },
    what: `“${t.text}”`,
  };
};
const looseTarget = {
  component_id: targetArgs.component_id,
  text: z
    .string()
    .optional()
    .describe(
      'Text/label of the component (accessibility id on both OS); works for components that are off screen.',
    ),
  locator: targetArgs.locator,
};
const lifecycle = { after: targetArgs.after, platforms: platformsArg, project: projectArg };

export const exploreTools = [
  defineTool({
    name: 'explore',
    group: 'explore',
    title: 'Explore the app with the AI',
    description:
      'The creation agent explores the app on the active OS(es) following your goal (e.g. “find how to reach the settings and what is there”) and reports what it found: screens, flows, components. Slow (minutes) but autonomous. Use click/inspect_screen for manual, fast exploration. No scenario is saved; if the agent also drafts one it is kept as a proposal.',
    input: { goal: z.string().min(5), platforms: platformsArg, project: projectArg },
    async run(a, ctx) {
      const project = resolveProject(ctx, a.project);
      const { ready } = readyDevices(ctx, project, resolvePlatforms(project, a.platforms));
      const abort = () => ctx.c.creation.cancel(project.id);
      ctx.signal.addEventListener('abort', abort, { once: true });
      try {
        const reply = await ctx.c.creation.ask({
          projectId: project.id,
          prompt:
            'EXPLORATION ONLY — do not write a long scenario. ' +
            a.goal +
            '\nReport what you found (screens reached, how, notable components).',
          deviceIds: ready.map((r) => r.device.id),
          overrides: { autoApprove: true, replay: false },
        });
        let proposal: string | undefined;
        if (reply.proposal?.length) {
          const record: ProposalRecord = {
            id: crypto.randomUUID().slice(0, 8),
            projectId: project.id,
            nodes: reply.proposal,
            parentId: reply.parentId,
            createdAt: Date.now(),
          };
          ctx.state.proposals.set(record.id, record);
          proposal = record.id;
        }
        return {
          data: {
            summary: reply.text.slice(0, 400),
            findings: reply.text,
            coverage: reply.coverage,
            ...(proposal
              ? { draft_proposal_id: proposal, draft: outline(project, reply.proposal!) }
              : {}),
            next_steps: ['screenshot / inspect_screen to see where the app is now.'],
          },
        };
      } catch (e) {
        throw new ToolError(e instanceof Error ? e.message.split('\n')[0] : String(e), [
          'If a run is in progress: cancel_run. get_device_health for device problems.',
        ]);
      } finally {
        ctx.signal.removeEventListener('abort', abort);
      }
    },
  }),
  defineTool({
    name: 'click',
    group: 'explore',
    title: 'Tap a component or a position',
    description:
      'Taps a component (by component_id from inspect_screen, by text — resolved on each OS — or by selector) or a screen position (point, fractions). Returns the screen the app ended up on, per OS. The cheapest way to move through the app by hand.',
    input: targetArgs,
    run: (a, ctx) =>
      act(ctx, a, (screen, os) => {
        const l = locate(screen, a, osName(os));
        return { variant: { ...l.variant, operation: 'tap' }, what: 'tapped ' + l.what };
      }),
  }),
  defineTool({
    name: 'type_text',
    group: 'explore',
    title: 'Type text',
    description:
      'Types text into a component (component_id / text / locator) or at a position. ${VARIABLE} placeholders are resolved from the project variables (use them for credentials).',
    input: { ...targetArgs, value: z.string().describe('Text to type.') },
    run: (a, ctx) =>
      act(ctx, a, (screen, os) => {
        const l = locate(screen, a, osName(os));
        return {
          variant: { ...l.variant, operation: 'type', value: a.value },
          what: `typed into ${l.what}`,
        };
      }),
  }),
  defineTool({
    name: 'swipe',
    group: 'explore',
    title: 'Swipe',
    description:
      'Swipes on the screen (direction = direction of the finger movement: “up” scrolls content down).',
    input: {
      direction: z.enum(['up', 'down', 'left', 'right']),
      after: targetArgs.after,
      platforms: platformsArg,
      project: projectArg,
    },
    run: (a, ctx) =>
      act(ctx, a, () => ({
        variant: { operation: 'swipe', direction: a.direction },
        what: 'swiped ' + a.direction,
      })),
  }),
  defineTool({
    name: 'long_press',
    group: 'explore',
    title: 'Long press',
    description:
      'Presses and holds a component or a position (context menus, selection mode, drag handles).',
    input: { ...targetArgs, duration_ms: z.number().int().min(200).max(30000).default(1000) },
    run: (a, ctx) =>
      act(ctx, a, (screen, os) => {
        const l = locate(screen, a, osName(os));
        return {
          variant: { ...l.variant, operation: 'longpress', value: String(a.duration_ms) },
          what: 'long-pressed ' + l.what,
        };
      }),
  }),
  defineTool({
    name: 'double_tap',
    group: 'explore',
    title: 'Double tap',
    description: 'Double-taps a component or a position (zoom, like…).',
    input: targetArgs,
    run: (a, ctx) =>
      act(ctx, a, (screen, os) => {
        const l = locate(screen, a, osName(os));
        return {
          variant: { ...l.variant, operation: 'doubletap' },
          what: 'double-tapped ' + l.what,
        };
      }),
  }),
  defineTool({
    name: 'scroll_to',
    group: 'explore',
    title: 'Scroll until a component is visible',
    description:
      'Swipes until the component is displayed (long lists), then stops: follow with click. Prefer it to counting swipes. direction = finger direction (“up” scrolls content down).',
    input: {
      ...looseTarget,
      direction: z.enum(['up', 'down', 'left', 'right']).default('up'),
      max_swipes: z.number().int().min(1).max(40).default(8),
      after: targetArgs.after,
      platforms: platformsArg,
      project: projectArg,
    },
    run: (a, ctx) =>
      act(ctx, a, (screen, os) => {
        const l = locateLoose(screen, a, osName(os));
        return {
          variant: {
            ...l.variant,
            operation: 'scroll',
            direction: a.direction,
            value: String(a.max_swipes),
          },
          what: `scrolled to ${l.what}`,
        };
      }),
  }),
  defineTool({
    name: 'check',
    group: 'explore',
    title: 'Check something on the screen',
    description:
      'Verifies a condition right now on each active OS without saving anything: visible, absent, text (exact), contains, matches (regular expression), enabled, selected, count (expected like 3, >=2, <5). A failed check is reported as an ERROR for that OS with the reason. Use it to try an assertion before adding it as a test with add_nodes.',
    input: {
      ...looseTarget,
      assertion: z.enum([
        'visible',
        'absent',
        'text',
        'contains',
        'matches',
        'enabled',
        'selected',
        'count',
      ]),
      expected: z
        .string()
        .default('')
        .describe('Text, regular expression or count, depending on the assertion.'),
      timeout_ms: z.number().int().min(0).max(60000).default(3000),
      after: targetArgs.after,
      platforms: platformsArg,
      project: projectArg,
    },
    run: (a, ctx) =>
      act(ctx, a, (screen, os) => {
        const l = locateLoose(screen, a, osName(os));
        return {
          kind: 'test',
          variant: {
            ...l.variant,
            operation: 'assert',
            assertion: a.assertion,
            expected: a.expected,
            timeoutMs: a.timeout_ms,
          },
          what: `check passed: ${l.what} ${a.assertion}${a.expected ? ' ' + a.expected : ''}`,
        };
      }),
  }),
  defineTool({
    name: 'open_link',
    group: 'explore',
    title: 'Open a deep link',
    description:
      'Opens a deep link / URL in the project application (the fastest way to reach a screen when the app registers links, e.g. myapp://order/42). Needs the application id set in the project. ${VARIABLE} allowed.',
    input: { url: z.string().min(3), ...lifecycle },
    run: (a, ctx) =>
      act(ctx, a, () => ({
        variant: { operation: 'deeplink', value: a.url },
        what: 'opened ' + a.url,
      })),
  }),
  defineTool({
    name: 'answer_alert',
    group: 'explore',
    title: 'Answer a system alert or permission dialog',
    description:
      'Accepts or dismisses a system dialog (permissions, “Open in…”, native alerts), optionally by exact button label. Waits a few seconds for it to appear. Does not see in-app dialogs (use click).',
    input: {
      answer: z
        .string()
        .default('accept')
        .describe('accept, dismiss, or the exact button label (e.g. “Allow While Using App”).'),
      timeout_ms: z.number().int().min(0).max(30000).default(4000),
      ...lifecycle,
    },
    run: (a, ctx) =>
      act(ctx, a, () => ({
        variant: { operation: 'alert', value: a.answer, timeoutMs: a.timeout_ms },
        what: 'answered the alert: ' + a.answer,
      })),
  }),
  defineTool({
    name: 'app_control',
    group: 'explore',
    title: 'Launch, close or background the app',
    description:
      'launch (bring to front / start), relaunch (close then start, data kept), terminate, or background (send to background for N seconds, then restore). Uses the project application id.',
    input: {
      action: z.enum(['launch', 'relaunch', 'terminate', 'background']),
      seconds: z.number().min(0).max(120).default(2).describe('Only for background.'),
      ...lifecycle,
    },
    run: (a, ctx) =>
      act(ctx, a, () => ({
        variant: {
          operation: a.action,
          ...(a.action === 'background' ? { value: String(a.seconds) } : {}),
        },
        what: a.action,
      })),
  }),
  defineTool({
    name: 'rotate',
    group: 'explore',
    title: 'Rotate the device / hide the keyboard',
    description:
      'Sets the orientation (portrait or landscape) or hides the on-screen keyboard. An app that locks its orientation answers with an explicit error.',
    input: { action: z.enum(['portrait', 'landscape', 'hide_keyboard']), ...lifecycle },
    run: (a, ctx) =>
      act(ctx, a, () => ({
        variant:
          a.action === 'hide_keyboard'
            ? { operation: 'hidekeyboard' }
            : { operation: 'orientation', value: a.action },
        what: a.action,
      })),
  }),
  defineTool({
    name: 'back',
    group: 'explore',
    title: 'Go back',
    description:
      'Presses back (Android back button / iOS back gesture) on each active OS and returns the resulting screen.',
    input: { after: targetArgs.after, platforms: platformsArg, project: projectArg },
    run: (a, ctx) => act(ctx, a, () => ({ variant: { operation: 'back' }, what: 'went back' })),
  }),
];
