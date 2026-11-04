import { screenFingerprint, type Component, type Screen } from '../../../shared/domain/devices.js';
import type { RecordedStep } from '../../../shared/domain/recording.js';
import type { Locator, OS, ScenarioNode } from '../../../shared/domain/scenario.js';
import {
  deriveMarkers,
  deriveScreenDefinition,
  identifyScreen,
} from '../../../shared/domain/screens.js';
import type { Translate } from '../i18n.js';

const INPUT = /TextField|TextView|SearchField|EditText|SecureText/i;
const key = (l?: Locator) => (l ? l.using + '\u0000' + l.value : '');
const label = (c: Component) => (c.label || c.text || c.type).replace(/\s+/g, ' ').slice(0, 80);

export type Inferred = Omit<RecordedStep, 'id' | 'at' | 'deviceId' | 'platform'>;

/** Share of locators present in both screens: below ~0.6 the user landed on another screen. */
export function similarity(a: Screen, b: Screen) {
  const x = new Set(a.components.map((c) => key(c.locator)).filter(Boolean));
  const y = new Set(b.components.map((c) => key(c.locator)).filter(Boolean));
  if (!x.size && !y.size) return 1;
  let shared = 0;
  for (const k of x) if (y.has(k)) shared++;
  return shared / (x.size + y.size - shared);
}

/**
 * Guess the user action that turned `before` into `after`. Pure and deterministic; ambiguous
 * taps are returned with candidates so the UI (or the AI) can settle them.
 */
export function inferStep(
  before: Screen,
  after: Screen,
  os: OS,
  nodes: ScenarioNode[],
  t: Translate,
  history: Screen[] = [],
): Inferred | null {
  if (screenFingerprint(before) === screenFingerprint(after)) return null;
  const withLocator = (s: Screen) => s.components.filter((c) => c.locator);
  const afterKeys = new Map(withLocator(after).map((c) => [key(c.locator), c]));
  const beforeUnique = withLocator(before).filter(
    (c) => withLocator(before).filter((o) => key(o.locator) === key(c.locator)).length === 1,
  );

  // 1. Typing: same field, different text.
  for (const c of beforeUnique) {
    const now = afterKeys.get(key(c.locator));
    if (
      now &&
      INPUT.test(c.type) &&
      !c.password &&
      now.text !== c.text &&
      now.text &&
      now.text !== now.label
    ) {
      return {
        operation: 'type',
        name: t(
          `Saisir « ${now.text.slice(0, 30)} » dans ${label(c)}`,
          `Type “${now.text.slice(0, 30)}” in ${label(c)}`,
        ),
        locator: c.locator,
        hint: label(c),
        value: now.text,
        secure: false,
        source: 'diff',
        confidence: 'high',
      };
    }
  }

  // 2. Tap: score the tappable components of the BEFORE screen.
  const moved = similarity(before, after) < 0.6;
  const scored = beforeUnique
    .filter((c) => c.enabled && !INPUT.test(c.type) && (c.interactive || c.label || c.text))
    .map((c) => {
      const now = afterKeys.get(key(c.locator));
      let score = 0;
      if (!now) score += 4;
      if (now && !c.selected && now.selected) score += 5;
      if (c.interactive) score += 2;
      if (moved && !now) score += 1;
      if (label(c) && !after.components.some((o) => o.label === c.label || o.text === c.text))
        score += 1;
      return { c, score };
    })
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score);

  // 3. Back: we returned to the screen seen two steps ago and nothing explains a tap.
  const previous = history.at(-2);
  if (previous && similarity(previous, after) > 0.9 && (!scored.length || scored[0].score < 6))
    return {
      operation: 'back',
      name: t('Revenir en arrière', 'Go back'),
      hint: t('Retour', 'Back'),
      value: '',
      secure: false,
      source: 'diff',
      confidence: 'medium',
    };
  if (!scored.length) return null;

  const [best, second] = scored;
  const ambiguous = !!second && second.score >= best.score;
  let destination: Inferred['destination'];
  let assertion: Inferred['assertion'];
  if (moved) {
    const known = identifyScreen(after, os, nodes);
    destination = known.identified
      ? undefined // identity already defined in the project: the mapping step reuses it
      : deriveScreenDefinition(after, os, t('Écran', 'Screen') + ' ' + label(best.c));
    const marker = deriveMarkers(after, 1)[0];
    const markerComponent = after.components.find((c) => key(c.locator) === key(marker));
    if (marker && markerComponent) assertion = { locator: marker, hint: label(markerComponent) };
  }
  return {
    operation: 'tap',
    name: t(`Appuyer sur « ${label(best.c)} »`, `Tap “${label(best.c)}”`),
    locator: best.c.locator,
    hint: label(best.c),
    value: '',
    secure: false,
    destination,
    assertion,
    source: 'diff',
    confidence: ambiguous ? 'low' : best.score >= 6 ? 'high' : 'medium',
    candidates: ambiguous
      ? scored.slice(0, 5).map(({ c }) => ({ locator: c.locator!, hint: label(c) }))
      : undefined,
  };
}
