import type { Screen } from '../../../shared/domain/devices.js';
import type { Project } from '../../../shared/domain/project.js';
import {
  OS_LIST,
  appendChildren,
  flatten,
  makeNode,
  makeVariant,
  newId,
  nodeSchema,
  validateTree,
  type Locator,
  type OS,
  type ScenarioNode,
  type ScreenDefinition,
  type Variant,
} from '../../../shared/domain/scenario.js';
import {
  deriveScreenDefinition,
  identifyScreen,
  isUnstableLabel,
  observedDefinition,
  screenDefinitions,
  validateScreenDefinitions,
} from '../../../shared/domain/screens.js';
import type { Translate } from '../i18n.js';

export const locKey = (l?: Locator) => (l ? `${l.using}\u0000${l.value}` : '');
export interface ExecutedAction {
  variant: Variant;
  before?: Screen;
  /** Screen observed right after the action: may be a transient state (loading…). */
  after: Screen;
  /** Last screen observed before the next action: the real destination once the app has settled. */
  settled?: Screen;
}
export const destinationOf = (a: ExecutedAction) => a.settled ?? a.after;

/** Selectors visible on most observed screens of an OS: they describe the app, not a screen. */
export function commonSelectors(facts: Facts, os: OS): Set<string> {
  const screens = facts.observations.get(os) ?? [];
  if (screens.length < 3) return new Set();
  const counts = new Map<string, number>();
  for (const s of screens)
    for (const k of new Set(s.components.flatMap((c) => (c.locator ? [locKey(c.locator)] : []))))
      counts.set(k, (counts.get(k) ?? 0) + 1);
  return new Set([...counts].filter(([, n]) => n / screens.length >= 0.6).map(([k]) => k));
}
/** What the exploration actually observed and executed: the only ground truth a proposal may rely on. */
export interface Facts {
  deviceByOs: Map<OS, string>;
  observations: Map<OS, Screen[]>;
  seen: Map<OS, Set<string>>;
  executed: Map<string, ExecutedAction[]>;
}
export const newFacts = (): Facts => ({
  deviceByOs: new Map(),
  observations: new Map(),
  seen: new Map(),
  executed: new Map(),
});
export function recordObservation(facts: Facts, os: OS, screen: Screen) {
  facts.observations.set(os, [...(facts.observations.get(os) ?? []), screen]);
  const catalog = facts.seen.get(os) ?? new Set<string>();
  for (const c of screen.components) if (c.locator) catalog.add(locKey(c.locator));
  facts.seen.set(os, catalog);
}

/**
 * Models often copy a selector slightly wrong (wrong strategy, label instead of id, hand-written XPath).
 * Map it back to the selector that was really observed, when that is unambiguous.
 */
export function resolveLocator(facts: Facts, os: OS, locator: Locator): Locator | undefined {
  if (facts.seen.get(os)?.has(locKey(locator))) return locator;
  const components = (facts.observations.get(os) ?? [])
    .flatMap((s) => s.components)
    .filter((c) => c.locator);
  const unique = (list: typeof components) => [
    ...new Map(list.map((c) => [locKey(c.locator), c.locator!])).values(),
  ];
  const norm = (v: string) => v.trim().toLowerCase();
  const candidates = [locator.value];
  const attribute = locator.value.match(
    /@(?:name|label|value|text|resource-id|content-desc)\s*(?:=|,)\s*['"]([^'"]+)['"]/,
  );
  if (attribute) candidates.push(attribute[1]);
  for (const value of candidates) {
    const byValue = unique(components.filter((c) => c.locator!.value === value));
    if (byValue.length === 1) return byValue[0];
    const byLabel = components.filter(
      (c) => norm(c.label) === norm(value) || norm(c.text) === norm(value),
    );
    if (unique(byLabel).length === 1) return unique(byLabel)[0];
    // The same label often appears on a cell and its inner text: the tappable one is the intended target.
    const tappable = unique(byLabel.filter((c) => c.interactive));
    if (tappable.length === 1) return tappable[0];
    // Multi-line labels (title + subtitle): accept a unique component whose label contains the proposed text.
    if (norm(value).length >= 3) {
      const partial = unique(
        components.filter(
          (c) => norm(c.label).includes(norm(value)) || norm(c.text).includes(norm(value)),
        ),
      );
      if (partial.length === 1) {
        const text = value.split('\n')[0].trim();
        // The full label may embed dynamic text (a date, a counter): select on the stable part only.
        const screens = facts.observations.get(os) ?? [];
        const ambiguous = screens.some(
          (sc) =>
            sc.components.filter(
              (c) => norm(c.label).includes(norm(text)) || norm(c.text).includes(norm(text)),
            ).length > 1,
        );
        if (
          !ambiguous &&
          !text.includes("'") &&
          (components.find((c) => locKey(c.locator) === locKey(partial[0]))?.label ?? '')
            .trim()
            .split('\n').length > 1
        )
          return {
            using: 'xpath',
            value:
              os === 'ios'
                ? `//*[contains(@name,'${text}') or contains(@label,'${text}')]`
                : `//*[contains(@text,'${text}') or contains(@content-desc,'${text}')]`,
          };
        return partial[0];
      }
    }
    const quoted = unique(
      components.filter(
        (c) =>
          c.locator!.using === 'xpath' &&
          (c.locator!.value.includes(`'${value}'`) || c.locator!.value.includes(`"${value}"`)),
      ),
    );
    if (quoted.length === 1) return quoted[0];
  }
  return undefined;
}

const LOCATORLESS = new Set(['back', 'swipe', 'wait']);
const EXECUTABLE = new Set(['tap', 'type', 'clear', 'back', 'swipe']);

export interface RepairResult {
  nodes: ScenarioNode[];
  warnings: string[];
  errors: string[];
}

/**
 * Deterministic clean-up of what the model proposed. Anything that cannot be grounded in the
 * observed trace is removed WITH a warning instead of failing the whole proposal; what can be
 * derived (ids, screen identities, locators from the trace) is fixed silently.
 */
export function repairProposal(
  raw: unknown[],
  project: Project,
  parentId: string | null,
  facts: Facts,
  t: Translate,
): RepairResult {
  const warnings: string[] = [];
  const warn = (m: string) => warnings.includes(m) || warnings.push(m);
  let nodes: ScenarioNode[] = [];
  raw.forEach((r, i) => {
    const parsed = nodeSchema.safeParse(r);
    if (parsed.success) nodes.push(parsed.data);
    else
      warn(
        t(
          `Élément ${i + 1} ignoré : structure invalide.`,
          `Item ${i + 1} ignored: invalid structure.`,
        ),
      );
  });

  // Shape: scenarios at the root, steps under an existing parent.
  nodes = parentId
    ? nodes.flatMap((n) => (n.kind === 'scenario' ? n.children : [n]))
    : nodes.map((n) =>
        n.kind === 'scenario' ? n : { ...makeNode('scenario', n.name, []), children: [n] },
      );

  // Fresh ids everywhere (no collision with the project, ever); preconditions are remapped.
  const ids = new Map<string, string>();
  const reid = (list: ScenarioNode[]): ScenarioNode[] =>
    list.map((n) => {
      const id = newId();
      ids.set(n.id, id);
      return { ...n, id, children: reid(n.children) };
    });
  nodes = reid(nodes);
  const remap = (list: ScenarioNode[]): ScenarioNode[] =>
    list.map((n) => ({
      ...n,
      preconditionId: n.preconditionId ? (ids.get(n.preconditionId) ?? null) : null,
      children: remap(n.children),
    }));
  nodes = remap(nodes);

  const known = screenDefinitions(project.nodes);
  const created: ScenarioNode[] = [];
  const cursor = new Map<OS, number>();

  const fixVariants = (node: ScenarioNode) => {
    const matched = new Map<OS, ExecutedAction>();
    for (const os of OS_LIST) {
      let v = node.variants[os];
      if (!v) continue;
      if (!facts.deviceByOs.has(os)) {
        delete node.variants[os];
        warn(
          t(
            `Variante ${os} retirée de « ${node.name} » : OS non exploré pendant cette session.`,
            `${os} variant removed from “${node.name}”: OS not explored in this session.`,
          ),
        );
        continue;
      }
      if (node.kind === 'test') v = { ...v, operation: 'assert' };
      else if (v.operation === 'assert') v = { ...v, operation: 'tap' };
      const executable = node.kind !== 'test' && EXECUTABLE.has(v.operation);
      if (!LOCATORLESS.has(v.operation)) {
        const candidates = [
          ...new Map(
            [v.locator, ...v.fallbacks].flatMap((l) => {
              const r = l && resolveLocator(facts, os, l);
              return r ? [[locKey(r), r] as const] : [];
            }),
          ).values(),
        ];
        // An executed interaction is grounded by the trace itself: its (possibly mis-copied) selector is replaced below.
        if (!candidates.length && executable) {
          /* keep going: aligned with the trace */
        } else if (!candidates.length) {
          delete node.variants[os];
          warn(
            t(
              `Variante ${os} retirée de « ${node.name} » : sélecteur non observé.`,
              `${os} variant removed from “${node.name}”: selector never observed.`,
            ),
          );
          continue;
        } else v = { ...v, locator: candidates[0], fallbacks: candidates.slice(1) };
      } else v = { ...v, locator: undefined, fallbacks: [] };
      if (node.kind !== 'test' && EXECUTABLE.has(v.operation)) {
        const list = facts.executed.get(facts.deviceByOs.get(os)!) ?? [];
        const from = cursor.get(os) ?? 0;
        const same = (a: Variant, strict: boolean) =>
          a.operation === v!.operation &&
          locKey(a.locator) === locKey(v!.locator) &&
          (!strict || a.value === v!.value);
        let idx = list.findIndex((a, i) => i >= from && same(a.variant, true));
        if (idx < 0) idx = list.findIndex((a, i) => i >= from && same(a.variant, false));
        if (idx < 0 && v.operation === 'type')
          idx = list.findIndex(
            (a, i) => i >= from && a.variant.operation === 'type' && a.variant.value === v!.value,
          );
        if (idx < 0 && v.operation !== 'type') {
          // The model's order follows what it did: align by order when the selector text drifted.
          idx = list.findIndex((a, i) => i >= from && a.variant.operation === v!.operation);
          if (idx >= 0)
            warn(
              t(
                `« ${node.name} » (${os}) : aligné sur l’interaction exécutée correspondante.`,
                `“${node.name}” (${os}): aligned with the matching executed interaction.`,
              ),
            );
        }
        if (idx < 0) {
          delete node.variants[os];
          warn(
            t(
              `Variante ${os} retirée de « ${node.name} » : interaction absente de la trace réussie.`,
              `${os} variant removed from “${node.name}”: interaction missing from the successful trace.`,
            ),
          );
          continue;
        }
        v = { ...list[idx].variant, hint: v.hint, timeoutMs: v.timeoutMs, fallbacks: v.fallbacks };
        cursor.set(os, idx + 1);
        matched.set(os, list[idx]);
      }
      node.variants[os] = v;
    }
    return matched;
  };

  const fixScreen = (node: ScenarioNode, matched: Map<OS, ExecutedAction>) => {
    let screen: ScreenDefinition | undefined = node.screen
      ? structuredClone(node.screen)
      : undefined;
    for (const os of OS_LIST) {
      if (!node.variants[os]) continue;
      // Keep the model's markers when they can be mapped to selectors that really co-occur on an observed screen.
      if (screen?.variants[os]) {
        const mapped = [
          ...new Map(
            screen.variants[os]!.markers.flatMap((m) => {
              const r = resolveLocator(facts, os, m);
              return r && !isUnstableLabel(r.value) ? [[locKey(r), r] as const] : [];
            }),
          ).values(),
        ];
        const candidate = {
          ...screen,
          variants: { ...screen.variants, [os]: { markers: mapped } },
        };
        if (
          mapped.length &&
          facts.observations.get(os)?.some((s) => observedDefinition(candidate, s, os))
        ) {
          screen = candidate;
          continue;
        }
        delete screen.variants[os];
        warn(
          t(
            `Repères d’écran ${os} de « ${node.name} » non observés : recalculés.`,
            `${os} screen markers of “${node.name}” never observed: recomputed.`,
          ),
        );
      }
      const executed = matched.get(os);
      const after = executed && destinationOf(executed);
      if (!after) continue;
      const existing = identifyScreen(after, os, [...project.nodes, ...created]);
      const reuse = existing.identified ? known.get(existing.id) : undefined;
      if (reuse?.variants[os])
        screen = {
          id: reuse.id,
          name: reuse.name,
          variants: { ...screen?.variants, [os]: reuse.variants[os] },
        };
      else {
        const derived = deriveScreenDefinition(
          after,
          os,
          screen?.name ?? node.name,
          screen?.id,
          commonSelectors(facts, os),
        );
        if (derived)
          screen = {
            id: screen?.id ?? derived.id,
            name: screen?.name ?? derived.name,
            variants: { ...screen?.variants, ...derived.variants },
          };
      }
    }
    if (!screen || !Object.keys(screen.variants).length) {
      node.kind = 'action';
      delete node.screen;
      warn(
        t(
          `« ${node.name} » : écran de destination non identifiable, converti en action.`,
          `“${node.name}”: destination screen not identifiable, converted to an action.`,
        ),
      );
      return;
    }
    const clash = known.get(screen.id);
    if (
      clash &&
      OS_LIST.some(
        (os) =>
          clash.variants[os] &&
          screen!.variants[os] &&
          JSON.stringify(clash.variants[os]) !== JSON.stringify(screen!.variants[os]),
      )
    ) {
      screen = { ...screen, id: `${screen.id}-${newId().slice(0, 4)}` };
      warn(
        t(
          `Écran « ${screen.name} » : identifiant déjà utilisé avec d’autres repères, dupliqué sous un nouvel id.`,
          `Screen “${screen.name}”: id already used with other markers, duplicated under a new id.`,
        ),
      );
    }
    node.screen = screen;
    known.set(screen.id, {
      ...known.get(screen.id),
      ...screen,
      variants: { ...known.get(screen.id)?.variants, ...screen.variants },
    });
  };

  const walk = (list: ScenarioNode[]): ScenarioNode[] => {
    const out: ScenarioNode[] = [];
    for (const original of list) {
      const node: ScenarioNode = {
        ...original,
        name: original.name.slice(0, 180),
        variants: { ...original.variants },
      };
      if (
        node.startScreen &&
        !OS_LIST.every(
          (os) =>
            !node.startScreen!.variants[os] ||
            facts.observations.get(os)?.some((s) => observedDefinition(node.startScreen!, s, os)),
        )
      ) {
        delete node.startScreen;
        warn(
          t(
            `Écran de départ de « ${node.name} » non observé : retiré.`,
            `Start screen of “${node.name}” never observed: removed.`,
          ),
        );
      }
      const matched = node.kind === 'scenario' ? new Map<OS, ExecutedAction>() : fixVariants(node);
      if (node.kind === 'navigation') fixScreen(node, matched);
      else if (node.screen) delete node.screen;
      node.children = walk(node.children);
      if (node.kind === 'scenario') {
        if (!node.children.length) {
          warn(
            t(
              `Scénario « ${node.name} » vide : retiré.`,
              `Scenario “${node.name}” is empty: removed.`,
            ),
          );
          continue;
        }
        created.push(node);
      } else if (!OS_LIST.some((os) => node.variants[os])) {
        warn(
          t(
            `« ${node.name} » retiré : aucune variante vérifiable.`,
            `“${node.name}” removed: no verifiable variant.`,
          ),
        );
        out.push(...node.children);
        continue;
      } else created.push(node);
      out.push(node);
    }
    return out.map((n, i) => {
      if (
        n.preconditionId &&
        !(i > 0 && out[i - 1].kind === 'test' && out[i - 1].id === n.preconditionId)
      ) {
        warn(
          t(
            `Précondition invalide sur « ${n.name} » : retirée.`,
            `Invalid precondition on “${n.name}”: removed.`,
          ),
        );
        return { ...n, preconditionId: null };
      }
      return n;
    });
  };
  nodes = walk(nodes);

  const errors: string[] = [];
  try {
    const combined = parentId
      ? appendChildren(project.nodes, parentId, nodes)
      : [...project.nodes, ...nodes];
    validateTree(combined);
    validateScreenDefinitions(combined);
  } catch (e) {
    errors.push(String((e as Error).message));
  }
  return { nodes, warnings, errors };
}

/**
 * Last resort when the model cannot deliver a valid proposal: rebuild a scenario from what was really
 * executed. The result is flagged as a draft so the user reviews it with that in mind.
 */
export function draftFromTrace(
  request: string,
  project: Project,
  facts: Facts,
  t: Translate,
): ScenarioNode[] {
  const root = makeNode(
    'scenario',
    t('Brouillon · ', 'Draft · ') + request.replace(/\s+/g, ' ').slice(0, 60),
    [],
  );
  root.description = t(
    'Brouillon reconstruit automatiquement à partir des interactions exécutées. À relire et compléter par des vérifications.',
    'Draft rebuilt from the interactions actually executed. Review it and add checks.',
  );
  const identities = [...project.nodes];
  for (const os of OS_LIST) {
    const device = facts.deviceByOs.get(os);
    if (!device) continue;
    const executed = facts.executed.get(device) ?? [];
    executed.forEach((action, i) => {
      const before = action.before && identifyScreen(action.before, os, identities);
      const destination = destinationOf(action);
      const afterId = identifyScreen(destination, os, identities);
      const changed = !before || before.id !== afterId.id;
      const node = makeNode(
        changed && action.variant.operation === 'tap' ? 'navigation' : 'action',
        `${action.variant.hint || action.variant.operation} (${os}) #${i + 1}`,
        [],
      );
      node.platforms = [os];
      node.variants[os] = { ...action.variant };
      if (node.kind === 'navigation') {
        const def = deriveScreenDefinition(
          destination,
          os,
          afterId.identified ? afterId.name : `${t('Écran', 'Screen')} ${root.children.length + 1}`,
        );
        if (def) node.screen = def;
        else node.kind = 'action';
      }
      root.children.push(node);
    });
    const last = executed.at(-1)?.after ?? facts.observations.get(os)?.at(-1);
    const marker = last && deriveScreenDefinition(last, os, 'final')?.variants[os]?.markers[0];
    if (marker) {
      const test = makeNode(
        'test',
        t(`Vérifier l’écran final (${os})`, `Check final screen (${os})`),
        [],
      );
      test.platforms = [os];
      test.variants[os] = makeVariant({
        operation: 'assert',
        assertion: 'visible',
        locator: marker,
        hint: t('Repère de l’écran final', 'Final screen marker'),
      });
      root.children.push(test);
    }
  }
  return root.children.length ? [root] : [];
}

export const countSteps = (nodes: ScenarioNode[]) =>
  flatten(nodes).filter((n) => n.kind !== 'scenario').length;
