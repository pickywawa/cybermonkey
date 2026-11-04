import { compactScreen, type Screen } from '../../../shared/domain/devices.js';
import type { InterruptionEvent } from '../../../shared/domain/report.js';
import { makeVariant, type OS, type ScenarioNode } from '../../../shared/domain/scenario.js';
import { observedDefinition } from '../../../shared/domain/screens.js';
import type { Settings } from '../../../shared/domain/settings.js';
import type { DeviceContext } from '../device-context.js';
import type { Translate } from '../i18n.js';

/* ---------- system and in-app dialogs ---------- */

/** Buttons a test must never press on its own initiative. */
const DESTRUCTIVE =
  /(supprim|effac|delete|erase|remove|retir|d[ée]connect|log ?out|sign ?out|r[ée]initialis|reset|achet|buy|purchase|pay|abonn|subscribe|quitter|quit|renouvel)/i;
const PERMISSION_WHO =
  /(souhaite|voudrait|veut|would like|wants? to|demande l.acc[èe]s|requests? access|acc[èe]der|access)/i;
const PERMISSION_WHAT =
  /(notification|localisation|location|position|cam[ée]ra|camera|micro|photo|contact|bluetooth|calendrier|calendar|rappel|reminder|suivre|track|face ?id|reconnaissance|speech|r[ée]seau local|local network)/i;
const ALLOW =
  /^(autoriser pendant|allow while|allow|autoriser|oui|yes|ok|continuer|continue|accepter|accept)/i;
const NOT_TRACK = /(not to track|ne pas suivre)/i;
const NEUTRAL =
  /^(ok|fermer|close|compris|got it|plus tard|later|pas maintenant|not now|annuler|cancel|non merci|no thanks|dismiss|continuer|continue)$/i;

export type AlertChoice = { press: string } | { press?: undefined; unknown: true };
/**
 * What to press on a dialog that is in the way, decided without the AI whenever it is obvious: permission requests are
 * allowed (the flow needs them), tracking is declined, a single harmless button is pressed, and anything that deletes,
 * logs out or pays is never touched. Anything else is left to the AI (or to nobody).
 */
export function decideAlert(text: string, buttons: string[]): AlertChoice {
  const safe = buttons.filter((b) => !DESTRUCTIVE.test(b));
  const permission = PERMISSION_WHO.test(text) && PERMISSION_WHAT.test(text);
  if (permission) {
    const decline = safe.find((b) => NOT_TRACK.test(b));
    if (decline && /(track|suivre)/i.test(text)) return { press: decline };
    const allow = safe.find((b) => ALLOW.test(b.trim()));
    if (allow) return { press: allow };
    // buttons unknown (Android): the plain "accept" of the driver
    if (!buttons.length) return { press: 'accept' };
  }
  if (buttons.length === 1 && safe.length === 1) return { press: safe[0] };
  const neutral = safe.find((b) => NEUTRAL.test(b.trim()));
  if (neutral) return { press: neutral };
  return { unknown: true };
}

/* ---------- AI advisor ---------- */

export interface InterruptionAdvice {
  kind: string;
  componentId: string | null;
  handler: string | null;
  summary: string;
}
export interface InterruptionAdvisor {
  /** Which button to press on a dialog the heuristics cannot decide; null = leave it. */
  alertButton(input: {
    text: string;
    buttons: string[];
    step: string;
    signal: AbortSignal;
  }): Promise<string | null>;
  /** What the screen in the way is, and how to get past it. */
  interruption(input: {
    step: string;
    description: string;
    error: string;
    screen: Screen;
    handlers: { name: string; description: string }[];
    signal: AbortSignal;
  }): Promise<InterruptionAdvice | null>;
}

/**
 * Answer the dialog blocking the screen, if there is one: obvious cases by rule, unclear ones by the AI, risky buttons
 * never. Returns what was done, or undefined when no dialog is showing.
 */
export async function answerBlockingAlert(
  ctx: Pick<DeviceContext, 'perform' | 'alertInfo'>,
  options: {
    advisor?: InterruptionAdvisor;
    step: string;
    signal: AbortSignal;
    t: Translate;
    /** Shared counter so a dialog that keeps coming back cannot cost unlimited AI calls. */
    allowAi?: () => boolean;
  },
): Promise<InterruptionEvent | undefined> {
  const info = await ctx.alertInfo();
  if (!info) return undefined;
  let press = decideAlert(info.text, info.buttons).press;
  if (!press && options.advisor && (options.allowAi?.() ?? true)) {
    const label = await options.advisor
      .alertButton({
        text: info.text,
        buttons: info.buttons,
        step: options.step,
        signal: options.signal,
      })
      .catch(() => null);
    if (label && !DESTRUCTIVE.test(label) && info.buttons.includes(label)) press = label;
  }
  const name = info.text.replace(/\s+/g, ' ').slice(0, 160);
  if (!press)
    return {
      kind: 'system-alert',
      name,
      detail: options.t('aucun bouton sans risque : laissé tel quel', 'no safe button: left alone'),
      ok: false,
    };
  try {
    await ctx.perform(makeVariant({ operation: 'alert', value: press, timeoutMs: 3000 }), 'action');
    return { kind: 'system-alert', name, detail: press, ok: true };
  } catch (error) {
    return { kind: 'system-alert', name, detail: String(error), ok: false };
  }
}

/* ---------- the guard ---------- */

const MAX_CHAIN = 3;
const MAX_AI_PER_RUN = 6;
/** Errors that say "the thing I wanted is not there / not as expected": the only ones an interruption can explain. */
const LOOKS_BLOCKED =
  /introuvable|not found|non confirm|not confirmed|ambigu|non visible|not visible|Aucune alerte|modal|alert/i;

export interface Failure {
  step: string;
  description: string;
  error: string;
  operation: string;
}
export interface GuardResult {
  events: InterruptionEvent[];
  resume: 'retry' | 'return';
  /** Every action taken worked: replaying the step is worth it. */
  handled: boolean;
}
export interface GuardDeps {
  ctx: Pick<DeviceContext, 'perform' | 'inspect' | 'appState' | 'alertInfo' | 'ensureApplication'>;
  os: OS;
  application?: string;
  /** Scenarios that are interruption handlers, in project order. */
  handlers: () => ScenarioNode[];
  mode: () => Settings['interruptionMode'];
  advisor?: InterruptionAdvisor;
  /** Plays a handler scenario; true when it completed. */
  runHandler: (handler: ScenarioNode) => Promise<boolean>;
  /** After the app was started again: let it settle before going on. */
  afterRelaunch?: () => Promise<void>;
  signal: AbortSignal;
  t: Translate;
}

/**
 * Deals with whatever got in the way of a failed step, in this order: the app is gone (crash, closed) → a dialog blocks
 * the screen → one of the project's interruption handlers recognises the screen → the AI, as a last resort, closes an
 * unexpected popup. Several can follow one another (popup → login screen → log in again); the caller then replays the step.
 */
export class InterruptionGuard {
  private uses = new Map<string, number>();
  private aiCalls = 0;
  constructor(private d: GuardDeps) {}

  async handle(failure: Failure): Promise<GuardResult | undefined> {
    if (this.d.mode() === 'off') return undefined;
    const events: InterruptionEvent[] = [];
    let resume: 'retry' | 'return' = 'retry';
    for (let round = 0; round < MAX_CHAIN; round++) {
      this.d.signal.throwIfAborted();
      const found = await this.once(failure, round);
      if (!found) break;
      events.push(found.event);
      if (found.resume === 'return') resume = 'return';
      if (!found.event.ok) break;
    }
    if (!events.length) return undefined;
    return { events, resume, handled: events.every((e) => e.ok) };
  }

  private async once(
    f: Failure,
    round: number,
  ): Promise<{ event: InterruptionEvent; resume: 'retry' | 'return' } | undefined> {
    const { ctx, os, application, t, signal } = this.d;
    const smart = this.d.mode() === 'smart';
    // 1. the app is not on screen any more
    if (
      round === 0 &&
      application &&
      !['background', 'terminate', 'launch', 'relaunch'].includes(f.operation)
    ) {
      const state = await ctx.appState(application);
      if (state !== undefined && state !== 4) {
        try {
          await ctx.ensureApplication(application, false);
          await this.d.afterRelaunch?.();
          return {
            event: {
              kind: 'app-gone',
              name: t(
                'L’app n’était plus au premier plan (fermée ou plantée) : relancée',
                'The app was no longer in the foreground (closed or crashed): relaunched',
              ),
              detail: 'state ' + state,
              ok: true,
            },
            resume: 'return',
          };
        } catch (error) {
          return {
            event: {
              kind: 'app-gone',
              name: t('Relance de l’app impossible', 'Could not relaunch the app'),
              detail: String(error),
              ok: false,
            },
            resume: 'return',
          };
        }
      }
    }
    // 2. a dialog is blocking
    if (smart) {
      const event = await answerBlockingAlert(ctx, {
        advisor: this.d.advisor,
        step: f.step,
        signal,
        t,
        allowAi: () => this.aiCalls < MAX_AI_PER_RUN && !!++this.aiCalls,
      });
      if (event) return { event, resume: 'retry' };
    }
    // 3. a known interruption
    const screen = await ctx.inspect().catch(() => undefined);
    if (!screen) return undefined;
    const handlers = this.d.handlers();
    const run = async (h: ScenarioNode, via = '') => {
      this.uses.set(h.id, (this.uses.get(h.id) ?? 0) + 1);
      const ok = await this.d.runHandler(h).catch(() => false);
      return {
        event: { kind: 'handler' as const, name: h.name, detail: via || undefined, ok },
        resume: h.handler!.resume,
      };
    };
    for (const h of handlers)
      if (
        (this.uses.get(h.id) ?? 0) < h.handler!.maxPerRun &&
        observedDefinition(h.handler!.when, screen, os)
      )
        return run(h);
    // 4. the AI, last: only when the failure looks like something is in the way
    if (smart && this.d.advisor && this.aiCalls < MAX_AI_PER_RUN && LOOKS_BLOCKED.test(f.error)) {
      this.aiCalls++;
      const advice = await this.d.advisor
        .interruption({
          step: f.step,
          description: f.description,
          error: f.error,
          screen,
          handlers: handlers.map((h) => ({ name: h.name, description: h.description })),
          signal,
        })
        .catch(() => null);
      if (!advice || advice.kind === 'unrelated') return undefined;
      const named = advice.handler && handlers.find((h) => h.name === advice.handler);
      if (named && (this.uses.get(named.id) ?? 0) < named.handler!.maxPerRun)
        return run(named, t('reconnu par l’IA : ', 'recognised by the AI: ') + advice.summary);
      const target = advice.componentId
        ? screen.components.find((c) => c.id === advice.componentId && c.locator)
        : undefined;
      if (target?.locator && !DESTRUCTIVE.test(`${target.label} ${target.text}`)) {
        try {
          await ctx.perform(
            makeVariant({
              operation: 'tap',
              locator: target.locator,
              hint: target.label,
              timeoutMs: 4000,
            }),
            'action',
          );
          return {
            event: {
              kind: 'ai-dismiss',
              name: advice.summary,
              detail: `${advice.kind} · ${target.label || target.text}`,
              ok: true,
            },
            resume: 'retry',
          };
        } catch (error) {
          return {
            event: { kind: 'ai-dismiss', name: advice.summary, detail: String(error), ok: false },
            resume: 'retry',
          };
        }
      }
    }
    return undefined;
  }
}

/** Compact description of a screen for prompts. */
export const describeScreen = (screen: Screen) => compactScreen(screen, 90);
