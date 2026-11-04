import type { Component, Screen } from './devices.js';
import {
  flatten,
  type Locator,
  type OS,
  type ScenarioNode,
  type ScreenDefinition,
} from './scenario.js';
import type { ScreenReference } from './report.js';

const same = (a?: Locator, b?: Locator) => !!a && !!b && a.using === b.using && a.value === b.value;
/** `//*[contains(@name,'Text') or …]` markers (stable part of a label) match components by their text. */
const CONTAINS = /contains\(@(?:name|label|value|text|content-desc)\s*,\s*'([^']+)'\)/;
const matches = (c: Component, l: Locator) => {
  if (same(c.locator, l)) return true;
  const text = l.using === 'xpath' ? CONTAINS.exec(l.value)?.[1] : undefined;
  if (!text) return false;
  const norm = (v: string) => v.trim().toLowerCase();
  return norm(c.label).includes(norm(text)) || norm(c.text).includes(norm(text));
};
const count = (screen: Screen, l: Locator) => screen.components.filter((c) => matches(c, l)).length;

/** A definition is observed when every marker matches exactly one component. */
export function observedDefinition(definition: ScreenDefinition, screen: Screen, platform: OS) {
  const all = definition.variants[platform]?.markers ?? [];
  // Markers saved earlier may embed instance counters (`platform_view[1]`): ignore them while a stable one remains.
  const stable = all.filter((m) => !isUnstableLabel(m.value));
  const markers = stable.length ? stable : all;
  return markers.length > 0 && markers.every((m) => count(screen, m) === 1);
}

export function screenDefinitions(nodes: ScenarioNode[]): Map<string, ScreenDefinition> {
  const map = new Map<string, ScreenDefinition>();
  for (const n of flatten(nodes)) {
    if (n.screen) map.set(n.screen.id, mergeDefinitions(map.get(n.screen.id), n.screen));
    if (n.startScreen && !map.has(n.startScreen.id)) map.set(n.startScreen.id, n.startScreen);
  }
  return map;
}
/** Same screen described on Android in one step and on iOS in another: merge both variants. */
function mergeDefinitions(a: ScreenDefinition | undefined, b: ScreenDefinition): ScreenDefinition {
  if (!a) return b;
  return { ...a, variants: { ...b.variants, ...a.variants } };
}

export function fingerprintHash(screen: Screen): string {
  const locators = screen.components
    .filter((c) => c.locator && !c.password)
    .map((c) => JSON.stringify(c.locator))
    .sort();
  let h = 5381;
  for (const ch of JSON.stringify(locators)) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

export function identifyScreen(
  screen: Screen,
  platform: OS,
  nodes: ScenarioNode[],
): ScreenReference {
  const matches = [...screenDefinitions(nodes).values()].filter((d) =>
    observedDefinition(d, screen, platform),
  );
  if (matches.length === 1)
    return { id: matches[0].id, name: matches[0].name, platform, identified: true };
  const hash = fingerprintHash(screen);
  return {
    id: 'observed-' + hash,
    name: matches.length > 1 ? 'Écran ambigu' : 'Écran non identifié · ' + hash.slice(0, 6),
    platform,
    identified: false,
  };
}

/** Pick up to `max` distinctive, unique, non-input components to identify a screen. */
/**
 * Labels that change between launches or runs (instance counters like `platform_view[1]`, scroll-bar descriptions,
 * bare numbers) cannot identify a screen.
 */
export const isUnstableLabel = (value: string) =>
  /\[\d+\]\s*$/.test(value) || /scroll ?bar/i.test(value) || /^[\d\s.,:/-]+$/.test(value.trim());
const unstable = (c: Component) =>
  isUnstableLabel(c.label) || (!!c.locator && isUnstableLabel(c.locator.value));

/** `exclude`: selectors present on most screens (app title, tab bar): they identify the app, not the screen. */
export function deriveMarkers(
  screen: Screen,
  max = 3,
  exclude: ReadonlySet<string> = new Set(),
): Locator[] {
  const key = (l: Locator) => l.using + '\u0000' + l.value;
  const unique = (c: Component) =>
    c.locator &&
    !c.password &&
    !unstable(c) &&
    !exclude.has(key(c.locator)) &&
    count(screen, c.locator) === 1;
  const textual = (c: Component) =>
    !/TextField|TextView|SearchField|EditText|SecureText/i.test(c.type);
  const candidates = screen.components.filter((c) => unique(c) && textual(c) && c.label);
  // Resource ids and accessibility ids are more stable than generated xpath on labels.
  const rank = (c: Component) => (c.locator!.using === 'xpath' ? 1 : 0);
  const android = screen.deviceId.startsWith('android:');
  const norm = (v: string) => v.trim().toLowerCase();
  /** Multi-line labels (title + dynamic subtitle such as a date): select on the stable first line only. */
  const stable = (c: Component): Locator => {
    const first = c.label.split('\n')[0].trim();
    const shared = screen.components.filter(
      (o) => norm(o.label).includes(norm(first)) || norm(o.text).includes(norm(first)),
    );
    if (c.label.includes('\n') && first.length >= 3 && !first.includes("'") && shared.length === 1)
      return {
        using: 'xpath',
        value: android
          ? `//*[contains(@text,'${first}') or contains(@content-desc,'${first}')]`
          : `//*[contains(@name,'${first}') or contains(@label,'${first}')]`,
      };
    return c.locator!;
  };
  return candidates
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, max)
    .map(stable);
}
export function deriveScreenDefinition(
  screen: Screen,
  platform: OS,
  name: string,
  id = 'screen-' + fingerprintHash(screen),
  exclude: ReadonlySet<string> = new Set(),
): ScreenDefinition | undefined {
  const markers = deriveMarkers(screen, 3, exclude);
  return markers.length ? { id, name, variants: { [platform]: { markers } } } : undefined;
}

export function validateScreenDefinitions(nodes: ScenarioNode[]) {
  const byId = new Map<string, ScreenDefinition>();
  const signatures = new Map<string, string>();
  for (const node of flatten(nodes)) {
    if (!node.screen) continue;
    if (node.kind !== 'navigation')
      throw new Error('Une identité d’écran doit être définie sur une navigation.');
    const old = byId.get(node.screen.id);
    // Android and iOS variants may be declared by different steps; only same-OS conflicts are errors.
    if (old)
      for (const os of ['android', 'ios'] as const) {
        const a = old.variants[os],
          b = node.screen.variants[os];
        if (a && b && JSON.stringify(a) !== JSON.stringify(b))
          throw new Error(
            'Définitions incompatibles pour l’écran ' + node.screen.id + ' (' + os + ')',
          );
      }
    byId.set(node.screen.id, mergeDefinitions(old, node.screen));
    for (const os of ['android', 'ios'] as const) {
      const markers = node.screen.variants[os]?.markers;
      if (!markers) continue;
      const signature =
        os +
        ':' +
        markers
          .map((m) => JSON.stringify(m))
          .sort()
          .join('|');
      if (signatures.has(signature) && signatures.get(signature) !== node.screen.id)
        throw new Error('Deux écrans partagent les mêmes marqueurs : ' + os);
      signatures.set(signature, node.screen.id);
    }
  }
}
