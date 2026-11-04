import { screenFingerprint, type Component, type Screen } from '../../shared/domain/devices.js';
import type { Project } from '../../shared/domain/project.js';
import type { OS } from '../../shared/domain/scenario.js';
import { explainFailure, osName, pairedDevices, ToolError, type Ctx } from './context.js';
import { screenSummary } from './format.js';

export interface PerOs<T> {
  os: OS;
  device: string;
  ok: boolean;
  value?: T;
  error?: string;
  hints?: string[];
}
/**
 * Run `fn` on the paired device of each requested OS in parallel. A problem on one OS never hides the result of the
 * other: each OS reports its own success or its own error with what to do.
 */
export async function onEachOs<T>(
  ctx: Ctx,
  project: Project,
  platforms: OS[],
  fn: (deviceId: string, os: OS) => Promise<T>,
): Promise<PerOs<T>[]> {
  const paired = pairedDevices(ctx, project, platforms);
  const out = await Promise.all(
    paired.map(async (p): Promise<PerOs<T>> => {
      if (!p.device || p.problem)
        return { os: p.os, device: p.device?.name ?? 'none', ok: false, error: p.problem };
      try {
        return { os: p.os, device: p.device.name, ok: true, value: await fn(p.device.id, p.os) };
      } catch (error) {
        const e = explainFailure(error);
        return { os: p.os, device: p.device.name, ok: false, error: e.message, hints: e.hints };
      }
    }),
  );
  if (out.every((o) => !o.ok)) {
    // Nothing worked anywhere: a single clear error is more useful than N identical ones.
    throw new ToolError(out.map((o) => `${osName(o.os)}: ${o.error}`).join(' | '), [
      ...new Set(out.flatMap((o) => o.hints ?? [])),
    ]);
  }
  return out;
}

/** Wait (≤ ~2 s) until the screen stops changing, so the caller sees the result of an action, not a transition. */
export async function settledScreen(ctx: Ctx, deviceId: string): Promise<Screen> {
  let screen = await ctx.c.automation.inspect(deviceId);
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 220));
    const next = await ctx.c.automation.inspect(deviceId);
    const same = screenFingerprint(next) === screenFingerprint(screen);
    screen = next;
    if (same) break;
  }
  return screen;
}

const norm = (v: string) => v.trim().toLowerCase();
export interface Target {
  component_id?: string;
  text?: string;
  locator?: { using: 'id' | 'accessibility id' | 'xpath'; value: string };
}
/** Find the component a caller means on one screen; ambiguity is an error listing the candidates. */
export function findComponent(screen: Screen, target: Target): Component | undefined {
  const list = screen.components.filter((c) => c.locator);
  if (target.component_id) return list.find((c) => c.id === target.component_id);
  if (target.locator)
    return list.find(
      (c) =>
        c.locator!.using === target.locator!.using && c.locator!.value === target.locator!.value,
    );
  if (!target.text) return undefined;
  const t = norm(target.text);
  const exact = list.filter((c) => norm(c.label) === t || norm(c.text) === t);
  const pool = exact.length
    ? exact
    : list.filter((c) => norm(c.label).includes(t) || norm(c.text).includes(t));
  const preferred = pool.filter((c) => c.interactive);
  const final = preferred.length ? preferred : pool;
  if (final.length > 1) {
    const unique = new Map(final.map((c) => [c.locator!.value, c]));
    if (unique.size > 1)
      throw new ToolError(`“${target.text}” matches ${unique.size} components on this screen.`, [
        'Pick one with component_id: ' +
          [...unique.values()]
            .slice(0, 6)
            .map(
              (c) =>
                `${c.id} (${c.type.replace(/^XCUIElementType/, '')} “${c.label.slice(0, 40)}”)`,
            )
            .join('; '),
      ]);
  }
  return final[0];
}
export const describeTarget = (c: Component) =>
  `${c.type.replace(/^XCUIElementType/, '')} “${(c.label || c.text).slice(0, 60)}”`;

export function afterSummary(
  screen: Screen,
  os: OS,
  project: Project,
  mode: 'summary' | 'full' | 'none',
) {
  if (mode === 'none') return undefined;
  const s = screenSummary(screen, os, project, mode === 'full' ? 120 : 40);
  return mode === 'full'
    ? s
    : {
        screen: s.screen,
        tappable: s.components
          .filter((c) => 'tappable' in c)
          .map((c) => `${c.id}: ${c.label}`)
          .slice(0, 25),
        total_components: screen.components.length,
        ...(s.opaque_regions ? { opaque_regions: s.opaque_regions } : {}),
      };
}
