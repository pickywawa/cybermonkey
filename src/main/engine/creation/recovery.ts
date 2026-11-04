import { effectiveVariables } from '../../../shared/domain/project.js';
import { compactScreen } from '../../../shared/domain/devices.js';
import { decisionJsonSchema, parseDecision } from '../../../shared/ai/protocol.js';
import { PLACEHOLDER } from '../../../shared/domain/variables.js';
import {
  flatten,
  makeNode,
  newId,
  type ScenarioNode,
  type Variant,
} from '../../../shared/domain/scenario.js';
import { deriveMarkers, observedDefinition } from '../../../shared/domain/screens.js';
import type { Settings } from '../../../shared/domain/settings.js';
import type { LiveEvent } from '../../../shared/ipc.js';
import type { AiHub } from '../../infra/ai/hub.js';
import type { Automation } from '../../infra/appium/automation.js';
import type { WorkspaceStore } from '../../infra/storage/workspace-store.js';
import { RECOVERY_SYSTEM } from '../prompts.js';
import { targetReached, type StartRecovery } from '../execution/start-state.js';

/** Persist a discovered preparation route as a separate, reusable scenario (once, race-safe). */
export async function savePreparation(
  store: WorkspaceStore,
  live: (e: LiveEvent) => void,
  projectId: string,
  route: ScenarioNode,
  verified: boolean,
) {
  if (!route.children.some((n) => n.kind !== 'test')) return;
  if (!verified) route.description += ' Parcours incomplet : écran cible non confirmé.';
  for (let attempt = 0; ; attempt++) {
    const project = store.get(projectId);
    if (project.nodes.some((n) => n.id === route.id)) return;
    try {
      await store.update({
        id: project.id,
        nodes: [...project.nodes, route],
        expectedRevision: project.revision,
      });
      break;
    } catch (error) {
      if (
        attempt >= 2 ||
        !(error instanceof Error) ||
        !error.message.includes('Le projet a changé')
      )
        throw error;
    }
  }
  live({ type: 'workspace' });
}

/**
 * Execution-time recovery: when the app is not on the screen a test needs, an AI navigates back to it
 * using only non-destructive steps, and the discovered route is saved for the next run.
 */
export class StartRecoveryAgent {
  constructor(
    private deps: {
      store: WorkspaceStore;
      automation: Automation;
      hub: AiHub;
      settings: () => Settings;
      live: (e: LiveEvent) => void;
    },
  ) {}

  async recover(input: StartRecovery, execute: (node: ScenarioNode) => Promise<void>) {
    const { store, automation, hub, settings, live } = this.deps;
    const config = settings();
    const signal = AbortSignal.any([
      input.signal,
      AbortSignal.timeout(config.creationTimeoutMinutes * 60000),
    ]);
    const variables = () => effectiveVariables(store.get(input.projectId));
    const perform = (variant: Variant, kind: ScenarioNode['kind']) =>
      automation.perform(
        input.deviceId,
        variant,
        kind,
        input.owner,
        signal,
        variables(),
        false,
        store.get(input.projectId).applications?.[input.platform],
      );
    const reached = () => targetReached(input.target, perform, signal);
    const inspect = () => automation.inspect(input.deviceId, input.owner);
    const route = makeNode('scenario', ('Préparation · ' + input.target.name).slice(0, 180), []);
    route.preparation = true;
    route.description =
      'Parcours de préparation découvert pendant une exécution. Données de l’application conservées.';
    const assertion = (variant: Variant, name: string) => {
      const node = makeNode('test', name, [input.platform]);
      node.variants[input.platform] = { ...variant, timeoutMs: 10000 };
      node.blocking = true;
      return node;
    };
    let verified = false;
    try {
      let screen = await inspect();
      const initial = deriveMarkers(screen);
      if (initial.length)
        route.startScreen = {
          id: newId(),
          name: 'Départ de la préparation',
          variants: { [input.platform]: { markers: initial } },
        };
      for (const locator of initial)
        route.children.push(
          assertion(
            {
              locator,
              fallbacks: [],
              hint: '',
              operation: 'assert',
              assertion: 'visible',
              value: '',
              expected: '',
              direction: 'up',
              timeoutMs: 10000,
            },
            'Vérifier le départ de la préparation',
          ),
        );
      await hub.converse(RECOVERY_SYSTEM, signal, async (chat) => {
        let prompt =
          'RECOVERY ' +
          JSON.stringify({
            target: input.target,
            deviceId: input.deviceId,
            platform: input.platform,
            variableNames: Object.keys(variables()),
            screen: compactScreen(screen),
          });
        for (let i = 0; i < Math.min(config.creationMaxDecisions, 40); i++) {
          signal.throwIfAborted();
          if (await reached()) {
            verified = true;
            return;
          }
          const parsed = parseDecision(await chat.send(prompt, { schema: decisionJsonSchema }));
          if (!parsed.ok) {
            prompt = 'Invalid JSON decision (' + parsed.error + '). Reply with one JSON object.';
            continue;
          }
          const d = parsed.decision;
          if (d.tool === 'finish')
            throw new Error('Préparation IA arrêtée : ' + (d.summary || 'écran non retrouvé'));
          if (d.tool === 'inspect') screen = await inspect();
          else if (d.tool === 'perform') {
            if (d.deviceId !== input.deviceId) throw new Error('Appareil hors périmètre');
            const component = screen.components.find((c) => c.id === d.componentId);
            if (d.operation !== 'back' && d.operation !== 'swipe' && !component?.locator)
              throw new Error('Composant non observé');
            if (d.operation === 'type' && !PLACEHOLDER.test(d.value))
              throw new Error('La préparation utilise uniquement les variables projet existantes.');
            if (
              d.operation === 'type' &&
              route.children.some(
                (s) =>
                  s.variants[input.platform]?.operation === 'type' &&
                  s.variants[input.platform]?.value === d.value,
              )
            )
              throw new Error('Une saisie de connexion a déjà été tentée pendant la préparation.');
            const node = makeNode('action', 'Préparation · ' + d.operation, [input.platform]);
            node.blocking = true;
            node.variants[input.platform] = {
              locator:
                d.operation === 'back' || d.operation === 'swipe' ? undefined : component?.locator,
              fallbacks: [],
              hint: component?.label ?? '',
              operation: d.operation,
              value: d.operation === 'type' ? d.value : '',
              assertion: 'visible',
              expected: '',
              direction: d.direction,
              timeoutMs: 10000,
            };
            await execute(node); // the run executes and captures it once; a failure stops recovery
            route.children.push(node);
            screen = await inspect();
            const destination = deriveMarkers(screen);
            if (destination.length) {
              node.kind = 'navigation';
              const known = [...flatten(store.get(input.projectId).nodes), ...route.children]
                .flatMap((s) => (s.screen ? [s.screen] : []))
                .filter((def) => observedDefinition(def, screen, input.platform));
              const unique = [...new Map(known.map((def) => [def.id, def])).values()];
              node.screen =
                unique.length === 1
                  ? structuredClone(unique[0])
                  : {
                      id: newId(),
                      name: 'Écran de préparation ' + route.children.length,
                      variants: { [input.platform]: { markers: destination } },
                    };
            }
          } else throw new Error('Outil non autorisé pendant la préparation');
          prompt = 'NEW SCREEN ' + JSON.stringify(compactScreen(screen));
        }
      });
      verified ||= await reached();
      if (!verified)
        throw new Error('Limite de préparation atteinte sans retrouver l’écran de départ.');
      for (const check of input.target.checks)
        route.children.push(assertion(check, input.target.name));
    } finally {
      await savePreparation(store, live, input.projectId, route, verified);
    }
  }
}
