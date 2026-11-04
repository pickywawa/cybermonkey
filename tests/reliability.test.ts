import test from 'node:test';
import assert from 'node:assert/strict';
import { DeviceRun } from '../src/main/engine/execution/device-run.js';
import { StepError } from '../src/main/infra/appium/operations.js';
import type { DeviceContext } from '../src/main/engine/device-context.js';
import type { CampaignDetail, RunEntry, RunReport } from '../src/shared/domain/report.js';
import {
  makeNode,
  makeVariant,
  type ScenarioNode,
  type Variant,
} from '../src/shared/domain/scenario.js';
import { stabilityOf, unstableSteps } from '../src/shared/domain/stability.js';
import {
  reviewLocator,
  suggestIdentifier,
  howToAddIdentifier,
} from '../src/shared/domain/selectors.js';
import { pendingRepairs } from '../src/shared/domain/repairs.js';

const L = (value: string, using: 'accessibility id' | 'id' | 'xpath' = 'accessibility id') => ({
  using,
  value,
});
const step = (
  name: string,
  locator: string,
  kind: 'action' | 'test' = 'action',
  op?: Variant['operation'],
) => {
  const n = makeNode(kind, name, ['ios']);
  n.variants.ios = makeVariant({
    operation: op ?? (kind === 'test' ? 'assert' : 'tap'),
    locator: L(locator),
    timeoutMs: 9000,
  });
  return n;
};
const scenario = (children: ScenarioNode[]) => ({ ...makeNode('scenario', 'S', []), children });

async function play(
  root: ScenarioNode,
  script: (v: Variant, attempt: number) => void,
  retry = true,
  overrides: Partial<DeviceContext> = {},
  extra: {
    video?: boolean;
    saveVideo?: (id: string, v: string) => Promise<string>;
    nodes?: ScenarioNode[];
    mode?: 'off' | 'rules' | 'smart';
    advisor?: unknown;
    application?: string;
  } = {},
) {
  const attempts = new Map<string, number>();
  const timeouts: number[] = [];
  const ctx: DeviceContext = {
    deviceId: 'd',
    platform: 'ios',
    owner: 'r',
    signal: new AbortController().signal,
    async perform(v) {
      const key = v.locator?.value ?? v.operation;
      const n = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, n);
      timeouts.push(v.timeoutMs);
      script(v, n);
    },
    setVariables() {},
    clearVariables() {},
    inspect: async () => ({ deviceId: 'd', components: [], width: 1, height: 1, capturedAt: '' }),
    markersPresent: async () => true,
    screenshot: async () => undefined,
    deviceLog: async () => ({ entries: [] }),
    appState: async () => 4,
    alertInfo: async () => null,
    startRecording: async () => false,
    stopRecording: async () => undefined,
    ensureApplication: async () => {},
    ...overrides,
  };
  const report: RunReport = {
    id: 'r',
    projectId: 'p',
    startedAt: new Date().toISOString(),
    status: 'running',
    entries: [],
    snapshot: [root],
  };
  await new DeviceRun({
    report,
    ctx,
    abort: new AbortController(),
    allNodes: extra.nodes ?? [root],
    settings: () =>
      ({
        executionProof: 'failures',
        analysisMode: 'off',
        healing: 'off',
        executionPreparation: 'off',
        retryFailedSteps: retry,
        interruptionMode: extra.mode ?? 'smart',
        executionVideo: extra.video ? 'failures' : 'off',
        creationTimeoutMinutes: 1,
      }) as never,
    t: ((fr: string) => fr) as never,
    publish: () => {},
    saveCapture: async () => '',
    restartApplication: false,
    saveVideo: extra.saveVideo,
    advisor: extra.advisor as never,
    application: extra.application,
    analyzer: { failureScreens: new Map() } as never,
    startAnalysis: () => {},
  }).run([root]);
  return { report, attempts, timeouts };
}
const entryOf = (r: RunReport, name: string) => r.entries.find((e) => e.nodeName === name)!;
const missing = () => {
  throw new StepError('missing', 'Composant introuvable');
};

test('a step whose component was not there is replayed once; passing the second time marks it unstable', async () => {
  const { report, attempts, timeouts } = await play(
    scenario([step('Valider', 'ok')]),
    (_v, n) => n === 1 && missing(),
  );
  const e = entryOf(report, 'Valider');
  assert.equal(e.status, 'passed');
  assert.equal(e.flaky, true);
  assert.equal(e.retried, true);
  assert.match(e.message, /2e essai \(instable\)/);
  assert.equal(attempts.get('ok'), 2);
  assert.deepEqual(timeouts, [9000, 4000]); // the second attempt is short
});

test('checks are replayed too, and two failures are reported as such', async () => {
  const flaky = await play(scenario([step('Titre', 'title', 'test')]), (_v, n) => {
    if (n === 1) throw new StepError('assertion', 'Texte attendu « A », obtenu « B »');
  });
  assert.equal(entryOf(flaky.report, 'Titre').flaky, true);
  const broken = await play(scenario([step('Titre', 'title', 'test')]), () => {
    throw new StepError('assertion', 'Texte attendu « A », obtenu « B »');
  });
  const e = entryOf(broken.report, 'Titre');
  assert.equal(e.status, 'failed');
  assert.match(e.message, /après 2 essais/);
  assert.equal(broken.attempts.get('title'), 2);
});

test('nothing is replayed when it could duplicate an effect or hide a real problem', async () => {
  // a device problem
  const device = await play(scenario([step('A', 'a')]), () => {
    throw new StepError('device', 'Session perdue');
  });
  assert.equal(device.attempts.get('a'), 1);
  // an error that may have happened mid-gesture (not a StepError)
  const raw = await play(scenario([step('B', 'b')]), () => {
    throw new Error('stale element reference');
  });
  assert.equal(raw.attempts.get('b'), 1);
  // scrolling and links have effects we cannot see
  const scroll = await play(scenario([step('C', 'c', 'action', 'scroll')]), missing);
  assert.equal(scroll.attempts.get('c'), 1);
  // switched off
  const off = await play(scenario([step('D', 'd')]), missing, false);
  assert.equal(off.attempts.get('d'), 1);
  assert.equal(entryOf(off.report, 'D').status, 'failed');
});

const entry = (
  nodeId: string,
  status: 'passed' | 'failed',
  extra: Partial<RunEntry> = {},
): RunEntry => ({
  id: crypto.randomUUID(),
  nodeId,
  nodeName: nodeId,
  kind: 'test',
  deviceId: 'd',
  platform: 'ios',
  status,
  message: '',
  startedAt: '',
  ...extra,
});
const history = (rows: Record<string, ('p' | 'f' | 'r')[]>): CampaignDetail => {
  const n = Math.max(...Object.values(rows).map((r) => r.length));
  return {
    campaign: {} as never,
    reports: Array.from({ length: n }, (_, i) => ({
      id: 'r' + i,
      projectId: 'p',
      startedAt: String(1000 + i),
      status: 'passed',
      snapshot: [],
      entries: Object.entries(rows)
        .filter(([, r]) => r[i])
        .map(([id, r]) =>
          entry(id, r[i] === 'f' ? 'failed' : 'passed', r[i] === 'r' ? { flaky: true } : {}),
        ),
    })) as never,
  };
};
test('step history tells a fragile test from a regression', () => {
  const list = stabilityOf([
    history({
      solid: ['p', 'p', 'p', 'p'],
      shaky: ['p', 'f', 'p', 'p', 'f', 'p'],
      broke: ['p', 'p', 'p', 'f', 'f'],
      once: ['p', 'p', 'p', 'f'],
      dead: ['f', 'f', 'f'],
      retried: ['p', 'r', 'p'],
      fresh: ['p'],
    }),
  ]);
  const verdict = (id: string) => list.find((s) => s.nodeId === id)!.verdict;
  assert.equal(verdict('solid'), 'stable');
  assert.equal(verdict('shaky'), 'flaky');
  assert.equal(verdict('broke'), 'regression');
  assert.equal(verdict('once'), 'first-failure');
  assert.equal(verdict('dead'), 'always-failing');
  assert.equal(verdict('retried'), 'flaky');
  assert.equal(verdict('fresh'), 'new');
  const shaky = list.find((s) => s.nodeId === 'shaky')!;
  assert.equal(shaky.passRate, 0.67);
  assert.deepEqual(
    unstableSteps(list).map((s) => s.nodeId),
    ['shaky', 'retried'],
  );
  // history older than the window is forgotten: an old failure does not taint a recovered step
  const recovered = stabilityOf([history({ x: ['f', 'f', ...Array(10).fill('p')] })], 10)[0];
  assert.equal(recovered.verdict, 'stable');
  // history spans several campaigns, oldest first
  const merged = stabilityOf([history({ m: ['p', 'p'] }), history({ m: ['f', 'f'] })]);
  assert.equal(merged[0].runs, 4);
});

test('selector durability: identifiers last, displayed text and positions do not', () => {
  assert.equal(reviewLocator(L('login_button')).quality, 'durable');
  assert.equal(reviewLocator(L('loginButton')).quality, 'durable');
  assert.equal(reviewLocator(L('com.acme:id/login', 'id')).quality, 'durable');
  assert.equal(reviewLocator(L('Me connecter')).quality, 'fair');
  assert.equal(reviewLocator(L('//XCUIElementTypeButton[3]', 'xpath')).quality, 'fragile');
  assert.equal(reviewLocator(L('//*[@text="OK"]', 'xpath')).quality, 'fragile');
  assert.equal(reviewLocator(L('//*[@resource-id="login"]', 'xpath')).quality, 'fair');
  assert.equal(reviewLocator(undefined, true).quality, 'position');
  assert.equal(
    suggestIdentifier('Appuyer sur « Me connecter »', 'Bouton Me connecter'),
    'bouton_me_connecter',
  );
  assert.equal(suggestIdentifier('Écran d’accueil'), 'ecran_d_accueil');
  assert.match(howToAddIdentifier('ios', 'x'), /accessibilityIdentifier/);
  assert.match(howToAddIdentifier('android', 'x'), /testTag/);
});

test('repairs not yet in the scenario are listed once per step, latest first-class', () => {
  const node = step('Valider', 'ok');
  const healed = (id: string, applied = false, status: 'passed' | 'failed' = 'passed') =>
    entry(node.id, status, {
      id,
      healing: { from: L('old'), to: L('new'), reason: 'moved', applied },
    });
  const detail = {
    campaign: {} as never,
    reports: [
      { id: 'r1', entries: [healed('e1')] },
      { id: 'r2', entries: [healed('e2')] },
    ],
  } as unknown as CampaignDetail;
  const project = { nodes: [scenario([node])] };
  const pending = pendingRepairs(detail, project as never);
  assert.deepEqual(
    pending.map((p) => p.entry.id),
    ['e2'],
  );
  assert.deepEqual(
    pendingRepairs(
      { ...detail, reports: [{ id: 'r', entries: [healed('e3', true)] }] } as never,
      project as never,
    ),
    [],
  );
  assert.deepEqual(
    pendingRepairs(
      { ...detail, reports: [{ id: 'r', entries: [healed('e4', false, 'failed')] }] } as never,
      project as never,
    ),
    [],
  );
  assert.deepEqual(pendingRepairs(detail, { nodes: [] }), []);
});

const nav = (timeoutMs = 300) => {
  const n = makeNode('navigation', 'Ouvrir', ['ios']);
  n.variants.ios = makeVariant({ operation: 'tap', locator: L('Me connecter'), timeoutMs });
  n.screen = { id: 'auth', name: 'Auth', variants: { ios: { markers: [L('Authentification')] } } };
  return n;
};
const screenOf = (labels: [string, string?][]) =>
  ({
    deviceId: 'd',
    width: 1,
    height: 1,
    capturedAt: '',
    components: labels.map(([value, text = '']) => ({
      id: value,
      type: 'Button',
      label: value,
      text,
      enabled: true,
      interactive: true,
      locator: L(value),
    })),
  }) as never;

test('a tap lost on an idle screen is repeated once; the destination is then confirmed and the step marked unstable', async () => {
  let taps = 0;
  const idle = screenOf([['Me connecter']]);
  const { report } = await play(
    scenario([nav()]),
    (v) => v.operation === 'tap' && void taps++,
    true,
    {
      markersPresent: async () => taps >= 2,
      inspect: async () => idle,
    },
  );
  const e = entryOf(report, 'Ouvrir');
  assert.equal(taps, 2);
  assert.equal(e.status, 'passed');
  assert.equal(e.flaky, true);
});

test('no second tap while the app shows any sign of activity (a spinner, a changing screen)', async () => {
  let taps = 0;
  let n = 0;
  const { report } = await play(
    scenario([nav()]),
    (v) => v.operation === 'tap' && void taps++,
    true,
    {
      markersPresent: async () => false,
      inspect: async () => screenOf([['Me connecter'], ['spinner', String(n++)]]),
    },
  );
  assert.equal(taps, 1);
  assert.equal(entryOf(report, 'Ouvrir').status, 'failed');
  assert.match(entryOf(report, 'Ouvrir').message, /Écran destination non confirmé/);
});

test('no second tap when the tapped component is gone', async () => {
  let taps = 0;
  const gone = await play(scenario([nav()]), (v) => v.operation === 'tap' && void taps++, true, {
    markersPresent: async () => false,
    inspect: async () => screenOf([['Autre']]),
  });
  assert.equal(taps, 1);
  assert.equal(entryOf(gone.report, 'Ouvrir').status, 'failed');
});

test('the screen recording is kept only for a scenario that failed, and points at the failing step', async () => {
  const saved: string[] = [];
  const recorder = (log: string[]) => ({
    startRecording: async () => (log.push('start'), true),
    stopRecording: async () => (log.push('stop'), 'AAAA'.repeat(40)),
  });
  const failLog: string[] = [];
  const failing = await play(scenario([step('Valider', 'ok')]), missing, false, recorder(failLog), {
    video: true,
    saveVideo: async (id, v) => (saved.push(id + ':' + v.length), 'video:r-' + id + '.mp4'),
  });
  assert.deepEqual(failLog, ['start', 'stop']);
  assert.equal(saved.length, 1);
  const failedEntry = entryOf(failing.report, 'Valider');
  assert.match(failedEntry.video!, /^video:/);
  assert.equal(typeof failedEntry.videoAt, 'number');
  assert.match(failing.report.entries.find((e) => e.kind === 'scenario')!.video!, /^video:/);

  const passLog: string[] = [];
  const passing = await play(
    scenario([step('Valider', 'ok')]),
    () => {},
    false,
    recorder(passLog),
    {
      video: true,
      saveVideo: async () => assert.fail('a passing scenario must not keep its video'),
    },
  );
  assert.deepEqual(passLog, ['start', 'stop']); // filmed, then dropped
  assert.equal(entryOf(passing.report, 'Valider').video, undefined);

  // switched off, or a device that cannot record: nothing changes for the run
  const off: string[] = [];
  await play(scenario([step('A', 'a')]), missing, false, recorder(off), { video: false });
  assert.deepEqual(off, []);
  const none = await play(
    scenario([step('B', 'b')]),
    missing,
    false,
    { startRecording: async () => false },
    {
      video: true,
      saveVideo: async () => assert.fail('nothing was recorded'),
    },
  );
  assert.equal(entryOf(none.report, 'B').status, 'failed');
  assert.equal(entryOf(none.report, 'B').video, undefined);
  // a video that cannot be written never turns into a run error
  const broken = await play(scenario([step('C', 'c')]), missing, false, recorder([]), {
    video: true,
    saveVideo: async () => {
      throw new Error('disk full');
    },
  });
  assert.equal(entryOf(broken.report, 'C').status, 'failed');
  assert.equal(entryOf(broken.report, 'C').video, undefined);
});

/* ---------- interruptions ---------- */
import { decideAlert } from '../src/main/engine/execution/interruptions.js';

const popupScreen = (...labels: string[]) => screenOf(labels.map((l) => [l] as [string]));
const handlerScenario = (
  name: string,
  marker: string,
  steps: ScenarioNode[],
  resume: 'retry' | 'return' = 'retry',
): ScenarioNode => ({
  ...makeNode('scenario', name, []),
  children: steps,
  handler: {
    when: { id: 'h-' + name, name, variants: { ios: { markers: [L(marker)] } } },
    resume,
    maxPerRun: 5,
  },
});

test('a popup in the way is closed by its handler, then the failed step is replayed and passes', async () => {
  const ok = step('Fermer', 'ok-button');
  const popup = handlerScenario('Popup session', 'Session expirée', [ok]);
  const main = scenario([step('Valider', 'validate')]);
  let dismissed = false;
  const { report } = await play(
    main,
    (v) => {
      if (v.locator?.value === 'validate' && !dismissed) missing();
      if (v.locator?.value === 'ok-button') dismissed = true;
    },
    false,
    {
      inspect: async () =>
        dismissed ? popupScreen('Accueil') : popupScreen('Session expirée', 'ok-button'),
    },
    { nodes: [main, popup] },
  );
  const e = entryOf(report, 'Valider');
  assert.equal(e.status, 'passed');
  assert.equal(e.interruptions?.[0].kind, 'handler');
  assert.equal(e.interruptions?.[0].name, 'Popup session');
  assert.match(e.message, /imprévu géré : Popup session/);
  // the handler's own steps are reported, tagged, and never count as results
  const inHandler = report.entries.filter((x) => x.interruption === 'Popup session');
  assert.ok(inHandler.length >= 2);
  assert.equal(entryOf(report, 'Fermer').interruption, 'Popup session');
});

test('handlers chain: popup, then the login screen it leads to', async () => {
  const popup = handlerScenario('Popup session', 'Session expirée', [step('OK', 'ok')]);
  const login = handlerScenario(
    'Reconnexion',
    'Connexion',
    [step('Se reconnecter', 'login')],
    'retry',
  );
  const main = scenario([step('Ouvrir', 'open')]);
  const done = new Set<string>();
  const { report } = await play(
    main,
    (v) => {
      const id = v.locator?.value ?? '';
      if (id === 'open' && !done.has('login')) missing();
      done.add(id);
    },
    false,
    {
      inspect: async () =>
        done.has('login')
          ? popupScreen('Accueil')
          : done.has('ok')
            ? popupScreen('Connexion')
            : popupScreen('Session expirée'),
    },
    { nodes: [main, popup, login] },
  );
  const e = entryOf(report, 'Ouvrir');
  assert.equal(e.status, 'passed');
  assert.deepEqual(
    e.interruptions?.map((i) => i.name),
    ['Popup session', 'Reconnexion'],
  );
});

test('nothing matches: the step fails with its own message and nothing was touched', async () => {
  const main = scenario([step('Valider', 'validate')]);
  const popup = handlerScenario('Popup session', 'Session expirée', [step('OK', 'ok')]);
  const { report, attempts } = await play(
    main,
    missing,
    false,
    { inspect: async () => popupScreen('Autre') },
    { nodes: [main, popup] },
  );
  const e = entryOf(report, 'Valider');
  assert.equal(e.status, 'failed');
  assert.match(e.message, /Composant introuvable/);
  assert.equal(e.interruptions, undefined);
  assert.equal(attempts.get('ok'), undefined);
});

test('a handler that comes back in a loop is stopped; and handlers never trigger handlers', async () => {
  const bad = step('Casse', 'broken');
  const popup = handlerScenario('Popup', 'Pop', [bad]);
  popup.handler!.maxPerRun = 2;
  const main = scenario([step('Valider', 'validate')]);
  const { report, attempts } = await play(
    main,
    (v) => {
      if (['validate', 'broken'].includes(v.locator?.value ?? '')) missing();
    },
    false,
    { inspect: async () => popupScreen('Pop') },
    { nodes: [main, popup] },
  );
  assert.equal(entryOf(report, 'Valider').status, 'failed');
  assert.ok((attempts.get('broken') ?? 0) <= 2);
  // the failing handler step did not start another handler (it would have looped)
  assert.ok(report.entries.filter((x) => x.interruption).length <= 4);
});

test('the app was closed or crashed: it is relaunched, then the step is replayed', async () => {
  let state = 1;
  const launched: boolean[] = [];
  const main = scenario([step('Valider', 'validate')]);
  const { report } = await play(
    main,
    (v) => {
      if (v.locator?.value === 'validate' && state !== 4) missing();
    },
    false,
    {
      appState: async () => state,
      ensureApplication: async (_a, restart) => {
        launched.push(restart);
        // the first call is the run's own start-up; the app then dies, and only the guard's relaunch brings it back
        if (launched.length > 1) state = 4;
      },
      inspect: async () => popupScreen('Accueil'),
    },
    { application: 'com.acme' },
  );
  assert.deepEqual(launched.slice(-1), [false]);
  const e = entryOf(report, 'Valider');
  assert.equal(e.status, 'passed');
  assert.equal(e.interruptions?.[0].kind, 'app-gone');
});

test('a system dialog is answered (permissions allowed), the AI decides the unclear ones, destructive buttons are never pressed', async () => {
  assert.deepEqual(
    decideAlert('« App » souhaite accéder à votre position', [
      'Ne pas autoriser',
      'Autoriser pendant l’utilisation',
    ]),
    { press: 'Autoriser pendant l’utilisation' },
  );
  assert.deepEqual(
    decideAlert('“App” would like to send you notifications', ['Don’t Allow', 'Allow']),
    { press: 'Allow' },
  );
  assert.deepEqual(
    decideAlert('“App” would like to track your activity', ['Ask App Not to Track', 'Allow']),
    { press: 'Ask App Not to Track' },
  );
  assert.deepEqual(decideAlert('Votre session a expiré', ['OK']), { press: 'OK' });
  assert.deepEqual(decideAlert('Supprimer ce compte ?', ['Annuler', 'Supprimer']), {
    press: 'Annuler',
  });
  assert.deepEqual(decideAlert('Quitter ?', ['Quitter', 'Se déconnecter']), { unknown: true });
  assert.deepEqual(decideAlert('Autoriser la localisation ?', []), { unknown: true });

  let answered = '';
  let alert: { text: string; buttons: string[] } | null = {
    text: 'Voulez-vous activer le mode sombre ?',
    buttons: ['Plus tard', 'Activer'],
  };
  const main = scenario([step('Valider', 'validate')]);
  const { report } = await play(
    main,
    (v) => {
      if (v.operation === 'alert') {
        answered = v.value;
        alert = null;
      }
      if (v.locator?.value === 'validate' && alert) missing();
    },
    false,
    { alertInfo: async () => alert, inspect: async () => popupScreen('Accueil') },
  );
  assert.equal(answered, 'Plus tard');
  const e = entryOf(report, 'Valider');
  assert.equal(e.status, 'passed');
  assert.equal(e.interruptions?.[0].kind, 'system-alert');
});

test('last resort: the AI closes an unexpected popup, never a risky button, and only when something is really in the way', async () => {
  const calls: string[] = [];
  const advisor = {
    alertButton: async () => null,
    interruption: async (i: { error: string }) => {
      calls.push(i.error);
      return { kind: 'popup', componentId: 'later', handler: null, summary: 'Popup de notation' };
    },
  };
  let closed = false;
  const main = scenario([step('Valider', 'validate')]);
  const screen = () => (closed ? popupScreen('Accueil') : popupScreen('later', 'Noter l’app'));
  const run = (mode: 'smart' | 'rules') =>
    play(
      main,
      (v) => {
        if (v.locator?.value === 'later') closed = true;
        if (v.locator?.value === 'validate' && !closed) missing();
      },
      false,
      { inspect: async () => screen() },
      { advisor, mode },
    );
  const smart = await run('smart');
  assert.equal(entryOf(smart.report, 'Valider').status, 'passed');
  assert.equal(entryOf(smart.report, 'Valider').interruptions?.[0].kind, 'ai-dismiss');
  closed = false;
  calls.length = 0;
  const rules = await run('rules');
  assert.equal(entryOf(rules.report, 'Valider').status, 'failed'); // the AI is not consulted in "rules" mode
  assert.deepEqual(calls, []);
  closed = false;
  const off = await run('smart').then(() =>
    play(main, missing, false, { inspect: async () => screen() }, { advisor, mode: 'off' }),
  );
  assert.equal(entryOf(off.report, 'Valider').status, 'failed');
  // a risky button chosen by the AI is refused
  const risky = {
    ...advisor,
    interruption: async () => ({
      kind: 'popup',
      componentId: 'Supprimer le compte',
      handler: null,
      summary: 'x',
    }),
  };
  const refused = await play(
    main,
    missing,
    false,
    { inspect: async () => popupScreen('Supprimer le compte') },
    { advisor: risky },
  );
  assert.equal(entryOf(refused.report, 'Valider').status, 'failed');
  assert.equal(refused.attempts.get('Supprimer le compte'), undefined);
});
