import sharp from 'sharp';
import type { z } from 'zod';
import type { Device } from '../../shared/domain/devices.js';
import { activeOs, type Project } from '../../shared/domain/project.js';
import { flatten, nodePath, type OS, type ScenarioNode } from '../../shared/domain/scenario.js';
import type { McpGroup } from '../../shared/mcp.js';
import type { Container } from '../container.js';

export interface ToolImage {
  /** Base64 data. */
  data: string;
  mime: 'image/jpeg' | 'image/png';
}
export interface ToolResult {
  /** What the calling AI reads: a JSON object (summary, data, next steps). */
  data: unknown;
  images?: ToolImage[];
  isError?: boolean;
}
export interface ProposalRecord {
  id: string;
  projectId: string;
  nodes: ScenarioNode[];
  parentId?: string;
  createdAt: number;
}
/** Shared state of the MCP server across calls (proposals waiting to be accepted). */
export interface McpState {
  proposals: Map<string, ProposalRecord>;
}
export interface Ctx {
  c: Container;
  state: McpState;
  signal: AbortSignal;
}
export interface ToolDef<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  group: McpGroup;
  title: string;
  /** Written for the calling AI: when to use it, what it returns. */
  description: string;
  input: Shape;
  /** Does not change anything (project, devices, app state). */
  readOnly?: boolean;
  run(args: z.infer<z.ZodObject<Shape>>, ctx: Ctx): Promise<ToolResult>;
}
export const defineTool = <Shape extends z.ZodRawShape>(tool: ToolDef<Shape>) =>
  tool as unknown as ToolDef;

/** A failure the calling AI can act on: what happened, why, and what to call next. */
export class ToolError extends Error {
  constructor(
    message: string,
    public hints: string[] = [],
  ) {
    super(message);
  }
}

export const osName = (os: OS) => (os === 'ios' ? 'iOS' : 'Android');
const norm = (v: string) => v.trim().toLowerCase();

export function resolveProject(ctx: Ctx, ref?: string): Project {
  const { projects, activeProjectId } = ctx.c.store.state;
  if (!ref) {
    const active = projects.find((p) => p.id === activeProjectId);
    if (!active)
      throw new ToolError('No project is open in Cybermonkey.', [
        'Call list_projects then open_project.',
      ]);
    return active;
  }
  const found =
    projects.find((p) => p.id === ref) ??
    projects.find((p) => norm(p.name) === norm(ref)) ??
    projects.find((p) => norm(p.name).includes(norm(ref)));
  if (!found)
    throw new ToolError(`Project “${ref}” not found.`, [
      'Available projects: ' + (projects.map((p) => p.name).join(', ') || 'none') + '.',
    ]);
  return found;
}
/** OS to act on: the explicit list, otherwise the ones currently ticked in the app (focus selector). */
export function resolvePlatforms(project: Project, requested?: OS[]): OS[] {
  const list = requested?.length ? requested : activeOs(project);
  const bad = list.filter((os) => !project.platforms.includes(os));
  if (bad.length)
    throw new ToolError(
      `Project “${project.name}” does not target ${bad.map(osName).join(', ')}.`,
      [`Project platforms: ${project.platforms.join(', ')}.`],
    );
  return [...new Set(list)];
}
export interface PairedDevice {
  os: OS;
  device?: Device;
  problem?: string;
}
export function pairedDevices(ctx: Ctx, project: Project, platforms: OS[]): PairedDevice[] {
  return platforms.map((os) => {
    const id = project.deviceIds[os];
    const device = id ? ctx.c.devices.known.get(id) : undefined;
    if (!id)
      return {
        os,
        problem: `No ${osName(os)} device is paired with the project. Plug one in (USB devices are paired automatically) or choose it in the Devices panel.`,
      };
    if (!device)
      return {
        os,
        problem: `The paired ${osName(os)} device (${id}) is not detected any more. Check the cable / emulator; call list_devices.`,
      };
    if (device.status !== 'ready')
      return {
        os,
        device,
        problem: `The ${osName(os)} device “${device.name}” is ${device.status}. Call get_device_health for the fix.`,
      };
    return { os, device };
  });
}
/** Devices ready for each requested OS; errors only when NONE is usable (partial results are reported by the caller). */
export function readyDevices(ctx: Ctx, project: Project, platforms: OS[]) {
  const paired = pairedDevices(ctx, project, platforms);
  const ready = paired.filter(
    (p): p is PairedDevice & { device: Device } => !!p.device && !p.problem,
  );
  const skipped = paired.filter((p) => p.problem).map((p) => ({ os: p.os, reason: p.problem! }));
  if (!ready.length)
    throw new ToolError(
      'No usable device for ' + platforms.map(osName).join(' / ') + '.',
      skipped.map((s) => s.reason),
    );
  return { ready, skipped };
}

export function resolveNode(project: Project, ref: string): ScenarioNode {
  const all = flatten(project.nodes);
  const byId = all.find((n) => n.id === ref);
  if (byId) return byId;
  const exact = all.filter((n) => norm(n.name) === norm(ref));
  if (exact.length === 1) return exact[0];
  const partial = exact.length ? exact : all.filter((n) => norm(n.name).includes(norm(ref)));
  if (partial.length === 1) return partial[0];
  const label = (n: ScenarioNode) =>
    `${n.id} (${n.kind}) ${nodePath(project.nodes, n.id)
      .map((p) => p.name)
      .join(' › ')}`;
  if (!partial.length)
    throw new ToolError(`No item matches “${ref}”.`, ['Call list_scenarios to see ids and names.']);
  throw new ToolError(`“${ref}” is ambiguous (${partial.length} items).`, [
    'Use one of these ids:',
    ...partial.slice(0, 8).map(label),
  ]);
}
export const pathNames = (project: Project, node: ScenarioNode) =>
  nodePath(project.nodes, node.id).map((n) => n.name);

/** Screenshot → compact JPEG: enough for a model to read, far lighter than the raw PNG. */
export async function toImage(dataUrl: string, width = 760): Promise<ToolImage> {
  const input = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
  const out = await sharp(input)
    .resize({ width, withoutEnlargement: true })
    .jpeg({ quality: 72 })
    .toBuffer();
  return { data: out.toString('base64'), mime: 'image/jpeg' };
}

/** Map low-level failures to something the calling AI understands. */
export function explainFailure(error: unknown): { message: string; hints: string[] } {
  if (error instanceof ToolError) return { message: error.message, hints: error.hints };
  const raw = error instanceof Error ? error.message : String(error);
  if (/occupé|déjà utilisé|already in use/i.test(raw))
    return {
      message: 'The device is busy: a run, an exploration or a recording is using it.',
      hints: ['Call get_run_status, then wait or call cancel_run.'],
    };
  if (/déjà en cours/i.test(raw))
    return {
      message: 'A run is already in progress.',
      hints: ['Call get_run_status to follow it, or cancel_run to stop it.'],
    };
  if (/non connecté|not connected/i.test(raw))
    return {
      message: 'A device is not connected.',
      hints: ['Call list_devices and get_device_health.'],
    };
  if (/Variable absente/i.test(raw))
    return {
      message: raw,
      hints: [
        'Call list_variables: the scenario references a variable that does not exist in the project.',
      ],
    };
  return { message: raw.split('\n')[0].slice(0, 400), hints: [] };
}
