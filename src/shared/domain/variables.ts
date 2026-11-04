import { z } from 'zod';
import type { Variant } from './scenario.js';

export const variableName = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
  .max(100)
  .refine((key) => !['__proto__', 'constructor', 'prototype'].includes(key));
export const variablesSchema = z.record(variableName, z.string().max(20000));
export const PLACEHOLDER = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;
const SECRET_ENV_PREFIX = 'CYBERMONKEY_SECRET_';

export function resolveVariables(
  text: string,
  variables: Record<string, string>,
  environment: Record<string, string | undefined> = {},
): string {
  return text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, key: string) => {
    if (Object.hasOwn(variables, key)) return variables[key];
    const fallback = environment[SECRET_ENV_PREFIX + key];
    if (fallback !== undefined) return fallback;
    throw new Error('Variable absente du projet : ' + key);
  });
}
export function resolveVariant(
  variant: Variant,
  variables: Record<string, string>,
  environment: Record<string, string | undefined> = {},
): Variant {
  const r = (v: string) => resolveVariables(v, variables, environment);
  const loc = (l: NonNullable<Variant['locator']>) => ({ ...l, value: r(l.value) });
  return {
    ...variant,
    value: r(variant.value),
    expected: r(variant.expected),
    locator: variant.locator ? loc(variant.locator) : undefined,
    fallbacks: variant.fallbacks.map(loc),
  };
}
/** Variable names referenced anywhere in a string. */
export function referencedVariables(text: string): string[] {
  return [...text.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1]);
}
/** Replace every known secret value by a mask (traces, logs, AI context). */
export function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const s of [...secrets].filter((s) => s.length >= 3).sort((a, b) => b.length - a.length))
    out = out.split(s).join('[REDACTED]');
  return out;
}
export const secretEnvironment = (env: Record<string, string | undefined>) =>
  Object.entries(env)
    .filter(([k, v]) => k.startsWith(SECRET_ENV_PREFIX) && v)
    .map(([, v]) => v as string);
