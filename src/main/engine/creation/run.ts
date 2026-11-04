import { z } from 'zod';
import { compactScreen, screenFingerprint, type Screen } from '../../../shared/domain/devices.js';
import { decisionJsonSchema, parseDecision, type Decision } from '../../../shared/ai/protocol.js';
import { activeOs, type Project } from '../../../shared/domain/project.js';
import {
  OS_LIST,
  flatten,
  makeNode,
  nodePath,
  type OS,
  type ScenarioNode,
  type Variant,
} from '../../../shared/domain/scenario.js';
import { identifyScreen } from '../../../shared/domain/screens.js';
import { sessionTitle } from '../../../shared/session-title.js';
import { PLACEHOLDER, variablesSchema } from '../../../shared/domain/variables.js';
import type { CreationReply, LiveEvent, ReplayResult } from '../../../shared/ipc.js';
import type { Settings } from '../../../shared/domain/settings.js';
import type { Conversation } from '../../infra/ai/provider.js';
import type { AiHub } from '../../infra/ai/hub.js';
import type { Automation } from '../../infra/appium/automation.js';
import type { Devices } from '../../infra/devices/scanner.js';
import type { WorkspaceStore } from '../../infra/storage/workspace-store.js';
import { deviceContext, type DeviceContext } from '../device-context.js';
import type { Translate } from '../i18n.js';
import { CREATION_SYSTEM } from '../prompts.js';
import { prepareStart, startingTarget } from '../execution/start-state.js';
import { waitForScreenDefinition } from '../execution/screen-wait.js';
import {
  preparationCheck,
  preparationPath,
  recordPreparationDestination,
} from './preparation-path.js';
import {
  draftFromTrace,
  newFacts,
  recordObservation,
  repairProposal,
  countSteps,
  type Facts,
} from './proposal.js';
import { savePreparation, type StartRecoveryAgent } from './recovery.js';
import { similarity } from '../recorder/inference.js';
import { replayProposal } from './replay.js';
import { TraceWriter } from './trace.js';
import { annotateGrid, cellToPoint, GRID_CELL_PT } from '../../infra/devices/grid.js';
import type { ImageInput } from '../../infra/ai/provider.js';

export interface CreationInput {
  projectId: string;
  prompt: string;
  sessionId?: string;
  nodeId?: string;
  deviceIds: string[];
}
export interface CreationDeps {
  store: WorkspaceStore;
  devices: Devices;
  automation: Automation;
  hub: AiHub;
  recovery: StartRecoveryAgent;
  settings: () => Settings;
  live: (event: LiveEvent) => void;
  t: Translate;
  ask: (
    projectId: string,
    questionId: string,
    question: string,
    variableName: string | undefined,
    signal: AbortSignal,
  ) => Promise<string>;
}
const REMINDER =
  '\nReply with ONE JSON host command (inspect, perform, prepare, ready, create_variable, question, finish). These are host commands, not native tools: never call shell/exec.';
const MAX_CORRECTIONS = 3;
const MAX_INVALID = 4;

/** One AI creation session: explore devices, then turn the observed trace into a reviewable proposal. */
export class CreationRun {
  private project!: Project;
  private facts: Facts = newFacts();
  private trace: TraceWriter;
  private screens = new Map<string, Screen>();
  private lastFingerprint = new Map<string, string>();
  private ctx = new Map<string, DeviceContext>();
  private prepRoutes = new Map<string, ScenarioNode>();
  private prepReplay = new Map<string, ScenarioNode[]>();
  private prepTried = new Set<string>();
  private prepFailed = new Set<string>();
  private failures = new Map<string, number>();
  private initial = new Map<string, Screen>();
  private chatSessionId: string | null = null;
  private owner: string;
  private softDeadline: number;
  private warnings: string[] = [];
  constructor(
    private deps: CreationDeps,
    private input: CreationInput,
    private signal: AbortSignal,
    deadline: number,
  ) {
    this.owner = 'ai:' + input.projectId;
    this.softDeadline = deadline;
    this.trace = new TraceWriter(() =>
      Object.values(deps.store.get(input.projectId).variables ?? {}).filter(Boolean),
    );
  }
  private get settings() {
    return this.deps.settings();
  }
  private get t() {
    return this.deps.t;
  }
  private variables = () => this.deps.store.get(this.input.projectId).variables ?? {};
  private say(message: string) {
    this.deps.live({ type: 'ai', projectId: this.input.projectId, message });
  }
  private osOf = (id: string) => this.deps.devices.known.get(id)!.platform;

  async execute(): Promise<CreationReply> {
    const { store, devices, automation, hub } = this.deps;
    this.project = structuredClone(store.get(this.input.projectId));
    await this.trace.open(this.project.directory);
    await this.trace.record({ type: 'start', devices: this.input.deviceIds });
    this.say(this.t('Préparation de l’exploration…', 'Preparing the exploration…'));
    this.chatSessionId = this.input.sessionId ?? this.project.activeChatSessionId;
    if (this.chatSessionId && !this.project.chatSessions.some((s) => s.id === this.chatSessionId))
      throw new Error('Session IA introuvable');
    const path = this.input.nodeId ? nodePath(this.project.nodes, this.input.nodeId) : [];
    if (this.input.nodeId && !path.length) throw new Error('Élément courant introuvable');

    // Devices: one per OS, ready, belonging to the project.
    const seen = new Set<OS>();
    for (const id of this.input.deviceIds) {
      const d = devices.known.get(id);
      if (!d || d.status !== 'ready')
        throw new Error(this.t('Appareil non connecté : ', 'Device not connected: ') + id);
      if (!this.project.platforms.includes(d.platform))
        throw new Error(
          this.t(
            `Le projet ne cible pas ${d.platform}.`,
            `The project does not target ${d.platform}.`,
          ),
        );
      if (seen.has(d.platform))
        throw new Error(this.t('Un seul appareil par OS.', 'One device per OS.'));
      seen.add(d.platform);
      this.facts.deviceByOs.set(d.platform, id);
      this.ctx.set(
        id,
        deviceContext(automation, devices, id, this.owner, this.signal, this.variables),
      );
    }
    automation.acquire(this.input.deviceIds, this.owner);
    try {
      // Bring the app up and capture the initial state; a device that fails is reported, not fatal.
      const failed: string[] = [];
      const phase = <T>(id: string, label: string, work: Promise<T>) =>
        Promise.race([
          work,
          new Promise<never>((_r, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    this.t(
                      `${label} : l’appareil ne répond pas (délai de 3 min). Ouvrez son diagnostic.`,
                      `${label}: the device is not responding (3 min timeout). Open its diagnostics.`,
                    ),
                  ),
                ),
              180000,
            ).unref(),
          ),
        ]);
      await Promise.all(
        this.input.deviceIds.map(async (id) => {
          try {
            const app = this.project.applications?.[this.osOf(id)];
            if (app) {
              this.say(
                this.t(
                  'Connexion à l’appareil et lancement de l’application…',
                  'Connecting to the device and launching the app…',
                ),
              );
              await phase(
                id,
                this.t('Lancement', 'Launch'),
                this.ctx.get(id)!.ensureApplication(app, false),
              );
            }
            this.say(this.t('Lecture de l’écran…', 'Reading the screen…'));
            this.initial.set(
              id,
              await phase(id, this.t('Lecture de l’écran', 'Reading the screen'), this.observe(id)),
            );
            this.say(this.t('Exploration IA · démarrage', 'AI exploration · starting'));
          } catch (error) {
            failed.push(
              `${this.osOf(id)}: ${String((error as Error).message ?? error).split('\n')[0]}`,
            );
            await this.trace.record({ type: 'device-unavailable', id, message: String(error) });
            this.facts.deviceByOs.delete(this.osOf(id));
          }
        }),
      );
      if (!this.initial.size)
        throw new Error(
          this.t('Aucun appareil exploitable : ', 'No usable device: ') + failed.join(' · '),
        );
      if (failed.length)
        this.warnings.push(this.t('Appareil ignoré — ', 'Device skipped — ') + failed.join(' · '));
      return await hub.converse(
        CREATION_SYSTEM,
        this.signal,
        (conversation) => this.loop(conversation, path),
        { fast: this.settings.creationFastMode },
      );
    } catch (error) {
      await this.trace.record({
        type: 'stopped',
        message: String(error),
        cancelled: this.signal.aborted,
      });
      // Timed out (not cancelled by the user) with real work done: hand back a draft instead of nothing.
      if (this.signal.aborted && !this.cancelledByUser && this.hasTrace())
        return this.draftReply(
          this.t(
            'Délai atteint : brouillon reconstruit à partir des actions exécutées.',
            'Time limit reached: draft rebuilt from the executed actions.',
          ),
        );
      throw error;
    } finally {
      automation.release(this.owner);
      for (const route of this.prepRoutes.values())
        await savePreparation(store, this.deps.live, this.input.projectId, route, false).catch(
          () => {},
        );
      this.say('');
    }
  }
  cancelledByUser = false;
  private reminded = false;

  private hasTrace() {
    return [...this.facts.executed.values()].some((l) => l.length > 0);
  }

  /* ---------- observation ---------- */
  private lastObserved?: string;
  /** An explicit inspection after an action shows the app once it has settled (past loading states). */
  private settle(id: string, screen: Screen) {
    const last = this.facts.executed.get(id)?.at(-1);
    if (last) last.settled = screen;
  }
  private async observe(id: string) {
    const screen = await this.ctx.get(id)!.inspect();
    this.screens.set(id, screen);
    this.lastObserved = id;
    recordObservation(this.facts, this.osOf(id), screen);
    await this.trace.record({ type: 'observation', screen });
    return screen;
  }
  /** Screen text for the model; identical consecutive screens are reported as such to save tokens. */
  private render(screen: Screen, label = 'SCREEN') {
    const fp = screenFingerprint(screen);
    const same = this.lastFingerprint.get(screen.deviceId) === fp;
    this.lastFingerprint.set(screen.deviceId, fp);
    return same
      ? `${label} UNCHANGED (no visible change on ${screen.deviceId})`
      : `${label} ${JSON.stringify(compactScreen(screen))}`;
  }
  private outline(nodes: ScenarioNode[]): unknown[] {
    return nodes.map((n) => ({
      id: n.id,
      name: n.name,
      kind: n.kind,
      ...(n.screen ? { screen: n.screen.name } : {}),
      ...(n.startScreen ? { startScreen: n.startScreen.name } : {}),
      ...(n.children.length ? { children: this.outline(n.children) } : {}),
    }));
  }

  /* ---------- main loop ---------- */
  private async loop(chat: Conversation, path: ScenarioNode[]): Promise<CreationReply> {
    const { store } = this.deps;
    const settings = this.settings;
    const project = this.project;
    const metadata = {
      project: { name: project.name, platforms: project.platforms, tags: project.tags },
      currentPath: path.map(({ id, name, kind }) => ({ id, name, kind })),
      parentId: this.input.nodeId ?? null,
      outline: this.outline(project.nodes),
      devices: this.input.deviceIds.map((id) => devices_(this.deps, id)),
      request: this.input.prompt,
      availableVariables: Object.keys(project.variables ?? {}),
      mode: {
        exploration: settings.explorationMode,
        preparation: settings.creationPreparation,
        questions: settings.creationQuestions && settings.explorationMode !== 'auto-approve',
        language: settings.language,
      },
      extraGuidance: settings.creationPrompt || undefined,
      history: project.messages
        .filter((m) => m.sessionId === this.chatSessionId)
        .slice(-12)
        .map(({ role, content }) => ({ role, content: content.slice(0, 600) })),
    };
    let prompt =
      'METADATA ' +
      JSON.stringify(metadata) +
      '\n' +
      [...this.initial.values()].map((s) => this.render(s, 'INITIAL SCREEN')).join('\n');
    let corrections = 0,
      invalid = 0,
      budgetNoticed = false;
    for (let step = 0; step < settings.creationMaxDecisions; step++) {
      this.signal.throwIfAborted();
      const remaining = settings.creationMaxDecisions - step;
      const late = Date.now() > this.softDeadline;
      if ((remaining <= 3 || late) && !budgetNoticed) {
        budgetNoticed = true;
        prompt += `\nBUDGET: ${late ? 'time is almost up' : remaining + ' decisions left'}. Stop exploring and call finish NOW with what you have verified.`;
      }
      const reply = await this.turn(chat, prompt + REMINDER, step);
      const parsed = parseDecision(reply);
      if (!parsed.ok) {
        if (++invalid >= MAX_INVALID)
          return this.draftOrThrow(
            this.t('Réponses IA invalides répétées.', 'Repeated invalid AI replies.'),
          );
        prompt = `INVALID RESPONSE (${parsed.error}). Return exactly one JSON host command.`;
        continue;
      }
      invalid = 0;
      const d = parsed.decision;
      this.say(
        this.t(
          `Exploration IA · étape ${step + 1} · ${d.tool}`,
          `AI exploration · step ${step + 1} · ${d.tool}`,
        ),
      );

      if (d.tool === 'finish') {
        const outcome = await this.finish(d, corrections);
        if ('reply' in outcome) return outcome.reply;
        if (!outcome.free) corrections++;
        if (corrections > MAX_CORRECTIONS)
          return this.draftOrThrow(
            this.t(
              'Proposition IA non valide après corrections.',
              'AI proposal still invalid after corrections.',
            ),
          );
        prompt = outcome.prompt;
        continue;
      } else if (d.tool === 'question' || d.tool === 'create_variable')
        prompt = await this.questionOrVariable(d);
      else {
        try {
          if (!this.input.deviceIds.includes((d as { deviceId: string }).deviceId))
            throw new Error('Appareil hors périmètre');
          prompt = await this.tool(d, store);
        } catch (error) {
          this.signal.throwIfAborted();
          const deviceId = (d as { deviceId?: string }).deviceId;
          if (deviceId && (this.prepRoutes.has(deviceId) || d.tool === 'prepare'))
            this.prepFailed.add(deviceId);
          await this.trace.record({ type: 'error', message: String(error) });
          // Attach the current screen: the model almost always needs it to recover, which saves a round trip.
          let fresh = '';
          if (deviceId && this.ctx.has(deviceId))
            fresh = await this.observe(deviceId)
              .then((s) => '\n' + this.render(s, 'CURRENT SCREEN'))
              .catch(() => '');
          const key = JSON.stringify([
            d.tool,
            (d as any).componentId,
            (d as any).operation,
            (d as any).value,
          ]);
          const count = (this.failures.get(key) ?? 0) + 1;
          this.failures.set(key, count);
          prompt = `TOOL ERROR: ${String((error as Error).message ?? error)}${count > 1 ? '\nThis exact action failed before: do something DIFFERENT or finish with an honest blocker.' : ''}${fresh}`;
        }
      }
    }
    return this.draftOrThrow(
      this.t(
        `Limite de ${settings.creationMaxDecisions} décisions atteinte.`,
        `Limit of ${settings.creationMaxDecisions} decisions reached.`,
      ),
    );
  }
  private canPrepare() {
    return (
      this.settings.creationPreparation &&
      !this.hasTrace() &&
      !this.prepRoutes.size &&
      this.input.deviceIds.some(
        (id) => !this.prepTried.has(id) && this.project.applications?.[this.osOf(id)],
      )
    );
  }

  /**
   * Web views (and other opaque regions) are drawn on screen but absent from the accessibility tree.
   * The model then receives the screenshot with a labeled grid and can designate targets by cell.
   */
  private async opaqueContext(): Promise<{ text: string; images: ImageInput[] }> {
    const screen = this.lastObserved ? this.screens.get(this.lastObserved) : undefined;
    if (!screen?.opaque?.length || !this.lastObserved) return { text: '', images: [] };
    try {
      const shot = await this.ctx.get(this.lastObserved)!.screenshot();
      if (!shot) return { text: '', images: [] };
      const grid = await annotateGrid(shot, screen);
      return {
        images: [{ mime: grid.mime, data: grid.data }],
        text:
          `\nOPAQUE REGION on ${screen.deviceId}: ${JSON.stringify(screen.opaque)} — its content (a web view) is NOT in the accessibility tree, so no componentId exists for it. ` +
          `The attached image is the current screen with a labeled grid (${grid.cols} columns A.., ${grid.rows} rows 1.., cells of ${grid.cell} pt). ` +
          'To interact with that region use {"tool":"perform","deviceId":…,"operation":"tap"|"type","cell":"C7","value":…} where cell is the grid cell containing the CENTER of the target (field, button, checkbox). ' +
          'To type, first perform with operation "type" on the field cell: the host taps it, then types. Credentials must be ${VARIABLE} placeholders. ' +
          'Verify the effect from the next screenshot; native elements outside the region still use componentId.',
      };
    } catch (error) {
      await this.trace.record({ type: 'grid-failed', message: String(error) });
      return { text: '', images: [] };
    }
  }
  private async turn(chat: Conversation, prompt: string, step: number) {
    const started = Date.now();
    const timer = setInterval(
      () =>
        this.say(
          this.t(
            `Exploration IA · étape ${step + 1} · réponse en attente (${Math.round((Date.now() - started) / 1000)} s)`,
            `AI exploration · step ${step + 1} · waiting (${Math.round((Date.now() - started) / 1000)} s)`,
          ),
        ),
      15000,
    );
    try {
      const { text, images } = await this.opaqueContext();
      return await chat.send(prompt + text, { schema: decisionJsonSchema, images });
    } finally {
      clearInterval(timer);
    }
  }

  /* ---------- device tools ---------- */
  private async tool(
    d: Exclude<Decision, { tool: 'finish' | 'question' | 'create_variable' }>,
    store: WorkspaceStore,
  ): Promise<string> {
    const id = d.deviceId;
    const ctx = this.ctx.get(id)!;
    const platform = ctx.platform;
    if (d.tool === 'inspect') {
      const screen = await this.observe(id);
      this.settle(id, screen);
      return this.render(screen);
    }
    if (d.tool === 'sequence') return this.sequence(d);
    if (d.tool === 'prepare') return this.prepare(d, id, store);
    if (d.tool === 'ready') return this.ready(d, id);
    if (this.prepFailed.has(id))
      throw new Error('La préparation a échoué ; aucun nouvel essai automatique.');
    const component = this.screens.get(id)?.components.find((c) => c.id === d.componentId);
    let point: Variant['point'];
    if (d.cell) {
      const screen = this.screens.get(id);
      point = screen && cellToPoint(d.cell, screen, GRID_CELL_PT);
      if (!point)
        throw new Error(
          `Cellule de grille invalide : « ${d.cell} ». Utilisez une cellule visible sur l’image (ex. C7).`,
        );
      if (!['tap', 'type', 'clear'].includes(d.operation))
        throw new Error('Une cellule ne s’utilise qu’avec tap, type ou clear.');
    }
    const needsComponent = d.operation !== 'back' && d.operation !== 'swipe' && !point;
    if (needsComponent && !component?.locator)
      throw new Error(
        'Composant absent du dernier écran inspecté : utilisez un id du dernier SCREEN.',
      );
    const variant: Variant = {
      operation: d.operation,
      locator: needsComponent ? component?.locator : undefined,
      point,
      fallbacks: [],
      hint: component
        ? (component.label || component.text).slice(0, 120)
        : point
          ? `zone web · cellule ${d.cell}`
          : '',
      value: z
        .string()
        .max(5000)
        .parse(d.value ?? ''),
      assertion: 'visible',
      expected: '',
      direction: d.direction,
      timeoutMs: 10000,
    };
    if (d.operation === 'type' && component?.password && !PLACEHOLDER.test(variant.value))
      throw new Error(
        'Utilisez une variable projet pour saisir un mot de passe : ${VARIABLE_NAME}.',
      );
    // A literal credential given in the request must never be typed (or stored) as plain text.
    if (
      d.operation === 'type' &&
      point &&
      !PLACEHOLDER.test(variant.value) &&
      variant.value &&
      this.input.prompt.includes(variant.value)
    )
      throw new Error(
        'Cette valeur est un identifiant fourni dans la demande : utilisez create_variable puis ${NOM}.',
      );
    const route = this.prepRoutes.get(id);
    if (route && d.operation === 'type') {
      if (!PLACEHOLDER.test(variant.value))
        throw new Error('Utilisez une variable projet existante pendant la préparation.');
      if (
        route.children.some(
          (n) =>
            n.variants[platform]?.operation === 'type' &&
            n.variants[platform]?.value === variant.value,
        )
      )
        throw new Error('Cette saisie a déjà été tentée pendant la préparation.');
    }
    const before = this.screens.get(id);
    await ctx.perform(variant, 'action');
    const after = await this.observe(id);
    if (route) {
      const node = makeNode('action', 'Préparation · ' + d.operation, [platform]);
      node.blocking = true;
      node.variants[platform] = structuredClone(variant);
      recordPreparationDestination(node, after, platform, [
        ...store.get(this.input.projectId).nodes,
        route,
      ]);
      route.children.push(node);
      await this.trace.record({
        type: 'creation-preparation-step',
        deviceId: id,
        node,
        status: 'passed',
      });
    } else {
      const list = this.facts.executed.get(id) ?? [];
      // The screen the model saw before this action is where the previous one really ended up.
      const previous = list.at(-1);
      if (previous && before && !previous.settled) previous.settled = before;
      this.facts.executed.set(id, [...list, { variant, before, after }]);
    }
    await this.trace.record({
      type: 'action',
      deviceId: id,
      variant,
      status: 'completed',
      preparation: !!route,
    });
    return 'ACTION COMPLETED. ' + this.render(after, 'NEW SCREEN');
  }

  /**
   * Several actions on one screen without a model round trip (a login form: type, type, tap). The host re-reads the
   * screen after every step and stops at the first error or when the next target is no longer on screen.
   */
  private async sequence(d: Extract<Decision, { tool: 'sequence' }>): Promise<string> {
    const log: string[] = [];
    for (const [index, step] of d.steps.entries()) {
      this.signal.throwIfAborted();
      try {
        await this.tool({ tool: 'perform', deviceId: d.deviceId, ...step }, this.deps.store);
        log.push(
          `${index + 1}. ${step.operation}${step.componentId ? ' ' + step.componentId : step.cell ? ' ' + step.cell : ''}: ok`,
        );
      } catch (error) {
        log.push(
          `${index + 1}. ${step.operation}: FAILED — ${String((error as Error).message ?? error)}`,
        );
        const rest = d.steps.length - index - 1;
        if (rest) log.push(`${rest} remaining step(s) NOT executed.`);
        throw new Error(`SEQUENCE stopped after ${index} successful step(s).\n${log.join('\n')}`);
      }
    }
    return `SEQUENCE COMPLETED (${d.steps.length} steps).\n${log.join('\n')}\n${this.render(this.screens.get(d.deviceId)!, 'NEW SCREEN')}`;
  }

  private async prepare(
    d: Extract<Decision, { tool: 'prepare' }>,
    id: string,
    store: WorkspaceStore,
  ) {
    if (!this.settings.creationPreparation)
      throw new Error('Préparation automatique désactivée dans les paramètres de création.');
    if (this.prepTried.has(id) || (this.facts.executed.get(id)?.length ?? 0))
      throw new Error('La préparation est limitée à un essai avant les actions du test.');
    const ctx = this.ctx.get(id)!;
    const platform = ctx.platform;
    const application = this.project.applications?.[platform];
    if (!application) throw new Error('Application à relancer non configurée.');
    const selected = d.targetNodeId
      ? flatten(store.get(this.input.projectId).nodes).find((n) => n.id === d.targetNodeId)
      : undefined;
    const target = selected && startingTarget(selected, platform);
    if (d.targetNodeId && !target) throw new Error('Écran de départ du scénario cible non défini.');
    this.prepTried.add(id);
    await this.trace.record({
      type: 'creation-preparation-start',
      deviceId: id,
      targetNodeId: d.targetNodeId ?? null,
    });
    if (!target) {
      await ctx.ensureApplication(application, true);
      const screen = await this.observe(id);
      this.prepRoutes.set(
        id,
        preparationPath(
          screen,
          platform,
          z
            .string()
            .trim()
            .min(1)
            .max(150)
            .parse(d.summary ?? 'Écran de départ'),
        ),
      );
      return (
        'PREPARATION ACTIVE. App restarted preserving data. Inspect/navigate to the requested starting screen, then call ready with an observed componentId. Do not propose business tests yet. ' +
        this.render(screen)
      );
    }
    const traversed: ScenarioNode[] = [];
    const execute = async (node: ScenarioNode) => {
      await ctx.perform(node.variants[platform]!, node.kind);
      await this.trace.record({
        type: 'creation-preparation-step',
        deviceId: id,
        node,
        status: 'passed',
      });
      traversed.push(structuredClone(node));
      if (node.kind === 'navigation' && node.screen)
        await waitForScreenDefinition(
          () => this.observe(id),
          node.screen,
          platform,
          [...store.get(this.input.projectId).nodes, node],
          node.variants[platform]!.timeoutMs,
          this.signal,
        );
      await this.observe(id);
    };
    await prepareStart({
      target,
      nodes: store.get(this.input.projectId).nodes,
      platform,
      signal: this.signal,
      perform: ctx.perform,
      restart: () => ctx.ensureApplication(application, true),
      execute,
      explore: () =>
        this.deps.recovery.recover(
          {
            projectId: this.input.projectId,
            deviceId: id,
            platform,
            target,
            owner: this.owner,
            signal: this.signal,
          },
          execute,
        ),
    });
    this.prepReplay.set(id, traversed);
    return (
      'PREPARATION COMPLETE. Starting screen verified; continue business exploration from this replay baseline. ' +
      (await this.rebaseline(id))
    );
  }
  private async ready(d: Extract<Decision, { tool: 'ready' }>, id: string) {
    if (this.prepFailed.has(id))
      throw new Error('La préparation a échoué ; aucun nouvel essai automatique.');
    const route = this.prepRoutes.get(id);
    if (!route) throw new Error('Aucune préparation active sur cet appareil.');
    const ctx = this.ctx.get(id)!;
    const screen = await this.observe(id);
    const component = screen.components.find((c) => c.id === d.componentId);
    if (!component?.locator || component.password)
      throw new Error('Le repère de départ doit être observé et non secret.');
    const check = preparationCheck(
      component.locator,
      ctx.platform,
      'Vérifier l’écran de départ retrouvé',
    );
    await ctx.perform(check.variants[ctx.platform]!, 'test');
    route.children.push(check);
    this.prepReplay.set(id, structuredClone(route.children));
    await savePreparation(this.deps.store, this.deps.live, this.input.projectId, route, true);
    this.prepRoutes.delete(id);
    await this.trace.record({
      type: 'creation-preparation-ready',
      deviceId: id,
      scenarioId: route.id,
    });
    return (
      'PREPARATION COMPLETE. Path saved separately. Continue business exploration; do not duplicate preparation steps. NEW REPLAY BASELINE ' +
      (await this.rebaseline(id))
    );
  }
  /** After preparation the replay baseline moves to the recovered screen. */
  private async rebaseline(id: string) {
    const screen = await this.observe(id);
    this.initial.set(id, screen);
    const latest = this.deps.store.get(this.project.id);
    this.project.nodes = structuredClone(latest.nodes);
    this.project.revision = latest.revision;
    return this.render(screen);
  }

  /* ---------- questions & variables ---------- */
  private async questionOrVariable(d: Extract<Decision, { tool: 'question' | 'create_variable' }>) {
    const { store } = this.deps;
    const settings = this.settings;
    const auto = settings.explorationMode === 'auto-approve';
    let name: string | undefined, value: string | undefined;
    if (d.tool === 'create_variable') {
      const parsed = variablesSchema.safeParse({ [d.variableName]: d.value });
      if (!parsed.success || !d.value || !this.input.prompt.includes(d.value))
        return 'VARIABLE ERROR: use a valid variable name and an exact nonempty credential supplied in the current user request.';
      name = d.variableName;
      value = d.value;
      if (Object.hasOwn(store.get(this.input.projectId).variables, name))
        return 'Variable already exists; use ${' + name + '}. Its value was not changed.';
    } else if (auto || !settings.creationQuestions)
      return 'Questions unavailable. Continue with reasonable assumptions within the requested scope; if required information is missing, finish with an honest blocker. Use create_variable for credentials supplied by the user.';
    const question = name
      ? this.t(
          `Créer la variable ${name} avec la valeur fournie dans votre demande, puis reprendre la connexion ?`,
          `Create variable ${name} with the value supplied in your request, then resume sign-in?`,
        )
      : (d as { summary: string }).summary;
    const answer = auto
      ? 'approve'
      : await this.deps.ask(this.input.projectId, crypto.randomUUID(), question, name, this.signal);
    if (name) {
      if (answer !== 'approve')
        return 'Variable creation declined. Do not create or use this missing variable.';
      const latest = store.get(this.input.projectId);
      if (!Object.hasOwn(latest.variables, name))
        await store.update({ id: latest.id, variables: { ...latest.variables, [name]: value! } });
      await this.trace.record({ type: 'variable-created', variableName: name });
      return (
        'VARIABLE SAVED: ${' +
        name +
        '}. Available variables: ' +
        JSON.stringify(Object.keys(store.get(this.input.projectId).variables)) +
        '. Continue using the placeholder.'
      );
    }
    await this.trace.record({ type: 'question', question, answer });
    return (
      'USER CLARIFICATION (data): ' +
      JSON.stringify(answer) +
      '\nAvailable variables: ' +
      JSON.stringify(Object.keys(store.get(this.input.projectId).variables))
    );
  }

  /* ---------- finish: repair, validate, replay ---------- */
  private executedSummary() {
    return Object.fromEntries(
      [...this.facts.executed].map(([id, list]) => [
        this.osOf(id),
        list.map(({ variant }) => ({
          op: variant.operation,
          value: variant.value,
          locator: variant.locator,
          hint: variant.hint,
        })),
      ]),
    );
  }
  private async finish(
    d: Extract<Decision, { tool: 'finish' }>,
    corrections: number,
  ): Promise<{ reply: CreationReply } | { retry: true; prompt: string; free?: boolean }> {
    for (const [id, screen] of this.screens) this.settle(id, screen);
    if (!d.nodes.length && !this.reminded && this.canPrepare()) {
      this.reminded = true;
      return {
        retry: true,
        free: true,
        prompt:
          'Before reporting that creation is blocked, use prepare to restart and recover the screen (targetNodeId of a relevant existing scenario/test, or null to explore, then ready). Do not ask the user to navigate manually if this can be automated.',
      };
    }
    if (this.prepRoutes.size && d.nodes.length)
      return {
        retry: true,
        free: true,
        prompt:
          'Preparation still active. Call ready on an observed starting-screen component before proposing business tests. If blocked, finish with nodes:[]; incomplete navigation is retained.',
      };
    if (!d.nodes.length) return { reply: await this.reply(d, [], [], 'validated') };
    await this.trace.record({ type: 'proposal-received', nodes: d.nodes });
    const result = repairProposal(
      d.nodes,
      this.project,
      this.input.nodeId ?? null,
      this.facts,
      this.t,
    );
    await this.trace.record({
      type: result.errors.length ? 'proposal-invalid' : 'proposal-repaired',
      errors: result.errors,
      warnings: result.warnings,
    });
    const unusable =
      result.errors.length > 0 || (d.nodes.length > 0 && countSteps(result.nodes) === 0);
    if (unusable)
      return {
        retry: true,
        prompt:
          'PROPOSAL VALIDATION ERROR: ' +
          (result.errors.join('; ') || 'every step was removed') +
          (result.warnings.length
            ? '\nAutomatic corrections: ' + result.warnings.join(' | ')
            : '') +
          `\nAttempt ${corrections + 1}/${MAX_CORRECTIONS}. Return finish again: keep only interactions you really executed (same operation, value and selector) and selectors you really observed; every navigation needs a destination screen with unique co-occurring markers. Never invent anything. If evidence is insufficient, omit that step and say so.` +
          '\nEXECUTED ' +
          JSON.stringify(this.executedSummary()) +
          '\nLATEST SCREENS ' +
          JSON.stringify(
            Object.fromEntries(
              [...this.screens].map(([id, s]) => [this.osOf(id), compactScreen(s, 90)]),
            ),
          ),
      };
    return {
      reply: await this.reply(
        d,
        result.nodes,
        result.warnings,
        result.warnings.length ? 'repaired' : 'validated',
      ),
    };
  }
  private async draftOrThrow(reason: string): Promise<CreationReply> {
    if (!this.hasTrace())
      throw new Error(
        reason +
          ' ' +
          this.t(
            'Aucune action n’a été exécutée : réduisez le périmètre ou reformulez.',
            'No action was executed: narrow the scope or rephrase.',
          ),
      );
    return this.draftReply(reason);
  }
  private async draftReply(reason: string): Promise<CreationReply> {
    const nodes = draftFromTrace(this.input.prompt, this.project, this.facts, this.t);
    const repaired = repairProposal(
      nodes,
      this.project,
      this.input.nodeId ?? null,
      this.facts,
      this.t,
    );
    const text = `${reason} ${this.t('Le brouillon reprend uniquement les interactions réellement exécutées ; ajoutez-y vos vérifications.', 'The draft only contains interactions that were actually executed; add your checks.')}`;
    return this.reply(
      { tool: 'finish', summary: text, nodes: [] },
      repaired.errors.length ? [] : repaired.nodes,
      [...repaired.warnings, ...(repaired.errors.length ? repaired.errors : [])],
      'draft',
    );
  }

  private async reply(
    d: Extract<Decision, { tool: 'finish' }>,
    nodes: ScenarioNode[],
    warnings: string[],
    quality: CreationReply['quality'],
  ): Promise<CreationReply> {
    const { store } = this.deps;
    const replay = await this.replayAll(nodes);
    await this.trace.record({ type: 'proposal', nodes, replay, quality });
    const text = d.summary || this.t('Proposition de scénario', 'Scenario proposal');
    const current = store.get(this.project.id);
    const now = () => new Date().toISOString();
    const saved = await store.update({
      id: this.project.id,
      chatSessions: current.chatSessions.map((s) =>
        s.id === this.chatSessionId && /^Session \d+$/.test(s.name)
          ? { ...s, name: sessionTitle(d.sessionTitle?.trim() || this.input.prompt) }
          : s,
      ),
      messages: [
        ...current.messages,
        {
          id: crypto.randomUUID(),
          role: 'user',
          sessionId: this.chatSessionId ?? undefined,
          content: this.input.prompt,
          at: now(),
        },
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          sessionId: this.chatSessionId ?? undefined,
          content: text,
          at: now(),
        },
      ],
    });
    const osList = activeOs(this.project);
    return {
      text,
      replay,
      proposal: nodes.length ? nodes : undefined,
      parentId: this.input.nodeId,
      baseRevision: saved.revision,
      warnings: [...this.warnings, ...warnings],
      coverage: osList.map((os) => ({
        os,
        status: this.facts.deviceByOs.has(os) ? ('explored' as const) : ('missing' as const),
        note: this.facts.deviceByOs.has(os)
          ? this.t('Exploré sur appareil', 'Explored on device')
          : this.t('Aucun appareil : variantes à compléter', 'No device: variants to complete'),
      })),
      quality,
    };
  }

  private async replayAll(nodes: ScenarioNode[]): Promise<ReplayResult[]> {
    const { devices, store } = this.deps;
    const results: ReplayResult[] = [];
    for (const platform of OS_LIST.filter((os) => this.project.platforms.includes(os))) {
      const id = this.input.deviceIds.find((d) => devices.known.get(d)?.platform === platform);
      const application = this.project.applications?.[platform];
      const result: ReplayResult = {
        platform,
        status: 'blocked',
        message: this.t(
          'Application à lancer non configurée.',
          'Application to launch not configured.',
        ),
      };
      if (!this.settings.creationReplay)
        Object.assign(result, {
          status: 'skipped',
          message: this.t('Rejeu désactivé.', 'Replay disabled.'),
        });
      else if (!id || !this.facts.deviceByOs.has(platform))
        result.message = this.t('Appareil absent.', 'Device missing.');
      else if (!flatten(nodes).some((n) => n.variants[platform]))
        result.message = this.t('Aucune variante proposée.', 'No variant proposed.');
      else if (application) {
        const ctx = this.ctx.get(id)!;
        try {
          await ctx.ensureApplication(application, true);
          for (const step of this.prepReplay.get(id) ?? []) {
            await ctx.perform(step.variants[platform]!, step.kind);
            if (step.kind === 'navigation' && step.screen)
              await waitForScreenDefinition(
                () => this.observe(id),
                step.screen,
                platform,
                [...this.project.nodes, step],
                step.variants[platform]!.timeoutMs,
                this.signal,
              );
          }
          const initial = this.initial.get(id);
          // The app may still be drawing after a restart, and dynamic text differs: compare by overlap, with a short wait.
          let screen = await this.observe(id);
          for (let i = 0; initial && i < 8 && similarity(initial, screen) < 0.75; i++) {
            await new Promise((r) => setTimeout(r, 1000));
            screen = await this.observe(id);
          }
          if (initial && similarity(initial, screen) < 0.75) {
            // Not a failure of the proposal: the app simply restarts elsewhere than where exploration began.
            Object.assign(result, {
              status: 'blocked',
              message: this.t(
                'Rejeu impossible : l’application redémarre sur un autre écran que celui de l’exploration (données conservées). Utilisez la préparation de l’écran de départ ou explorez depuis l’écran de lancement.',
                'Replay not possible: the app restarts on a different screen than where exploration began (data kept). Use start-screen preparation or explore from the launch screen.',
              ),
            });
            results.push(result);
            continue;
          }
          await replayProposal(
            nodes,
            platform,
            (v, k) => ctx.perform(v, k),
            (e) => this.trace.record(e),
            this.signal,
            async (node) => {
              if (node.kind !== 'navigation') return;
              if (!node.screen) throw new Error('Écran destination non configuré : ' + node.name);
              await waitForScreenDefinition(
                () => ctx.inspect(),
                node.screen,
                platform,
                [...store.get(this.project.id).nodes, ...nodes],
                node.variants[platform]?.timeoutMs ?? 10000,
                this.signal,
              );
            },
          );
          Object.assign(result, {
            status: 'passed',
            message: this.t(
              'Rejeu complet avec assertions depuis l’état initial observé.',
              'Full replay with assertions from the observed initial state.',
            ),
          });
        } catch (error) {
          this.signal.throwIfAborted();
          Object.assign(result, {
            status: 'failed',
            message: String((error as Error).message ?? error),
          });
        }
      }
      results.push(result);
    }
    return results;
  }
}
const devices_ = (deps: CreationDeps, id: string) => deps.devices.known.get(id);
