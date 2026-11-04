import { setTimeout as delay } from 'node:timers/promises';
import { variableName } from '../../../shared/domain/variables.js';
import {
  POINT_OPERATIONS,
  type Locator,
  type OS,
  type NodeKind,
  type Variant,
} from '../../../shared/domain/scenario.js';

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
  /** Bundle id / package of the project's application on this device, when configured. */
  application?: string;
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
): Promise<string | void> {
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
  if (!isTest && DEVICE_LEVEL.has(variant.operation))
    return deviceOperation(ctx, variant, exec, route, signal);

  if (!isTest && variant.point && POINT_OPERATIONS.includes(variant.operation))
    return pointOperation(ctx, variant, exec, route, signal);

  const candidates = [variant.locator, ...variant.fallbacks].filter((l): l is Locator => !!l);
  if (!candidates.length)
    throw new StepError(
      'invalid',
      'Aucun composant associé à cet élément pour cet OS. Explorez l’écran et choisissez un composant.',
    );

  if (!isTest && variant.operation === 'scroll')
    return scrollTo(ctx, variant, candidates, exec, route, signal);
  if (isTest && variant.assertion === 'count')
    return assertCount(variant, candidates, exec, route, signal);

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
        else if (variant.assertion === 'selected' && !(await exec(at + '/selected')))
          failure = 'Composant non sélectionné';
        else if (
          variant.assertion === 'text' ||
          variant.assertion === 'contains' ||
          variant.assertion === 'matches'
        ) {
          const text = String(await exec(at + '/text'));
          const pattern = variant.assertion === 'matches' ? regex(variant.expected) : undefined;
          const ok =
            variant.assertion === 'text'
              ? text === variant.expected
              : variant.assertion === 'contains'
                ? text.includes(variant.expected)
                : pattern!.test(text);
          if (ok) break;
          failure =
            variant.assertion === 'matches'
              ? `Texte « ${text} » ne correspond pas à l’expression /${variant.expected}/`
              : `Texte ${variant.assertion === 'text' ? 'attendu' : 'contenant'} « ${variant.expected} », obtenu « ${text} »`;
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
  else if (variant.operation === 'capture')
    return captureText(variant, found.element!, exec, route);
  else if (variant.operation === 'longpress' || variant.operation === 'doubletap')
    await elementGesture(ctx, variant, found.element!, exec, route);
  else await exec(`${target}/click`, 'POST', {});
}

/**
 * Read the text of a component into a variable. `expected` is an optional regular expression: its first group (or the
 * whole match) is kept, e.g. `n°(\\d+)` on « Commande n°4821 confirmée » gives 4821.
 */
async function captureText(
  variant: Variant,
  element: string,
  exec: (r: string, m?: string, b?: unknown) => Promise<any>,
  route: string,
): Promise<string> {
  if (!variableName.safeParse(variant.value).success)
    throw new StepError(
      'invalid',
      'Nom de variable invalide : lettres, chiffres et _ uniquement, sans espace (ex. NUMERO_COMMANDE).',
    );
  const text = String(await exec(`${route}/element/${encodeURIComponent(element)}/text`)).trim();
  if (!variant.expected) {
    if (!text) throw new StepError('assertion', 'Le composant ne contient aucun texte à capturer.');
    return text;
  }
  const match = regex(variant.expected).exec(text);
  if (!match)
    throw new StepError(
      'assertion',
      `Rien à capturer : « ${text} » ne correspond pas à l’expression /${variant.expected}/.`,
    );
  return match[1] ?? match[0];
}

const DEVICE_LEVEL = new Set<string>([
  'launch',
  'relaunch',
  'terminate',
  'background',
  'deeplink',
  'alert',
  'orientation',
  'hidekeyboard',
]);

const regex = (source: string): RegExp => {
  try {
    return new RegExp(source);
  } catch {
    throw new StepError('invalid', `Expression régulière invalide : ${source}`);
  }
};
/** "3", "=3", ">=2", "<5"… compared with the number of components found. */
function countMatches(expected: string, actual: number): boolean {
  const m = /^\s*(>=|<=|>|<|=)?\s*(\d+)\s*$/.exec(expected);
  if (!m)
    throw new StepError('invalid', `Nombre attendu invalide : « ${expected} » (ex. 3, >=2, <5).`);
  const n = Number(m[2]);
  return (
    { '>=': actual >= n, '<=': actual <= n, '>': actual > n, '<': actual < n }[m[1] as '>='] ??
    actual === n
  );
}
async function assertCount(
  variant: Variant,
  candidates: Locator[],
  exec: (r: string, m?: string, b?: unknown) => Promise<any>,
  route: string,
  signal?: AbortSignal,
) {
  const deadline = Date.now() + variant.timeoutMs;
  let attempts = 0;
  while (true) {
    signal?.throwIfAborted();
    let actual = 0;
    for (const locator of candidates) {
      actual = ((await exec(route + '/elements', 'POST', locator)) as unknown[]).length;
      if (actual) break;
    }
    if (countMatches(variant.expected, actual)) return;
    if (Date.now() >= deadline)
      throw new StepError(
        'assertion',
        `Nombre de composants attendu « ${variant.expected} », obtenu ${actual}`,
      );
    await delay(Math.min(250, 40 + attempts++ * 40), undefined, { signal });
  }
}

/** Long press / double tap on a located component, with the driver's native gestures. */
async function elementGesture(
  ctx: OperationContext,
  variant: Variant,
  element: string,
  exec: (r: string, m?: string, b?: unknown) => Promise<any>,
  route: string,
) {
  const ios = ctx.platform === 'ios';
  const ms = Math.max(200, Math.min(Number(variant.value) || 1000, 30000));
  const [script, args] =
    variant.operation === 'longpress'
      ? ios
        ? ['mobile: touchAndHold', { elementId: element, duration: ms / 1000 }]
        : ['mobile: longClickGesture', { elementId: element, duration: ms }]
      : ios
        ? ['mobile: doubleTap', { elementId: element }]
        : ['mobile: doubleClickGesture', { elementId: element }];
  await exec(route + '/execute/sync', 'POST', { script, args: [args] });
}

/** Swipe until the target is displayed (long lists). Gives up after `value` swipes (default 8). */
async function scrollTo(
  ctx: OperationContext,
  variant: Variant,
  candidates: Locator[],
  exec: (r: string, m?: string, b?: unknown) => Promise<any>,
  route: string,
  signal?: AbortSignal,
) {
  const max = Math.max(1, Math.min(Number(variant.value) || 8, 40));
  const deadline = Date.now() + Math.max(variant.timeoutMs, 15000);
  for (let swipes = 0; ; swipes++) {
    signal?.throwIfAborted();
    const found = await locate(exec, route, candidates);
    if (found.element) {
      try {
        if (await exec(`${route}/element/${encodeURIComponent(found.element)}/displayed`)) return;
      } catch (error) {
        if ((error as { code?: string }).code !== 'stale element reference') throw error;
      }
    } else if (found.ambiguous)
      throw new StepError('ambiguous', `Sélecteur ambigu : ${found.ambiguous} composants`);
    if (swipes >= max || Date.now() >= deadline)
      throw new StepError(
        'missing',
        `Composant introuvable après ${swipes} défilement(s) vers ${variant.direction === 'up' ? 'le bas du contenu' : variant.direction === 'down' ? 'le haut du contenu' : 'le côté'}. Changez la direction ou le nombre maximum de défilements.`,
      );
    await swipe(ctx, variant, exec, route);
  }
}

/** Application lifecycle, deep links and system-level operations. */
async function deviceOperation(
  ctx: OperationContext,
  variant: Variant,
  exec: (r: string, m?: string, b?: unknown) => Promise<any>,
  route: string,
  signal?: AbortSignal,
) {
  const ios = ctx.platform === 'ios';
  const script = (name: string, args: Record<string, unknown> = {}) =>
    exec(route + '/execute/sync', 'POST', { script: name, args: [args] });
  const app = () => {
    // `value` may name another application (e.g. a companion app); empty = the project's own.
    const id = variant.value.trim() || ctx.application;
    if (!id)
      throw new StepError(
        'invalid',
        'Identifiant de l’application inconnu : renseignez-le dans les paramètres du projet (Applications).',
      );
    return ios ? { bundleId: id } : { appId: id };
  };
  switch (variant.operation) {
    case 'launch':
      return void (await script('mobile: activateApp', app()));
    case 'relaunch':
      await script('mobile: terminateApp', app());
      return void (await script('mobile: activateApp', app()));
    case 'terminate':
      return void (await script('mobile: terminateApp', app()));
    case 'background': {
      const seconds = Math.max(0, Math.min(Number(variant.value) || 2, 120));
      return void (await script('mobile: backgroundApp', { seconds }));
    }
    case 'deeplink': {
      if (!variant.value.trim())
        throw new StepError('invalid', 'Lien manquant (ex. monapp://commande/42).');
      const id = ctx.application;
      return void (await script('mobile: deepLink', {
        url: variant.value.trim(),
        ...(id ? (ios ? { bundleId: id } : { package: id }) : {}),
      }));
    }
    case 'orientation': {
      const want = /land/i.test(variant.value) ? 'LANDSCAPE' : 'PORTRAIT';
      return void (await exec(route + '/orientation', 'POST', { orientation: want }).catch(
        (error) => {
          if (/rotate/i.test(String(error?.message)))
            throw new StepError(
              'device',
              `Rotation vers ${want.toLowerCase()} refusée : l’application ne prend pas en charge cette orientation (ou l’appareil la verrouille).`,
            );
          throw error;
        },
      ));
    }
    case 'hidekeyboard':
      // No keyboard on screen is not an error: the goal "keyboard hidden" is already met.
      return void (await script('mobile: hideKeyboard').catch(() => {}));
    case 'alert': {
      const answer = variant.value.trim();
      const dismiss = /^(dismiss|refuser|annuler|cancel)$/i.test(answer);
      const label =
        answer && !/^(accept|accepter|dismiss|refuser|annuler|cancel)$/i.test(answer)
          ? answer
          : undefined;
      const deadline = Date.now() + variant.timeoutMs;
      for (let attempts = 0; ; attempts++) {
        signal?.throwIfAborted();
        try {
          if (ios)
            return void (await script('mobile: alert', {
              action: dismiss ? 'dismiss' : 'accept',
              ...(label ? { buttonLabel: label } : {}),
            }));
          return void (await script(dismiss ? 'mobile: dismissAlert' : 'mobile: acceptAlert', {
            ...(label ? { buttonLabel: label } : {}),
          }));
        } catch (error) {
          if (
            !/no such alert|no alert|alert.*not.*(present|found)/i.test(
              String((error as Error).message),
            )
          )
            throw error;
          if (Date.now() >= deadline)
            throw new StepError('missing', 'Aucune alerte ou fenêtre système affichée.');
          await delay(Math.min(400, 80 + attempts * 60), undefined, { signal });
        }
      }
    }
  }
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
  signal?: AbortSignal,
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
        actions:
          variant.operation === 'longpress'
            ? [
                { type: 'pointerMove', duration: 0, x, y },
                { type: 'pointerDown', button: 0 },
                {
                  type: 'pause',
                  duration: Math.max(200, Math.min(Number(variant.value) || 1000, 30000)),
                },
                { type: 'pointerUp', button: 0 },
              ]
            : variant.operation === 'doubletap'
              ? [
                  { type: 'pointerMove', duration: 0, x, y },
                  { type: 'pointerDown', button: 0 },
                  { type: 'pause', duration: 50 },
                  { type: 'pointerUp', button: 0 },
                  { type: 'pause', duration: 80 },
                  { type: 'pointerDown', button: 0 },
                  { type: 'pause', duration: 50 },
                  { type: 'pointerUp', button: 0 },
                ]
              : [
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
  await keyboardUp(exec, route, signal); // focus + keyboard animation: wait for it, never a blind sleep
  const script = ctx.platform === 'ios' ? 'mobile: keys' : 'mobile: type';
  const args = ctx.platform === 'ios' ? [{ keys: [...variant.value] }] : [{ text: variant.value }];
  // The value is typed once: never retried, an error after submission cannot prove nothing was sent.
  await exec(route + '/execute/sync', 'POST', { script, args });
}

/**
 * Wait until the on-screen keyboard is shown (the field took the focus). Returns as soon as it is, after at most ~1.5 s:
 * some inputs (hardware keyboard, web fields) never show one, and typing then works anyway.
 */
async function keyboardUp(
  exec: (r: string, m?: string, b?: unknown) => Promise<any>,
  route: string,
  signal?: AbortSignal,
) {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    try {
      const shown = await exec(route + '/execute/sync', 'POST', {
        script: 'mobile: isKeyboardShown',
        args: [{}],
      });
      if (shown) return;
    } catch {
      return delay(350, undefined, { signal }); // the driver cannot tell: keep the old behaviour
    }
    await delay(60, undefined, { signal });
  }
}
