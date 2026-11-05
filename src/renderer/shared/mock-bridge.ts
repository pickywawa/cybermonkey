import { SECRET_KEYS, type SecretKey } from '../../shared/domain/integrations';
import type { Bridge, Channel, Contract, LiveEvent } from '../../shared/ipc';

const noSecrets = Object.fromEntries(SECRET_KEYS.map((k) => [k, false])) as Record<
  SecretKey,
  boolean
>;
import { defaultSettings } from '../../shared/domain/settings';
import { projectSchema, type Project } from '../../shared/domain/project';
import { makeNode, makeVariant, type OS, type ScenarioNode } from '../../shared/domain/scenario';
import type { Campaign, RunEntry, RunReport } from '../../shared/domain/report';
import type { Device, Screen } from '../../shared/domain/devices';
import { importCases } from '../../shared/importers/parsers';

/** Browser-preview bridge: in-memory demo data (fictional app "Atlas Mobile"), no device control, no real AI. */
const phone = (os: OS, title: string, tone = '#e9e6ff') => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844" viewBox="0 0 390 844"><rect width="390" height="844" fill="#f7f7fb"/><rect y="0" width="390" height="48" fill="#fff"/><text x="24" y="82" font-family="sans-serif" font-size="12" fill="#6d8bff">ATLAS · ${os === 'ios' ? 'iOS' : 'ANDROID'}</text><text x="24" y="124" font-family="sans-serif" font-size="30" font-weight="700" fill="#1b1d29">${title}</text><rect x="24" y="160" width="342" height="150" rx="18" fill="${tone}"/><text x="44" y="215" font-family="sans-serif" font-size="20" fill="#1b1d29">Un week-end à Lisbonne</text><rect x="24" y="330" width="342" height="150" rx="18" fill="#dff5ea"/><text x="44" y="385" font-family="sans-serif" font-size="20" fill="#1b1d29">La ville au grand air</text><rect x="24" y="520" width="342" height="52" rx="14" fill="#6d8bff"/><text x="195" y="553" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#fff">Continuer</text></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
};
const screenOf = (id: string): Screen => ({
  deviceId: id,
  width: 390,
  height: 844,
  capturedAt: new Date().toISOString(),
  components: [
    {
      id: 'c1',
      type: 'Text',
      label: 'Titre',
      text: 'Bonjour Camille',
      locator: { using: 'accessibility id', value: 'title' },
      rect: { x: 24, y: 96, width: 300, height: 40 },
      enabled: true,
      password: false,
    },
    {
      id: 'c2',
      type: 'Button',
      label: 'Continuer',
      text: 'Continuer',
      locator: { using: 'accessibility id', value: 'continue' },
      rect: { x: 24, y: 520, width: 342, height: 52 },
      enabled: true,
      password: false,
      interactive: true,
    },
    {
      id: 'c3',
      type: 'Card',
      label: 'Week-end',
      text: '',
      locator: { using: 'accessibility id', value: 'card-1' },
      rect: { x: 24, y: 160, width: 342, height: 150 },
      enabled: true,
      password: false,
      interactive: true,
    },
  ],
});

/** Fictional app "Atlas Mobile": screens, scenarios and results are demonstration data only. */
const SCREENS = {
  login: 'Connexion',
  home: 'Accueil',
  collections: 'Collections',
  profile: 'Profil',
  settings: 'Réglages',
} as const;
const marker = (v: string) => ({ using: 'accessibility id' as const, value: v });
const defOf = (id: keyof typeof SCREENS) => ({
  id,
  name: SCREENS[id],
  variants: {
    android: { markers: [marker(id + '-title')] },
    ios: { markers: [marker(id + '-title')] },
  },
});
function step(
  kind: 'navigation' | 'test' | 'action',
  name: string,
  to?: keyof typeof SCREENS,
  oses: OS[] = ['android', 'ios'],
) {
  const node = makeNode(kind, name, oses);
  for (const os of oses)
    node.variants[os] = makeVariant({
      operation: kind === 'test' ? 'assert' : 'tap',
      locator: marker((to ?? 'home') + (kind === 'test' ? '-title' : '-button')),
      hint: name,
    });
  if (kind === 'navigation' && to) node.screen = defOf(to);
  return node;
}
const DEMO_FLOW: {
  os?: OS[];
  scenario: string;
  module?: string;
  /** Never run in the demonstration campaign: shows the « to test » state. */
  untested?: boolean;
  start?: keyof typeof SCREENS;
  steps: [ReturnType<typeof step>, keyof typeof SCREENS][];
}[] = [
  {
    scenario: 'Connexion et découverte',
    module: 'Compte',
    start: 'login',
    steps: [
      [step('navigation', 'Se connecter à Atlas', 'home'), 'home'],
      [step('test', 'Vérifier l’accueil personnalisé', 'home'), 'home'],
    ],
  },
  {
    scenario: 'Collections',
    module: 'Bibliothèque',
    steps: [
      [step('navigation', 'Ouvrir mes collections', 'collections'), 'collections'],
      [step('test', 'Vérifier les collections', 'collections'), 'collections'],
      [step('test', 'Créer une collection', 'collections', ['android']), 'collections'],
    ],
  },
  {
    scenario: 'Mon profil',
    module: 'Compte',
    steps: [
      [step('navigation', 'Ouvrir le profil', 'profile'), 'profile'],
      [step('test', 'Vérifier les informations du profil', 'profile'), 'profile'],
      [step('navigation', 'Ouvrir les réglages', 'settings'), 'settings'],
      [step('test', 'Vérifier le thème sombre', 'settings'), 'settings'],
    ],
  },
  {
    scenario: 'Panier et paiement',
    module: 'Paiement',
    untested: true,
    steps: [
      [step('navigation', 'Ouvrir le panier', 'home'), 'home'],
      [step('test', 'Vérifier le total', 'home'), 'home'],
      [step('test', 'Vérifier le bouton payer', 'home'), 'home'],
    ],
  },
];
function demoProject(): Project {
  const roots = DEMO_FLOW.map((f) => {
    const root = makeNode('scenario', f.scenario, []);
    if (f.start) root.startScreen = defOf(f.start);
    if (f.module) root.module = f.module;
    root.children = f.steps.map(([n]) => n);
    return root;
  });
  const session = {
    id: 's1',
    name: 'Session 1',
    createdAt: new Date().toISOString(),
    tokens: { input: 48200, output: 9100 },
  };
  return projectSchema.parse({
    id: 'demo',
    name: 'Atlas Mobile',
    directory: '/demo/Atlas Mobile',
    platforms: ['android', 'ios'],
    tab: 'creation',
    applications: { android: 'com.atlas.mobile', ios: 'com.atlas.Mobile' },
    applicationDetails: {
      android: { id: 'com.atlas.mobile', name: 'Atlas Mobile' },
      ios: { id: 'com.atlas.Mobile', name: 'Atlas Mobile' },
    },
    chatSessions: [session],
    activeChatSessionId: session.id,
    nodes: roots,
    variables: { PASSWORD: 'demo-only' },
    deviceIds: { android: 'android:R5CT1', ios: 'ios:00008110-AAA' },
    selectedNodeId: roots[0].children[0].id,
    createdAt: new Date().toISOString(),
    messages: [
      {
        id: 'm1',
        role: 'user',
        sessionId: session.id,
        content: 'Crée un scénario de connexion rapide puis ouvre mes collections.',
        at: new Date().toISOString(),
      },
      {
        id: 'm2',
        role: 'assistant',
        sessionId: session.id,
        content:
          'Exploration terminée sur Android et iOS : connexion, accueil et collections observés, 2 vérifications proposées. À valider avant ajout.',
        at: new Date().toISOString(),
      },
    ],
    activeCampaignId: '11111111-1111-4111-8111-111111111111',
  }) as Project;
}
const DEVICES: Device[] = [
  {
    id: 'android:R5CT1',
    name: 'Pixel 8',
    platform: 'android',
    kind: 'usb',
    status: 'ready',
    detail: 'R5CT1',
  },
  {
    id: 'ios:00008110-AAA',
    name: 'iPhone 15',
    platform: 'ios',
    kind: 'usb',
    status: 'ready',
    detail: '00008110-AAA · wired',
    osVersion: '18.1',
  },
];

export function createMockBridge(): Bridge {
  const settings = defaultSettings('/demo/Projects');
  settings.provider = 'claude';
  settings.theme = 'dark';
  let project = demoProject();
  const campaign: Campaign = {
    id: '11111111-1111-4111-8111-111111111111',
    projectId: 'demo',
    label: 'Validation · Atlas 2.4',
    createdAt: new Date(Date.now() - 3600e3).toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'open',
  };
  const t0 = Date.now() - 600e3;
  const entries: RunEntry[] = [];
  let seq = 0;
  const here = new Map<OS, keyof typeof SCREENS>([
    ['android', 'login'],
    ['ios', 'login'],
  ]);
  const ref = (os: OS, id: keyof typeof SCREENS) => ({
    id,
    name: SCREENS[id],
    platform: os,
    identified: true,
  });
  for (const flow of project.nodes.map((root, i) => ({ root, flow: DEMO_FLOW[i] })))
    for (const [index, [node, target]] of flow.flow.steps.entries())
      for (const os of ['android', 'ios'] as OS[]) {
        if (!node.variants[os]) continue; // single-OS step: nothing to run on the other OS
        if (flow.flow.untested) continue;
        if (os === 'ios' && node.name === 'Vérifier les collections') continue; // run on Android only: partial
        const real = flow.root.children[index];
        const before = here.get(os)!;
        const at = t0 + seq * 3100;
        const failed = os === 'ios' && real.name === 'Vérifier le thème sombre';
        if (real.kind === 'navigation') here.set(os, target);
        entries.push({
          id: crypto.randomUUID(),
          nodeId: real.id,
          nodeName: real.name,
          kind: real.kind,
          deviceId: os === 'ios' ? 'ios:00008110-AAA' : 'android:R5CT1',
          platform: os,
          status: failed ? 'failed' : 'passed',
          message: failed
            ? 'Texte attendu « Sombre », obtenu « Clair »'
            : real.kind === 'test'
              ? 'Vérification réussie'
              : 'Action effectuée',
          startedAt: new Date(at).toISOString(),
          finishedAt: new Date(
            at +
              (os === 'android' && real.name === 'Ouvrir mes collections'
                ? 4800
                : 900 + (seq % 4) * 220),
          ).toISOString(),
          completedAt: new Date(at + 1000).toISOString(),
          sequence: ++seq,
          screenBefore: ref(os, before),
          screenAfter: ref(os, here.get(os)!),
          screenshot: phone(os, SCREENS[here.get(os)!]),
          ...(failed ? { analysisState: 'pending' as const } : {}),
        });
      }
  const report: RunReport = {
    id: '22222222-2222-4222-8222-222222222222',
    projectId: 'demo',
    campaignId: campaign.id,
    platforms: ['android', 'ios'],
    startedAt: new Date(t0).toISOString(),
    finishedAt: new Date().toISOString(),
    status: 'failed',
    entries,
    snapshot: project.nodes,
    accessibility: [
      {
        os: 'android',
        screenId: 'home',
        screenName: SCREENS.home,
        nodeName: 'Se connecter à Atlas',
        at: new Date(t0).toISOString(),
        issues: [
          {
            rule: 'missing-label',
            severity: 'error',
            component: 'ImageButton',
            at: { x: 0.9, y: 0.06 },
          },
          {
            rule: 'small-target',
            severity: 'warning',
            component: 'ImageView',
            label: 'Fermer',
            size: { width: 32, height: 32 },
          },
          {
            rule: 'technical-label',
            severity: 'warning',
            component: 'ImageView',
            label: 'ic_cart_24',
          },
        ],
      },
      {
        os: 'ios',
        screenId: 'home',
        screenName: SCREENS.home,
        at: new Date(t0).toISOString(),
        issues: [
          {
            rule: 'small-target',
            severity: 'warning',
            component: 'Button',
            label: 'Aide',
            size: { width: 30, height: 30 },
          },
        ],
      },
      {
        os: 'android',
        screenId: 'login',
        screenName: SCREENS.login,
        at: new Date(t0).toISOString(),
        issues: [],
      },
    ],
  };
  const baselines: Record<string, number[]> = {};
  for (const e of entries)
    baselines[e.platform + ':' + e.nodeId] = [
      e.nodeName === 'Ouvrir mes collections' && e.platform === 'android' ? 1150 : 1000,
      e.nodeName === 'Ouvrir mes collections' && e.platform === 'android' ? 1250 : 1100,
    ];
  let replay: unknown = null;
  const listeners = new Set<(e: LiveEvent) => void>();
  const emit = (e: LiveEvent) => listeners.forEach((l) => l(e));
  const update = (patch: Record<string, unknown>) => {
    const {
      id: _id,
      expectedRevision: _r,
      ...rest
    } = patch as { id: string; expectedRevision?: number; nodes?: unknown; deviceIds?: object };
    project = projectSchema.parse({
      ...project,
      ...rest,
      revision: project.revision + (rest.nodes ? 1 : 0),
      deviceIds: { ...project.deviceIds, ...rest.deviceIds },
    }) as Project;
    return structuredClone(project);
  };
  const handlers: {
    [C in Channel]?: (input: Contract[C][0]) => Contract[C][1] | Promise<Contract[C][1]>;
  } = {
    'workspace.load': () =>
      structuredClone({ settings, projects: [project], activeProjectId: project.id }),
    'settings.save': (s) => Object.assign(settings, s),
    'mcp.status': () => ({
      running: true,
      port: 4750,
      url: 'http://127.0.0.1:4750/mcp',
      tools: 32,
      calls: 3,
      last: { tool: 'list_scenarios', at: new Date().toISOString(), ok: true },
    }),
    'mcp.regenerateToken': () =>
      Object.assign(settings, { mcpToken: Math.random().toString(16).slice(2).padEnd(48, '0') }),
    'remote.status': () => ({
      adb: [{ host: '192.168.1.20:5555', state: 'connected', detail: 'Connecté' }],
      providers: {
        browserstack: { ready: true, missing: '' },
        saucelabs: { ready: false, missing: 'nom d’utilisateur manquant' },
        devicefarm: { ready: false, missing: 'ARN manquant' },
        appium: { ready: false, missing: 'adresse manquante' },
      },
    }),
    'remote.test': () => ({ ok: true, message: 'Aperçu : aucune connexion réelle.' }),
    'remote.uploadApp': () => 'bs://aperçu',
    'remote.adbConnect': () => [
      { host: '192.168.1.20:5555', state: 'connected', detail: 'Connecté' },
    ],
    'remote.adbPair': () => ({ ok: true, message: 'Successfully paired (aperçu)' }),
    'integrations.status': () => ({
      secrets: noSecrets,
      journal: [],
      interactive: true,
    }),
    'integrations.setSecret': () => ({
      secrets: noSecrets,
      journal: [],
      interactive: true,
    }),
    'integrations.test': () => ({ ok: true, message: 'Aperçu : aucun envoi réel.' }),
    'integrations.gitInfo': () => ({
      isRepo: true,
      root: '/Users/demo/Documents/Cybermonkey/Projects',
      branch: 'main',
      upstream: 'origin/main',
      changes: 3,
      ahead: 0,
      behind: 1,
    }),
    'integrations.gitSync': () => {},
    'integrations.answer': () => {},
    'projects.update': (p) => update(p as never),
    'projects.select': () => {},
    'projects.create': () => project,
    'projects.reveal': () => {},
    'projects.remove': () => {},
    'projects.chooseDirectory': () => null,
    'projects.applications': () => [
      { id: 'com.atlas.mobile', name: 'Atlas Mobile' },
      { id: 'com.demo.notes', name: 'Notes' },
    ],
    'projects.applicationInfo': (i) => ({ id: i.application, name: 'Atlas Mobile' }),
    'devices.scan': () => ({ devices: DEVICES, diagnostics: [] }),
    'devices.health': (id) => ({
      deviceId: id,
      checkedAt: new Date().toISOString(),
      checks: [
        { id: 'connection', label: 'ADB / USB', state: 'ok', detail: id },
        {
          id: 'appium',
          label: 'Appium',
          state: 'error',
          detail: 'Le serveur ne répond pas (aperçu).',
          fix: 'Cliquez « Reconnecter » : le serveur local démarre au besoin.',
        },
        {
          id: 'environment',
          label: 'ADB / JDK / SDK',
          state: 'error',
          detail: 'JDK introuvable (JAVA_HOME).',
          fix: 'Installez un JDK puis relancez Cybermonkey.',
          command: 'brew install --cask temurin',
        },
      ],
    }),
    'devices.reconnect': () => {},
    'devices.warm': () => {},
    'devices.screenshot': (id) =>
      phone(id.startsWith('ios') ? 'ios' : 'android', 'Bonjour Camille'),
    'devices.inspect': (id) => screenOf(id),
    'devices.perform': () => null,
    'devices.openWda': () => {},
    'devices.openDoc': () => {},
    'devices.detach': (v) => {
      Object.assign(settings, { devicesDetached: !!v });
      setTimeout(() => emit({ type: 'workspace' }), 0);
    },
    'devices.aiDiagnose': () => 'Aperçu : la vraie IA n’est pas disponible dans le navigateur.',
    'ai.status': (provider) => ({
      provider,
      installed: true,
      authenticated: provider === 'claude',
      message: provider === 'claude' ? 'Claude Code connecté (démo)' : 'Non connecté',
      models: [{ id: 'sonnet', name: 'Sonnet' }],
      account: 'demo@example.com',
      ...(provider === 'claude'
        ? {
            limits: [
              {
                id: 'five_hour',
                label: '5 h',
                usedPercent: 12,
                resetsAt: new Date(Date.now() + 3 * 3600_000).toISOString(),
              },
              {
                id: 'seven_day',
                label: '7 j',
                usedPercent: 45,
                resetsAt: new Date(Date.now() + 3 * 86400_000).toISOString(),
              },
            ],
            usage: {
              today: { input: 41200, output: 9300 },
              week: { input: 612000, output: 98000 },
              total: { input: 2410000, output: 380000 },
            },
          }
        : {}),
    }),
    'ai.login': () => {},
    'ai.logout': () => {},
    'ai.detach': () => {},
    'creation.ask': async (i) => {
      await new Promise((r) => setTimeout(r, 900));
      const s = makeNode('scenario', 'Démo · ' + i.prompt.slice(0, 40), []);
      const a = makeNode('action', 'Appuyer sur « Continuer »', ['android']);
      a.variants.android!.locator = { using: 'accessibility id', value: 'continue' };
      const c = makeNode('test', 'Vérifier le titre', ['android']);
      c.variants.android!.locator = { using: 'accessibility id', value: 'title' };
      s.children = [a, c];
      return {
        text: 'Aperçu : proposition fictive.',
        proposal: [s],
        baseRevision: project.revision,
        replay: [
          { platform: 'android', status: 'passed', message: 'ok' },
          { platform: 'ios', status: 'blocked', message: 'Appareil absent.' },
        ],
        warnings: [
          'Variante ios retirée de « Vérifier le titre » : OS non exploré pendant cette session.',
        ],
        coverage: [
          { os: 'android', status: 'explored', note: '' },
          { os: 'ios', status: 'missing', note: '' },
        ],
        quality: 'repaired' as const,
        parentId: i.nodeId,
      };
    },
    'creation.answer': () => {},
    'creation.cancel': () => {},
    'campaigns.list': () => [campaign],
    'campaigns.create': () => campaign,
    'campaigns.load': () => ({ campaign, reports: [report], baselines }),
    'campaigns.update': () => campaign,
    'campaigns.clean': () => {},
    'campaigns.export': () => 'export de démonstration',
    'runs.start': () => report,
    'runs.cancel': () => {},
    'runs.current': () => report,
    'runs.analyze': () => {},
    'runs.screenshot': (i) => entries.find((e) => e.id === i.entryId)?.screenshot ?? null,
    'runs.compare': () => null,
    'runs.video': () => null,
    'runs.applyHealing': () => project,
    'replay.current': () => replay as never,
    'replay.select': (i) => {
      replay = i.frame;
      emit({ type: 'replay', projectId: i.projectId, frame: i.frame });
    },
    'recorder.start': () => {},
    'recorder.stop': () => [],
    'recorder.status': () => ({ running: false, steps: [] }),
    'recorder.discard': () => {},
    'workbench.pick': (p) => emit({ type: 'pick', picked: p }),
    'imports.pickFile': () => null,
    'updates.status': () => ({
      state: 'idle',
      currentVersion: '1.0.0',
      percent: 0,
      received: 0,
      total: 0,
      compatible: false,
    }),
    'updates.check': () => ({
      state: 'current',
      currentVersion: '1.0.0',
      percent: 0,
      received: 0,
      total: 0,
      compatible: false,
    }),
    'updates.download': () => ({
      state: 'idle',
      currentVersion: '1.0.0',
      percent: 0,
      received: 0,
      total: 0,
      compatible: false,
    }),
    'updates.install': () => {},
    'updates.release': () => {},
  };
  void importCases;
  return {
    async call(channel, input) {
      const handler = handlers[channel] as ((i: unknown) => unknown) | undefined;
      if (!handler) throw new Error('Not available in browser preview: ' + channel);
      const result = await handler(input);
      if (channel === 'projects.update' || channel === 'settings.save')
        setTimeout(() => emit({ type: 'workspace' }), 0);
      return structuredClone(result) as never;
    },
    onEvent(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
}
