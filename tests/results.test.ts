import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildResults,
  latestResults,
  screenInventory,
  stateOf,
} from '../src/shared/domain/campaign.js';
import type { CampaignDetail, RunEntry, RunReport } from '../src/shared/domain/report.js';
import { makeNode, type ScenarioNode } from '../src/shared/domain/scenario.js';

const screen = (id: string, name = id) => ({ id, name, variants: {} }) as never;
const node = (
  kind: 'action' | 'test' | 'navigation',
  name: string,
  over: Partial<ScenarioNode> = {},
): ScenarioNode => ({
  ...makeNode(kind, name, ['android', 'ios']),
  ...over,
});
const scenario = (
  name: string,
  children: ScenarioNode[],
  over: Partial<ScenarioNode> = {},
): ScenarioNode => ({
  ...makeNode('scenario', name),
  children,
  ...over,
});

const login = node('navigation', 'Ouvrir la connexion', { screen: screen('login', 'Connexion') });
const typeUser = node('action', 'Saisir le login');
const loginOk = node('test', 'Bouton visible');
const home = node('navigation', 'Se connecter', { screen: screen('home', 'Accueil') });
const homeTitle = node('test', 'Titre affiché');
const androidOnly = node('test', 'Menu Android', { platforms: ['android'] });
const profile = node('navigation', 'Ouvrir le profil', { screen: screen('profile', 'Profil') });
const profileName = node('test', 'Nom affiché');
const s1 = scenario('Connexion', [login, typeUser, loginOk, home, homeTitle, androidOnly], {
  module: 'Compte',
});
const s2 = scenario('Profil', [profile, profileName], { module: 'Compte' });
const s3 = scenario('Libre', [node('action', 'Rien')]);
const handler = scenario('Popup', [node('action', 'Fermer')], {
  handler: { when: screen('x') as never, resume: 'return', maxPerRun: 1 } as never,
});
const project = { nodes: [s1, s2, s3, handler], platforms: ['android', 'ios'] as const };

let counter = 0;
const entry = (
  n: ScenarioNode,
  platform: 'android' | 'ios',
  status: RunEntry['status'],
  over: Partial<RunEntry> = {},
): RunEntry =>
  ({
    id: 'e' + ++counter,
    nodeId: n.id,
    nodeName: n.name,
    kind: n.kind,
    deviceId: 'd',
    platform,
    status,
    message: '',
    startedAt: '2026-01-01T00:00:00Z',
    finishedAt: '2026-01-01T00:00:01Z',
    completedAt: '2026-01-01T00:00:01Z',
    ...over,
  }) as RunEntry;
const report = (id: string, at: string, entries: RunEntry[]): RunReport => ({
  id,
  projectId: 'p',
  campaignId: 'c',
  startedAt: at,
  status: 'passed',
  entries,
  snapshot: project.nodes,
});
const detail = (...reports: RunReport[]): CampaignDetail => ({
  campaign: { id: 'c', projectId: 'p', label: 'C', createdAt: '', updatedAt: '', status: 'open' },
  reports,
});

test('results: one row per element, whatever the number of executions', () => {
  const first = report('r1', '2026-01-01T10:00', [
    entry(login, 'android', 'passed'),
    entry(loginOk, 'android', 'failed'),
    entry(loginOk, 'ios', 'passed'),
  ]);
  const second = report('r2', '2026-01-02T10:00', [
    entry(loginOk, 'android', 'passed'),
    entry(loginOk, 'android', 'passed'),
  ]);
  const once = buildResults(project, detail(first));
  const twice = buildResults(project, detail(first, second, second));
  const count = (r: ReturnType<typeof buildResults>) => r.scenarios.flatMap((s) => s.rows).length;
  assert.equal(count(once), 9, 'the project has nine elements (the handler is not one)');
  assert.equal(count(twice), 9);
  assert.equal(twice.totals.total, 17, 'element × OS pairs, however many runs');
  assert.equal(twice.scenarios.map((s) => s.scenario.name).join(), 'Connexion,Profil,Libre');
});

test('results: the last result wins, per element and OS', () => {
  const r1 = report('r1', '2026-01-01T10:00', [
    entry(loginOk, 'android', 'failed'),
    entry(loginOk, 'ios', 'passed'),
  ]);
  const r2 = report('r2', '2026-01-02T10:00', [entry(loginOk, 'android', 'passed')]);
  const latest = latestResults(detail(r1, r2));
  assert.equal(latest.get('android:' + loginOk.id)?.runId, 'r2');
  assert.equal(latest.get('android:' + loginOk.id)?.outcome, 'passed');
  assert.equal(latest.get('ios:' + loginOk.id)?.runId, 'r1', 'iOS was not rerun: its result stays');
  const row = buildResults(project, detail(r1, r2)).scenarios[0].rows.find(
    (r) => r.node.id === loginOk.id,
  )!;
  assert.deepEqual(row.states, { android: 'passed', ios: 'passed' });
  assert.equal(row.status, 'passed');
  const reverse = buildResults(project, detail(r2, r1)).scenarios[0].rows.find(
    (r) => r.node.id === loginOk.id,
  )!;
  assert.equal(
    reverse.results.android?.runId,
    'r2',
    'order of the reports in the file does not matter, their dates do',
  );
});

test('results: a step played once per dataset row counts as its worst row; ignored and engine entries do not count', () => {
  const rows = report('r1', '2026-01-01T10:00', [
    entry(typeUser, 'android', 'failed', { iteration: { index: 0, total: 2, label: 'a' } }),
    entry(typeUser, 'android', 'passed', { iteration: { index: 1, total: 2, label: 'b' } }),
    entry(typeUser, 'android', 'passed', { preparation: true }),
    { ...entry(typeUser, 'android', 'failed'), nodeId: 'engine' },
  ]);
  const latest = latestResults(detail(rows));
  assert.equal(latest.get('android:' + typeUser.id)?.outcome, 'failed');
  assert.equal(latest.size, 1);
});

test('results: an element is failed if any OS failed, passed only if all passed, pending while one OS was never run', () => {
  const r = report('r1', '2026-01-01T10:00', [
    entry(homeTitle, 'android', 'passed'),
    entry(homeTitle, 'ios', 'failed'),
    entry(profileName, 'android', 'passed'),
    entry(androidOnly, 'android', 'passed'),
    entry(typeUser, 'ios', 'skipped'),
  ]);
  const res = buildResults(project, detail(r));
  const row = (n: ScenarioNode) =>
    res.scenarios.flatMap((s) => s.rows).find((x) => x.node.id === n.id)!;
  assert.equal(row(homeTitle).status, 'failed');
  assert.equal(row(profileName).status, 'pending', 'iOS never ran it');
  assert.equal(row(androidOnly).status, 'passed', 'it only applies to Android');
  assert.deepEqual(row(androidOnly).oses, ['android']);
  assert.equal(stateOf(row(typeUser).results.ios), 'other');
  assert.equal(row(typeUser).status, 'pending');
  assert.equal(stateOf(undefined), 'pending');
});

test('results: success rates are per OS of the project and counts are per element', () => {
  const r = report('r1', '2026-01-01T10:00', [
    ...[login, typeUser, loginOk, home, homeTitle, androidOnly].map((n) =>
      entry(n, 'android', 'passed'),
    ),
    entry(login, 'ios', 'passed'),
    entry(typeUser, 'ios', 'failed'),
  ]);
  const res = buildResults(project, detail(r));
  assert.equal(res.byOs.android?.total, 9, 'every element applies to Android');
  assert.equal(res.byOs.ios?.total, 8, 'one element is Android only');
  assert.equal(res.byOs.android?.passed, 6);
  assert.equal(res.byOs.android?.rate, 67);
  assert.equal(res.byOs.ios?.passed, 1);
  assert.equal(res.byOs.ios?.failed, 1);
  assert.deepEqual(
    [res.totals.total, res.totals.passed, res.totals.failed, res.totals.remaining],
    [17, 7, 1, 9],
  );
  // Overall progress counts element × OS pairs: 6 Android + 1 iOS passed, 1 iOS failed, 9 not run yet.
  assert.equal(res.totals.rate, 41);
  assert.equal(res.totals.tested, 47);
  const sc = res.scenarios[0];
  assert.equal(sc.status, 'failed');
  assert.equal(res.scenarios[1].status, 'pending');
  const done = buildResults(
    project,
    detail(
      report('r', '2026-01-01', [
        ...s2.children.flatMap((n) => [entry(n, 'android', 'passed'), entry(n, 'ios', 'passed')]),
      ]),
    ),
  );
  assert.equal(done.scenarios[1].status, 'passed');
  const some = buildResults(
    project,
    detail(report('r', '2026-01-01', [entry(profile, 'android', 'passed')])),
  );
  assert.equal(some.scenarios[1].status, 'partial');
});

test('results: each element knows its screen, from the scenario’s own navigations, even before any run', () => {
  const res = buildResults(project, null);
  const names = res.scenarios[0].rows.map((r) => [r.node.name, r.screen?.name]);
  assert.deepEqual(names, [
    ['Ouvrir la connexion', 'Connexion'],
    ['Saisir le login', 'Connexion'],
    ['Bouton visible', 'Connexion'],
    ['Se connecter', 'Accueil'],
    ['Titre affiché', 'Accueil'],
    ['Menu Android', 'Accueil'],
  ]);
  assert.equal(res.scenarios[2].rows[0].screen, undefined, 'a scenario without screens: no screen');
  assert.equal(res.totals.passed, 0);
  assert.equal(res.totals.remaining, 17);
});

test('screens: a screen is valid when every check on it passed; without a check it says so', () => {
  const r = report('r1', '2026-01-01T10:00', [
    entry(loginOk, 'android', 'passed', {
      screenshot: 'login.png',
      completedAt: '2026-01-01T10:00:05Z',
    }),
    entry(loginOk, 'ios', 'passed'),
    entry(homeTitle, 'android', 'passed'),
    entry(homeTitle, 'ios', 'failed', { screenshot: 'home-ios.png' }),
    entry(androidOnly, 'android', 'passed', {
      screenshot: 'menu.png',
      completedAt: '2026-01-01T10:00:09Z',
    }),
  ]);
  const res = buildResults(project, detail(r));
  const screens = screenInventory(res.scenarios, project.platforms);
  const by = (id: string) => screens.find((s) => s.id === id)!;
  assert.deepEqual(
    screens.map((s) => s.id),
    ['login', 'home', 'profile'],
  );
  assert.equal(by('login').status, 'passed');
  assert.equal(by('home').status, 'failed');
  assert.deepEqual(by('home').byOs, { android: 'passed', ios: 'failed' });
  assert.equal(by('profile').status, 'untested');
  assert.equal(by('login').tests.length, 1);
  assert.equal(by('login').elements.length, 3);
  assert.equal(by('login').module, 'Compte');
  assert.equal(by('login').captures.android?.entry.screenshot, 'login.png');
  assert.equal(
    by('home').captures.android?.entry.screenshot,
    'menu.png',
    'the most recent capture of the screen',
  );
  assert.equal(by('home').captures.ios?.entry.screenshot, 'home-ios.png');
  const noTest = scenario('Sans test', [
    node('navigation', 'Aller', { screen: screen('lonely', 'Seul') }),
  ]);
  const lonely = screenInventory(
    buildResults({ nodes: [noTest], platforms: ['android', 'ios'] }, null).scenarios,
    ['android', 'ios'],
  );
  assert.equal(lonely[0].status, 'none');
  assert.equal(lonely[0].module, '');
  const partial = screenInventory(
    buildResults(
      project,
      detail(report('r', '2026-01-01', [entry(homeTitle, 'android', 'passed')])),
    ).scenarios,
    project.platforms,
  ).find((s) => s.id === 'home')!;
  assert.equal(partial.status, 'partial');
});

test('screens: the module of a screen is the one most of its scenarios declare', () => {
  const a = scenario('A', [node('navigation', 'x', { screen: screen('shared') })], {
    module: 'Paiement',
  });
  const b = scenario('B', [node('navigation', 'y', { screen: screen('shared') })], {
    module: 'Panier',
  });
  const c = scenario('C', [node('navigation', 'z', { screen: screen('shared') })], {
    module: 'Panier',
  });
  const screens = screenInventory(
    buildResults({ nodes: [a, b, c], platforms: ['android'] }, null).scenarios,
    ['android'],
  );
  assert.equal(screens.length, 1);
  assert.equal(screens[0].module, 'Panier');
  assert.equal(screens[0].elements.length, 3);
});

test('screens: where a scenario starts is a screen too, even before anything happens on it', () => {
  const start = scenario(
    'Démarrage',
    [node('navigation', 'Aller', { screen: screen('next', 'Suivant') })],
    {
      module: 'Compte',
      startScreen: screen('splash', 'Lancement'),
    } as never,
  );
  const screens = screenInventory(
    buildResults({ nodes: [start], platforms: ['android'] }, null).scenarios,
    ['android'],
  );
  assert.deepEqual(
    screens.map((s) => [s.id, s.module, s.status]),
    [
      ['splash', 'Compte', 'none'],
      ['next', 'Compte', 'none'],
    ],
  );
  assert.equal(screens[0].elements.length, 0);
});

test('results: the overall rate counts element × OS pairs — 2 of 4 passing on iOS only is 25 %', () => {
  const four = scenario('Quatre', [
    node('action', 'a'),
    node('action', 'b'),
    node('action', 'c'),
    node('action', 'd'),
  ]);
  const p = { nodes: [four], platforms: ['android', 'ios'] as const };
  const res = buildResults(
    p,
    detail(
      report('r', '2026-01-01', [
        entry(four.children[0], 'ios', 'passed'),
        entry(four.children[1], 'ios', 'passed'),
      ]),
    ),
  );
  assert.equal(res.totals.total, 8);
  assert.equal(res.totals.passed, 2);
  assert.equal(res.totals.failed, 0);
  assert.equal(res.totals.rate, 25);
});
