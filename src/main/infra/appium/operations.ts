import { setTimeout as delay } from 'node:timers/promises';
import type { Locator, OS, NodeKind, Variant } from '../../../shared/domain/scenario.js';

const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';
export type StepErrorKind = 'missing' | 'ambiguous' | 'assertion' | 'invalid' | 'device';
export class StepError extends Error {
  constructor(
    public kind: StepErrorKind,
    message: string,
  ) {
    super(message);
  }
}
export interface OperationContext {
  deviceId: string;
  platform: OS;
  session: string;
  request: (
    route: string,
    method?: string,
    body?: unknown,
    timeout?: number,
    signal?: AbortSignal,
  ) => Promise<any>;
  onPointer?: (x: number, y: number, width: number, height: number) => void;
}
const elementId = (m: any): string => m[ELEMENT] ?? m.ELEMENT;

/** Resolve the first selector (primary, then fallbacks) matching exactly one component. */
async function locate(
  exec: (r: string, m?: string, b?: unknown) => Promise<any>,
  route: string,
  candidates: Locator[],
) {
  let ambiguous = 0;
  for (const locator of candidates) {
    const found: any[] = await exec(route + '/elements', 'POST', locator);
    if (found.length === 1) return { element: elementId(found[0]), locator, ambiguous: 0, seen: 1 };
    if (found.length > 1) ambiguous = Math.max(ambiguous, found.length);
  }
  return { element: undefined, locator: undefined, ambiguous, seen: 0 };
}

export async function performOperation(
  ctx: OperationContext,
  variant: Variant,
  kind: NodeKind,
  signal?: AbortSignal,
) {
  const route = `/session/${ctx.session}`;
  const exec = (r: string, m = 'GET', b?: unknown) => ctx.request(r, m, b, 30000, signal);
  const isTest = kind === 'test';

  if (!isTest && variant.operation === 'wait')
    return void (await delay(
      Math.min(Number(variant.value) || variant.timeoutMs, 60000),
      undefined,
      { signal },
    ));
  if (!isTest && variant.operation === 'back')
    return void (await exec(route + '/back', 'POST', {}));
  if (!isTest && variant.operation === 'swipe') return swipe(ctx, variant, exec, route);

  if (!isTest && variant.point && ['tap', 'type', 'clear'].includes(variant.operation))
    return pointOperation(ctx, variant, exec, route);

  const candidates = [variant.locator, ...variant.fallbacks].filter((l): l is Locator => !!l);
  if (!candidates.length)
    throw new StepError(
      'invalid',
      'Aucun composant associé à cet élément pour cet OS. Explorez l’écran et choisissez un composant.',
    );

  const deadline = Date.now() + variant.timeoutMs;
  let pointed = false;
  const point = async (element: string) => {
    if (pointed || !ctx.onPointer) return;
    pointed = true;
    try {
      const [rect, win] = await Promise.all([
        exec(`${route}/element/${encodeURIComponent(element)}/rect`),
        exec(route + '/window/rect'),
      ]);
      ctx.onPointer(rect.x + rect.width / 2, rect.y + rect.height / 2, win.width, win.height);
    } catch {
      /* pointer feedback is cosmetic */
    }
  };
  let attempts = 0;
  let failure = 'Composant introuvable';
  let found: { element?: string; locator?: Locator; ambiguous: number };
  while (true) {
    signal?.throwIfAborted();
    found = await locate(exec, route, candidates);
    if (found.element) await point(found.element);
    if (!isTest) {
      if (found.element) break;
      if (found.ambiguous) failure = `Sélecteur ambigu : ${found.ambiguous} composants`;
    } else if (variant.assertion === 'absent') {
      if (!found.element && !found.ambiguous) return;
      failure = 'Le composant devrait être absent';
    } else if (found.element) {
      const at = `${route}/element/${encodeURIComponent(found.element)}`;
      try {
        if (!(await exec(at + '/displayed'))) failure = 'Composant non visible';
        else if (variant.assertion === 'enabled' && !(await exec(at + '/enabled')))
          failure = 'Composant désactivé';
        else if (variant.assertion === 'text' || variant.assertion === 'contains') {
          const text = String(await exec(at + '/text'));
          const ok =
            variant.assertion === 'text'
              ? text === variant.expected
              : text.includes(variant.expected);
          if (ok) break;
          failure = `Texte ${variant.assertion === 'text' ? 'attendu' : 'contenant'} « ${variant.expected} », obtenu « ${text} »`;
        } else break;
      } catch (error) {
        if ((error as { code?: string }).code !== 'stale element reference') throw error;
        failure = 'Composant remplacé pendant l’attente';
      }
    } else if (found.ambiguous) failure = `Sélecteur ambigu : ${found.ambiguous} composants`;
    if (Date.now() >= deadline) {
      const ambiguous = failure.startsWith('Sélecteur ambigu');
      const missing = failure === 'Composant introuvable';
      throw new StepError(ambiguous ? 'ambiguous' : missing ? 'missing' : 'assertion', failure);
    }
    // Immediate first retry, then back off: a component usually shows up within a couple of frames.
    await delay(Math.min(250, 40 + attempts++ * 40), undefined, { signal });
  }
  if (isTest) return;

  const locator = found.locator!;
  let target = `${route}/element/${encodeURIComponent(found.element!)}`;
  if (variant.operation === 'type') {
    const ios = ctx.platform === 'ios';
    const refresh = async () => {
      while (true) {
        const again: any[] = await exec(route + '/elements', 'POST', locator);
        if (again.length > 1)
          throw new StepError('ambiguous', `Sélecteur ambigu : ${again.length} composants`);
        if (again.length === 1)
          return void (target = `${route}/element/${encodeURIComponent(elementId(again[0]))}`);
        if (Date.now() >= deadline)
          throw new StepError('missing', 'Champ de saisie introuvable après activation');
        await delay(100, undefined, { signal });
      }
    };
    const prepare = async (op: 'click' | 'clear') => {
      for (let attempt = 0; ; attempt++) {
        try {
          return void (await exec(`${target}/${op}`, 'POST', {}));
        } catch (error) {
          if (
            !ios ||
            (error as { code?: string }).code !== 'stale element reference' ||
            attempt >= 2
          )
            throw error;
          await refresh();
        }
      }
    };
    // Flutter TextField -> SecureTextField swap happens on focus: focus BEFORE typing.
    if (ios) {
      await prepare('click');
      await refresh();
    }
    await prepare('clear');
    if (ios) await refresh();
    // Never retry the value: an error after submission cannot prove no text was sent.
    await exec(`${target}/value`, 'POST', { text: variant.value });
  } else if (variant.operation === 'clear') await exec(`${target}/clear`, 'POST', {});
  else await exec(`${target}/click`, 'POST', {});
}

/** Finger direction: "up" moves the finger up, which scrolls the content down. */
async function swipe(
  ctx: OperationContext,
  variant: Variant,
  exec: (r: string, m?: string, b?: unknown) => Promise<any>,
  route: string,
) {
  const { width, height } = await exec(route + '/window/rect');
  const cx = Math.round(width / 2),
    cy = Math.round(height / 2);
  const dx = Math.round(width * 0.3),
    dy = Math.round(height * 0.3);
  const [x1, y1, x2, y2] = {
    up: [cx, cy + dy, cx, cy - dy],
    down: [cx, cy - dy, cx, cy + dy],
    left: [cx + dx, cy, cx - dx, cy],
    right: [cx - dx, cy, cx + dx, cy],
  }[variant.direction];
  await exec(route + '/actions', 'POST', {
    actions: [
      {
        type: 'pointer',
        id: 'finger1',
        parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, x: x1, y: y1 },
          { type: 'pointerDown', button: 0 },
          { type: 'pointerMove', duration: 400, x: x2, y: y2 },
          { type: 'pointerUp', button: 0 },
        ],
      },
    ],
  });
  await exec(route + '/actions', 'DELETE').catch(() => {});
}

/**
 * Content the accessibility tree cannot see (web views): tap a screen position, then type into whatever got focus.
 * Coordinates are fractions of the window, so they survive a different screen resolution.
 */
async function pointOperation(
  ctx: OperationContext,
  variant: Variant,
  exec: (r: string, m?: string, b?: unknown) => Promise<any>,
  route: string,
) {
  const { width, height } = await exec(route + '/window/rect');
  const x = Math.round(variant.point!.x * width),
    y = Math.round(variant.point!.y * height);
  await exec(route + '/actions', 'POST', {
    actions: [
      {
        type: 'pointer',
        id: 'finger1',
        parameters: { pointerType: 'touch' },
        actions: [
          { type: 'pointerMove', duration: 0, x, y },
          { type: 'pointerDown', button: 0 },
          { type: 'pause', duration: 80 },
          { type: 'pointerUp', button: 0 },
        ],
      },
    ],
  });
  await exec(route + '/actions', 'DELETE').catch(() => {});
  ctx.onPointer?.(x, y, width, height);
  if (variant.operation !== 'type') return;
  await delay(350); // focus + keyboard animation
  const script = ctx.platform === 'ios' ? 'mobile: keys' : 'mobile: type';
  const args = ctx.platform === 'ios' ? [{ keys: [...variant.value] }] : [{ text: variant.value }];
  // The value is typed once: never retried, an error after submission cannot prove nothing was sent.
  await exec(route + '/execute/sync', 'POST', { script, args });
}
