import test from 'node:test';
import assert from 'node:assert/strict';
import { DeviceRun } from '../src/main/engine/execution/device-run.js';
import { StepError } from '../src/main/infra/appium/operations.js';
import { deviceContext, type DeviceContext } from '../src/main/engine/device-context.js';
import type { RunReport } from '../src/shared/domain/report.js';
import { latestOutcomes } from '../src/shared/domain/campaign.js';
import {
  makeNode,
  makeVariant,
  validateTree,
  coverage,
  type OS,
  type ScenarioNode,
  type Variant,
} from '../src/shared/domain/scenario.js';
import { parseDataset } from '../src/shared/domain/dataset.js';
import { resolveVariables } from '../src/shared/domain/variables.js';

const tr = ((fr: string) => fr) as never;
const step = (name: string, locator: string, kind: 'action' | 'test' = 'action') => {
  const n = makeNode(kind, name, ['android', 'ios']);
  for (const os of ['android', 'ios'] as const)
    n.variants[os] = makeVariant({
      operation: kind === 'test' ? 'assert' : 'tap',
      locator: { using: 'accessibility id', value: locator },
    });
  return n;
};
const scenario = (name: string, children: ScenarioNode[]) => ({
  ...makeNode('scenario', name, []),
  children,
});

/** A fake device: a step on a locator listed in `absent` fails like a missing component; `texts` feeds capture. */
function harness(options: { absent?: string[]; texts?: Record<string, string> } = {}) {
  const performed: string[] = [];
  const vars: Record<string, string> = {};
  const restarts: boolean[] = [];
  const ctx: DeviceContext = {
    deviceId: 'dev',
    platform: 'ios',
    owner: 'run',
    signal: new AbortController().signal,
    async perform(variant: Variant) {
      const id = variant.locator?.value ?? variant.operation;
      performed.push(`${variant.operation}:${id}`);
      if (options.absent?.includes(id)) throw new StepError('missing', 'Composant introuvable');
      if (variant.operation === 'capture') {
        const text = options.texts?.[id] ?? '';
        vars[variant.value] = text;
        return text;
      }
    },
    setVariables: (v) => void Object.assign(vars, v),
    clearVariables: () => void Object.keys(vars).forEach((k) => delete vars[k]),
    inspect: async () => ({ deviceId: 'dev', components: [], width: 1, height: 1, capturedAt: '' }),
    markersPresent: async () => true,
    screenshot: async () => undefined,
    deviceLog: async () => ({ entries: [] }),
    appState: async () => 4,
    alertInfo: async () => null,
    startRecording: async () => false,
    stopRecording: async () => undefined,
    ensureApplication: async (_a, restart) => void restarts.push(restart),
  };
  return { ctx, performed, vars, restarts };
}
async function play(roots: ScenarioNode[], h: ReturnType<typeof harness>, all = roots) {
  const report: RunReport = {
    id: 'r',
    projectId: 'p',
    startedAt: new Date().toISOString(),
    status: 'running',
    entries: [],
    snapshot: roots,
  };
  const run = new DeviceRun({
    report,
    ctx: h.ctx,
    abort: new AbortController(),
    allNodes: all,
    settings: () =>
      ({
        executionProof: 'none',
        analysisMode: 'off',
        healing: 'off',
        executionPreparation: 'off',
        creationTimeoutMinutes: 1,
      }) as never,
    t: tr,
    publish: () => {},
    saveCapture: async () => '',
    application: 'com.acme',
    restartApplication: false,
    analyzer: { failureScreens: new Map() } as never,
    startAnalysis: () => {},
  });
  await run.run(roots);
  return report;
}
const status = (r: RunReport, name: string) =>
  r.entries.filter((e) => e.nodeName === name).map((e) => e.status);

test('a condition that is not met skips the step and its children without failing the run', async () => {
  const close = step('Fermer la bannière', 'close');
  close.when = {
    ios: makeVariant({
      operation: 'assert',
      assertion: 'visible',
      locator: { using: 'id', value: 'banner' },
      timeoutMs: 100,
    }),
  };
  close.children = [step('Enfant', 'child')];
  const after = step('Suite', 'next');
  const h = harness({ absent: ['banner'] });
  const r = await play([scenario('S', [close, after])], h);
  assert.deepEqual(status(r, 'Fermer la bannière'), ['skipped']);
  assert.match(
    r.entries.find((e) => e.nodeName === 'Fermer la bannière')!.message,
    /Condition non remplie/,
  );
  assert.deepEqual(status(r, 'Enfant'), ['skipped']);
  assert.deepEqual(status(r, 'Suite'), ['passed']);
  assert.ok(!h.performed.includes('tap:close'));
  assert.ok(!r.entries.some((e) => e.status === 'failed'));
});

test('a met condition runs the step; a condition missing for this OS is a gap, not a pass', async () => {
  const close = step('Fermer', 'close');
  close.when = {
    ios: makeVariant({
      operation: 'assert',
      locator: { using: 'id', value: 'banner' },
      timeoutMs: 100,
    }),
  };
  const h = harness();
  const r = await play([scenario('S', [close])], h);
  assert.deepEqual(status(r, 'Fermer'), ['passed']);
  assert.deepEqual(h.performed, ['assert:banner', 'tap:close']);

  const onlyAndroid = step('Fermer 2', 'close2');
  onlyAndroid.when = {
    android: makeVariant({ operation: 'assert', locator: { using: 'id', value: 'banner' } }),
  };
  const r2 = await play([scenario('S2', [onlyAndroid])], harness());
  assert.deepEqual(status(r2, 'Fermer 2'), ['skipped']);
  assert.match(r2.entries.find((e) => e.nodeName === 'Fermer 2')!.message, /à compléter/);
});

test('a broken condition (device error) fails the step instead of hiding a problem', async () => {
  const s = step('Fermer', 'close');
  s.when = { ios: makeVariant({ operation: 'assert', locator: { using: 'id', value: 'banner' } }) };
  const h = harness();
  h.ctx.perform = async () => {
    throw new StepError('device', 'Session perdue');
  };
  const r = await play([scenario('S', [s])], h);
  assert.deepEqual(status(r, 'Fermer'), ['failed']);
});

test('calling a scenario runs its steps in place, with their own results', async () => {
  const login = scenario('Se connecter', [step('Saisir login', 'login'), step('Valider', 'ok')]);
  const call = { ...makeNode('action', 'Connexion', []), call: login.id };
  const main = scenario('Commande', [call, step('Acheter', 'buy')]);
  const h = harness();
  const r = await play([main], h, [login, main]);
  assert.deepEqual(h.performed, ['tap:login', 'tap:ok', 'tap:buy']);
  assert.deepEqual(status(r, 'Connexion'), ['passed']);
  assert.deepEqual(status(r, 'Saisir login'), ['passed']);
  // a failure inside the called scenario fails the call, and the caller notices
  const h2 = harness({ absent: ['ok'] });
  const r2 = await play([main], h2, [login, main]);
  assert.deepEqual(status(r2, 'Valider'), ['failed']);
  assert.deepEqual(status(r2, 'Connexion'), ['failed']);
});

test('a missing sub-scenario is reported, never silently skipped', async () => {
  const call = { ...makeNode('action', 'Connexion', []), call: 'gone' };
  const r = await play([scenario('S', [call])], harness());
  assert.deepEqual(status(r, 'Connexion'), ['failed']);
  assert.match(r.entries.find((e) => e.nodeName === 'Connexion')!.message, /introuvable/);
});

test('a dataset plays the scenario once per row with the columns as variables, restarting the app in between', async () => {
  const s = scenario('Comptes', [step('Saisir', 'login')]);
  s.dataset = {
    rows: [
      { LOGIN: 'ana', LANG: 'fr' },
      { LOGIN: 'bob', LANG: 'en' },
      { LOGIN: 'cy', LANG: 'de' },
    ],
  };
  const seen: string[] = [];
  const h = harness();
  const base = h.ctx.perform;
  h.ctx.perform = async (v, k) => (seen.push(h.vars.LOGIN), base(v, k));
  const r = await play([s], h);
  assert.deepEqual(seen, ['ana', 'bob', 'cy']);
  assert.deepEqual(h.restarts, [false, true, true]);
  const rows = r.entries.filter((e) => e.nodeName === 'Saisir');
  assert.deepEqual(
    rows.map((e) => e.iteration?.index),
    [1, 2, 3],
  );
  assert.equal(rows[0].iteration?.label, 'LOGIN=ana, LANG=fr');
  assert.deepEqual(h.vars, {}); // cleaned afterwards
});

test('with a dataset, one failing row keeps the step failed in the campaign even if the last row passes', async () => {
  const s = scenario('Comptes', [step('Saisir', 'login')]);
  s.dataset = { rows: [{ A: '1' }, { A: '2' }] };
  const h = harness();
  const base = h.ctx.perform;
  let n = 0;
  h.ctx.perform = async (v, k) => {
    if (v.locator?.value === 'login' && ++n === 1) throw new StepError('missing', 'introuvable');
    return base(v, k);
  };
  const r = await play([s], h);
  assert.deepEqual(
    r.entries.filter((e) => e.nodeName === 'Saisir').map((e) => e.status),
    ['failed', 'passed'],
  );
  const latest = latestOutcomes({ campaign: {} as never, reports: [{ ...r, entries: r.entries }] });
  assert.equal(latest.get('ios:' + s.children[0].id), 'failed');
});

test('capture stores the text for the next steps and shows it in the report', async () => {
  const cap = step('Lire le numéro', 'orderNumber');
  cap.variants.ios = makeVariant({
    operation: 'capture',
    locator: { using: 'id', value: 'orderNumber' },
    value: 'ORDER',
  });
  const h = harness({ texts: { orderNumber: '4821' } });
  const r = await play([scenario('S', [cap])], h);
  assert.equal(h.vars.ORDER, '4821');
  assert.match(r.entries.find((e) => e.nodeName === 'Lire le numéro')!.message, /ORDER = « 4821 »/);
  assert.equal(resolveVariables('/orders/${ORDER}', { ...h.vars }), '/orders/4821');
});

test('the device context layers captured values over project variables and returns them to the next call', async () => {
  const calls: Record<string, string>[] = [];
  const automation = {
    perform: async (
      _i: string,
      v: Variant,
      _k: string,
      _o: unknown,
      _s: unknown,
      vars: Record<string, string>,
    ) => {
      calls.push(vars);
      return v.operation === 'capture' ? '77' : undefined;
    },
  };
  const devices = { known: new Map([['d', { platform: 'ios' as OS }]]) };
  const ctx = deviceContext(
    automation as never,
    devices as never,
    'd',
    'o',
    new AbortController().signal,
    () => ({ BASE: 'x' }),
  );
  await ctx.perform(
    makeVariant({ operation: 'capture', value: 'CODE', locator: { using: 'id', value: 'c' } }),
    'action',
  );
  await ctx.perform(makeVariant({ operation: 'tap' }), 'action');
  assert.deepEqual(calls[1], { BASE: 'x', CODE: '77' });
  ctx.clearVariables();
  await ctx.perform(makeVariant({ operation: 'tap' }), 'action');
  assert.deepEqual(calls[2], { BASE: 'x' });
});

test('validation: calls must target a scenario and never loop; datasets belong to scenarios', () => {
  const a = scenario('A', []);
  const b = scenario('B', []);
  a.children = [{ ...makeNode('action', 'to B', []), call: b.id }];
  b.children = [{ ...makeNode('action', 'to A', []), call: a.id }];
  assert.throws(() => validateTree([a, b]), /circulaires/);
  b.children = [];
  validateTree([a, b]);
  a.children[0].call = 'ghost';
  assert.throws(() => validateTree([a, b]), /introuvable/);
  const bad = scenario('C', [step('x', 'x')]);
  bad.children[0].dataset = { rows: [{ A: '1' }] };
  assert.throws(() => validateTree([bad]), /jeu de données/);
  const withKids = { ...makeNode('action', 'call', []), call: b.id, children: [step('y', 'y')] };
  assert.throws(() => validateTree([scenario('D', [withKids]), b]), /sans enfants/);
  // a call needs no selector: it is never reported as a coverage gap
  assert.deepEqual(
    coverage({ ...makeNode('action', 'c', []), call: b.id }, ['android', 'ios']).missing,
    [],
  );
});

test('dataset text: columns from the first line, one row per line, bad input explained', () => {
  const ok = parseDataset('LOGIN;LANG\nana;fr\nbob;en');
  assert.deepEqual('rows' in ok && ok.rows, [
    { LOGIN: 'ana', LANG: 'fr' },
    { LOGIN: 'bob', LANG: 'en' },
  ]);
  const tab = parseDataset('A\tB\n1\t2');
  assert.deepEqual('rows' in tab && tab.rows, [{ A: '1', B: '2' }]);
  assert.deepEqual(parseDataset('LOGIN'), { error: 'logic.datasetNeedsRow' });
  assert.deepEqual(parseDataset('mon login;x\n1;2'), { error: 'logic.datasetBadColumn' });
  assert.deepEqual(parseDataset('A;A\n1;2'), { error: 'logic.datasetBadColumn' });
});

test('a handler can be saved before it says what it reacts to, but only on a scenario', () => {
  const draft = scenario('Popup', []);
  draft.handler = {
    when: { id: 'w', name: 'Popup', variants: {} },
    resume: 'return',
    maxPerRun: 5,
  };
  validateTree([draft]);
  const step2 = step('x', 'x');
  step2.handler = draft.handler;
  assert.throws(() => validateTree([scenario('S', [step2])]), /gestionnaire/);
});
