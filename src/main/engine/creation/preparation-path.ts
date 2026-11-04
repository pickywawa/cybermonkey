import type { Screen } from '../../../shared/domain/devices.js';
import { deriveMarkers, observedDefinition } from '../../../shared/domain/screens.js';
import {
  flatten,
  makeNode,
  newId,
  type OS,
  type ScenarioNode,
} from '../../../shared/domain/scenario.js';
import type { Locator } from '../../../shared/domain/scenario.js';

export function preparationCheck(locator: Locator, platform: OS, name: string) {
  const node = makeNode('test', name.slice(0, 180), [platform]);
  node.blocking = true;
  node.variants[platform]!.locator = locator;
  return node;
}
/** A separate "preparation" scenario recording how the start screen was reached during creation. */
export function preparationPath(screen: Screen, platform: OS, name: string) {
  const route = makeNode('scenario', ('Préparation · ' + name).slice(0, 180), []);
  route.preparation = true;
  route.description =
    'Parcours découvert pendant la création IA. Données de l’application conservées.';
  const markers = deriveMarkers(screen);
  if (markers.length)
    route.startScreen = {
      id: newId(),
      name: 'Départ de la préparation',
      variants: { [platform]: { markers } },
    };
  route.children = markers.map((locator) =>
    preparationCheck(locator, platform, 'Vérifier le départ de la préparation'),
  );
  return route;
}
export function recordPreparationDestination(
  node: ScenarioNode,
  screen: Screen,
  platform: OS,
  known: ScenarioNode[],
) {
  const markers = deriveMarkers(screen);
  if (!markers.length) return;
  const definitions = flatten(known)
    .flatMap((n) => (n.screen ? [n.screen] : []))
    .filter((d) => observedDefinition(d, screen, platform));
  const unique = [...new Map(definitions.map((d) => [d.id, d])).values()];
  if (unique.length > 1) return; // ambiguous identities must not spawn a competing screen
  node.kind = 'navigation';
  node.screen =
    unique.length === 1
      ? structuredClone(unique[0])
      : { id: newId(), name: 'Écran de préparation', variants: { [platform]: { markers } } };
}
