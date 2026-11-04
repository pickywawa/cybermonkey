import { z } from 'zod';
import { nodeSchema } from '../domain/scenario.js';

/** JSON Schema for provider structured output. The `$schema` marker is dropped: some CLIs only know draft-07. */
const toSchema = (schema: z.ZodType): object => {
  const { $schema: _marker, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
};

export const TOOLS = [
  'inspect',
  'perform',
  'sequence',
  'prepare',
  'ready',
  'question',
  'create_variable',
  'finish',
] as const;
export type Tool = (typeof TOOLS)[number];

/**
 * Single flat object sent as the provider's structured-output schema (widest compatibility).
 * The model's answer is then validated per tool by `parseDecision`, which is far more forgiving.
 */
export const decisionWireSchema = z.object({
  tool: z.enum(TOOLS),
  deviceId: z.string().nullable(),
  targetNodeId: z.string().nullable(),
  componentId: z.string().nullable(),
  /** Grid cell (e.g. "C7") designating a target in a region the accessibility tree cannot expose. */
  cell: z.string().nullable(),
  operation: z.enum(['tap', 'type', 'clear', 'back', 'swipe']).nullable(),
  value: z.string().nullable(),
  direction: z.enum(['up', 'down', 'left', 'right']).nullable(),
  summary: z.string().nullable(),
  sessionTitle: z.string().nullable(),
  variableName: z.string().nullable(),
  /** Several actions on the same screen, executed back to back by the host (forms). */
  steps: z
    .array(
      z.object({
        componentId: z.string().nullable(),
        cell: z.string().nullable(),
        operation: z.enum(['tap', 'type', 'clear', 'back', 'swipe']),
        value: z.string().nullable(),
        direction: z.enum(['up', 'down', 'left', 'right']).nullable(),
      }),
    )
    .nullable(),
  nodes: z.array(nodeSchema).nullable(),
});
export const decisionJsonSchema = toSchema(decisionWireSchema);

export interface SequenceStep {
  componentId?: string;
  cell?: string;
  operation: 'tap' | 'type' | 'clear' | 'back' | 'swipe';
  value: string;
  direction: 'up' | 'down' | 'left' | 'right';
}
export type Decision =
  | { tool: 'inspect'; deviceId: string }
  | {
      tool: 'perform';
      deviceId: string;
      componentId?: string;
      cell?: string;
      operation: 'tap' | 'type' | 'clear' | 'back' | 'swipe';
      value: string;
      direction: 'up' | 'down' | 'left' | 'right';
    }
  | { tool: 'sequence'; deviceId: string; steps: SequenceStep[] }
  | { tool: 'prepare'; deviceId: string; targetNodeId?: string; summary?: string }
  | { tool: 'ready'; deviceId: string; componentId: string; summary?: string }
  | { tool: 'question'; summary: string }
  | { tool: 'create_variable'; variableName: string; value: string }
  | { tool: 'finish'; summary: string; sessionTitle?: string; nodes: unknown[] };

/** Find the first balanced JSON object in free text (fences, prose before/after tolerated). */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced)
    try {
      return JSON.parse(fenced[1]);
    } catch {
      /* fall through */
    }
  for (let start = trimmed.indexOf('{'); start >= 0; start = trimmed.indexOf('{', start + 1)) {
    let depth = 0,
      inString = false,
      escaped = false;
    for (let i = start; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        try {
          return JSON.parse(trimmed.slice(start, i + 1));
        } catch {
          break;
        }
      }
    }
  }
  throw new Error('Aucun objet JSON dans la réponse');
}

const str = z.preprocess((v) => (v == null ? undefined : v), z.string());
const opt = z.preprocess((v) => (v == null || v === '' ? undefined : v), z.string().optional());
const decisions = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('inspect'), deviceId: str }),
  z.object({
    tool: z.literal('perform'),
    deviceId: str,
    componentId: opt,
    cell: opt,
    operation: z.enum(['tap', 'type', 'clear', 'back', 'swipe']),
    value: z.preprocess((v) => v ?? '', z.string().max(5000)),
    direction: z.preprocess((v) => v ?? 'up', z.enum(['up', 'down', 'left', 'right'])),
  }),
  z.object({
    tool: z.literal('sequence'),
    deviceId: str,
    steps: z
      .array(
        z.object({
          componentId: opt,
          cell: opt,
          operation: z.enum(['tap', 'type', 'clear', 'back', 'swipe']),
          value: z.preprocess((v) => v ?? '', z.string().max(5000)),
          direction: z.preprocess((v) => v ?? 'up', z.enum(['up', 'down', 'left', 'right'])),
        }),
      )
      .min(1)
      .max(8),
  }),
  z.object({ tool: z.literal('prepare'), deviceId: str, targetNodeId: opt, summary: opt }),
  z.object({ tool: z.literal('ready'), deviceId: str, componentId: str, summary: opt }),
  z.object({ tool: z.literal('question'), summary: z.string().trim().min(1).max(4000) }),
  z.object({ tool: z.literal('create_variable'), variableName: str, value: str }),
  z.object({
    tool: z.literal('finish'),
    summary: z.preprocess((v) => v ?? '', z.string().max(8000)),
    sessionTitle: opt,
    nodes: z.preprocess((v) => v ?? [], z.array(z.unknown())),
  }),
]);

export function parseDecision(
  text: string,
): { ok: true; decision: Decision } | { ok: false; error: string } {
  let json: any;
  try {
    json = extractJson(text);
  } catch (e) {
    return { ok: false, error: String((e as Error).message) };
  }
  // Models sometimes wrap the decision or nest it under a key.
  if (json && typeof json === 'object' && !json.tool && json.decision) json = json.decision;
  const parsed = decisions.safeParse(json);
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.') || 'root'}: ${i.message}`)
        .join('; '),
    };
  return { ok: true, decision: parsed.data as Decision };
}

/** Structured failure analysis returned by the AI after a failed step. */
export const analysisSchema = z.object({
  verdict: z.enum(['regression', 'environment', 'obsolete-selector', 'unknown']),
  summary: z.string().max(2000),
  evidence: z.array(z.string().max(500)).max(8).default([]),
  fix: z.string().max(2000).nullable().optional(),
});
export const analysisJsonSchema = toSchema(analysisSchema);

/** Answer of the self-healing prompt. */
export const healingSchema = z.object({
  componentId: z.string().nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
  reason: z.string().max(500),
});
export const healingJsonSchema = toSchema(healingSchema);

/** What the AI makes of a screen that interrupts a failing step. */
export const interruptionSchema = z.object({
  kind: z.enum([
    'popup',
    'toast',
    'session-expired',
    'logged-out',
    'network-error',
    'crash-screen',
    'permission',
    'unrelated',
  ]),
  /** The ONE component that closes or acknowledges it (close, OK, later, not now), or null. */
  componentId: z.string().nullable(),
  /** Name of one of the known handlers if it clearly describes this situation. */
  handler: z.string().nullable(),
  summary: z.string().max(300),
});
export const interruptionJsonSchema = toSchema(interruptionSchema);
export const alertChoiceSchema = z.object({
  /** Exact label of the button to press, or null to leave the dialog alone. */
  button: z.string().nullable(),
  reason: z.string().max(300),
});
export const alertChoiceJsonSchema = toSchema(alertChoiceSchema);

/** Answer used to resolve which component a user tapped between two screens (recorder). */
export const tapResolutionSchema = z.object({
  componentId: z.string().nullable(),
  operation: z.enum(['tap', 'type', 'clear', 'back', 'swipe']).default('tap'),
  value: z.string().nullable().optional(),
  stepName: z.string().max(180),
  confidence: z.enum(['high', 'medium', 'low']),
});
export const tapResolutionJsonSchema = toSchema(tapResolutionSchema);
