import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveMarkers, observedDefinition } from '../src/shared/domain/screens.js';
import type { Component, Screen } from '../src/shared/domain/devices.js';
import { projectSchema, type Project } from '../src/shared/domain/project.js';
import {
  makeNode,
  makeVariant,
  type Locator,
  type OS,
  type ScenarioNode,
} from '../src/shared/domain/scenario.js';
import {
  newFacts,
  recordObservation,
  repairProposal,
  draftFromTrace,
  resolveLocator,
} from '../src/main/engine/creation/proposal.js';
import { inferStep } from '../src/main/engine/recorder/inference.js';
import { importCases } from '../src/shared/importers/parsers.js';
import { buildScreenGraph, campaignProgress, layoutGraph } from '../src/shared/domain/campaign.js';
import { campaignExport } from '../src/shared/domain/campaign-export.js';
import type { CampaignDetail, RunEntry } from '../src/shared/domain/report.js';

const t = (fr: string) => fr;
const comp = (id: string, label: string, extra: Partial<Component> = {}): Component => ({
  id,
  type: 'Button',
  label,
  text: label,
  locator: { using: 'accessibility id', value: id },
  rect: { x: 0, y: 0, width: 10, height: 10 },
  enabled: true,
  password: false,
  interactive: true,
  ...extra,
});
const screen = (deviceId: string, comps: Component[]): Screen => ({
  deviceId,
  components: comps,
  width: 390,
  height: 844,
  capturedAt: '',
});
const loc = (v: string): Locator => ({ using: 'accessibility id', value: v });
const project = (nodes: ScenarioNode[] = []): Project =>
  projectSchema.parse({
    id: 'p',
    name: 'P',
    directory: '/x',
    platforms: ['android', 'ios'],
    createdAt: '',
    nodes,
  }) as Project;

test('proposal repair: fresh ids, ungrounded variants dropped, destination screen derived from the trace', () => {
  const home = screen('android:1', [comp('title', 'Welcome'), comp('settings', 'Settings')]);
  const settings = screen('android:1', [
    comp('settings-title', 'Settings'),
    comp('logout', 'Log out'),
  ]);
  const facts = newFacts();
  facts.deviceByOs.set('android', 'android:1');
  recordObservation(facts, 'android', home);
  recordObservation(facts, 'android', settings);
  facts.executed.set('android:1', [
    {
      variant: makeVariant({ operation: 'tap', locator: loc('settings') }),
      before: home,
      after: settings,
    },
  ]);

  const scenario = makeNode('scenario', 'Open settings', []);
  const nav = makeNode('navigation', 'Open settings', []); // no screen identity: must be derived
  nav.id = 'dup';
  nav.variants.android = makeVariant({ operation: 'tap', locator: loc('settings') });
  nav.variants.ios = makeVariant({ operation: 'tap', locator: loc('settings') }); // iOS never explored
  const bad = makeNode('test', 'Ghost check', []);
  bad.id = 'dup';
  bad.variants.android = makeVariant({ operation: 'assert', locator: loc('does-not-exist') });
  scenario.children = [nav, bad];

  const result = repairProposal([scenario], project(), null, facts, t);
  assert.deepEqual(result.errors, []);
  const [root] = result.nodes;
  assert.equal(root.children.length, 1, 'the ungrounded check is removed, not fatal');
  assert.equal(root.children[0].kind, 'navigation');
  assert.ok(
    root.children[0].screen?.variants.android?.markers.length,
    'screen identity derived from the observed screen',
  );
  assert.equal(
    root.children[0].variants.ios,
    undefined,
    'never invent a variant for an unexplored OS',
  );
  assert.notEqual(root.children[0].id, 'dup');
  assert.ok(result.warnings.length >= 2);
});

test('draft from trace keeps only executed interactions and flags the OS', () => {
  const a = screen('android:1', [comp('go', 'Go')]);
  const b = screen('android:1', [comp('next-title', 'Next'), comp('x', 'Close')]);
  const facts = newFacts();
  facts.deviceByOs.set('android', 'android:1');
  recordObservation(facts, 'android', a);
  recordObservation(facts, 'android', b);
  facts.executed.set('android:1', [
    {
      variant: makeVariant({ operation: 'tap', locator: loc('go'), hint: 'Go' }),
      before: a,
      after: b,
    },
  ]);
  const [draft] = draftFromTrace('do something', project(), facts, t);
  assert.equal(draft.kind, 'scenario');
  assert.ok(draft.children.length >= 1);
  assert.deepEqual(draft.children[0].platforms, ['android']);
});

test('recorder inference: a vanished button is the tap, a changed field is typing', () => {
  const before = screen('d', [
    comp('login', 'Login'),
    comp('help', 'Help', { interactive: false }),
  ]);
  const after = screen('d', [
    comp('home-title', 'Home'),
    comp('help', 'Help', { interactive: false }),
  ]);
  const tap = inferStep(before, after, 'android' as OS, [], t, [before]);
  assert.equal(tap?.operation, 'tap');
  assert.equal(tap?.locator?.value, 'login');
  assert.ok(tap?.destination, 'a screen change yields a destination definition');

  const field = (text: string) =>
    comp('email', 'Email', { type: 'EditText', text, interactive: true });
  const typed = inferStep(
    screen('d', [field('')]),
    screen('d', [field('a@b.c')]),
    'android',
    [],
    t,
  );
  assert.equal(typed?.operation, 'type');
  assert.equal(typed?.value, 'a@b.c');
  assert.equal(inferStep(before, before, 'android', [], t), null);
});

test('importers understand Squash TM, Azure Test Plans and Gherkin exports', () => {
  const squash = importCases(
    'auto',
    'cases.csv',
    'TC_REFERENCE;TC_NAME;TC_STEP_ACTION;TC_STEP_RESULT\nT1;Login;Open the app;App opens\n;;Enter pin;Home is shown\nT2;Logout;Tap logout;Login screen',
  );
  assert.equal(squash.format, 'squash');
  assert.equal(squash.cases.length, 2);
  assert.equal(squash.cases[0].steps.length, 2);
  assert.equal(squash.cases[0].steps[1].expected, 'Home is shown');

  const azure = importCases(
    'auto',
    'plan.csv',
    'ID,Work Item Type,Title,Step Action,Step Expected\n12,Test Case,Pay,Open cart,Cart shown\n,,,Pay,Receipt shown',
  );
  assert.equal(azure.format, 'azure');
  assert.equal(azure.cases[0].steps.length, 2);

  const gherkin = importCases(
    'auto',
    'a.feature',
    'Feature: Auth\n  Scenario: Login ok\n    Given the app is open\n    When I enter my pin\n    Then I see home\n    And I see my name',
  );
  assert.equal(gherkin.cases[0].steps.length, 2);
  assert.match(gherkin.cases[0].steps[1].expected, /home ; I see my name/);
});

function entry(
  partial: Partial<RunEntry> & Pick<RunEntry, 'nodeId' | 'platform' | 'status'>,
): RunEntry {
  return {
    id: crypto.randomUUID(),
    nodeName: 'Check',
    deviceId: 'd',
    message: '',
    startedAt: '2026-01-01T00:00:0' + (partial.sequence ?? 0) + 'Z',
    completedAt: '2026-01-01T00:00:0' + (partial.sequence ?? 0) + 'Z',
    kind: 'test',
    ...partial,
  };
}
test('campaign progress counts the latest result per OS and step, graph merges Android + iOS', () => {
  const s = makeNode('scenario', 'S', []);
  const nav = makeNode('navigation', 'Go', ['android', 'ios']);
  nav.screen = {
    id: 'home',
    name: 'Home',
    variants: { android: { markers: [loc('a')] }, ios: { markers: [loc('b')] } },
  };
  const check = makeNode('test', 'Check', ['android', 'ios']);
  const iosOnly = makeNode('action', 'Gesture', ['ios']);
  iosOnly.platforms = ['ios'];
  s.children = [nav, check, iosOnly];
  const proj = project([s]);
  const ref = (os: OS) => ({ id: 'home', name: 'Home', platform: os, identified: true });
  const detail: CampaignDetail = {
    campaign: {
      id: crypto.randomUUID(),
      projectId: 'p',
      label: 'C',
      createdAt: '',
      updatedAt: '',
      status: 'open',
    },
    reports: [
      {
        id: 'r1',
        projectId: 'p',
        startedAt: '2026-01-01T00:00:00Z',
        status: 'failed',
        snapshot: [s],
        entries: [
          entry({
            nodeId: check.id,
            platform: 'android',
            status: 'failed',
            sequence: 1,
            screenBefore: ref('android'),
            screenAfter: ref('android'),
          }),
          entry({
            nodeId: check.id,
            platform: 'android',
            status: 'passed',
            sequence: 2,
            screenBefore: ref('android'),
            screenAfter: ref('android'),
          }), // retry
          entry({
            nodeId: check.id,
            platform: 'ios',
            status: 'passed',
            sequence: 3,
            screenBefore: ref('ios'),
            screenAfter: ref('ios'),
          }),
        ],
      },
    ],
  };
  const progress = campaignProgress(detail, proj);
  assert.equal(progress.byOs.android?.total, 2, 'iOS-only step is not planned on Android');
  assert.equal(progress.byOs.ios?.total, 3);
  assert.equal(progress.byOs.android?.passed, 1, 'retry replaced the failure');
  assert.equal(progress.byOs.android?.failed, 0);
  const graph = buildScreenGraph(detail, proj);
  const home = graph.screens.find((x) => x.id === 'home')!;
  assert.equal(home.stats.android?.passed, 1);
  assert.equal(home.stats.ios?.passed, 1);
  assert.equal(home.status, 'passed');
  const layout = layoutGraph(graph.screens, graph.edges);
  assert.ok(layout.positions.has('home'));
  const only = campaignExport(detail, 'junit', proj);
  assert.match(only, /<testsuite name="C · Android"/);
  assert.match(campaignExport(detail, 'csv', proj), /Check/);
});

test('selectors drifted by the model are mapped back to the observed ones when unambiguous', () => {
  const facts = newFacts();
  const cell = comp('c1', 'About', {
    type: 'XCUIElementTypeCell',
    locator: { using: 'xpath', value: "//XCUIElementTypeCell[@name='About']" },
  });
  const text = comp('c2', 'About', {
    type: 'XCUIElementTypeStaticText',
    interactive: false,
    locator: { using: 'xpath', value: "//XCUIElementTypeStaticText[@name='About']" },
  });
  const other = comp('c3', 'General');
  recordObservation(facts, 'ios', screen('sim:1', [cell, text, other]));
  assert.deepEqual(
    resolveLocator(facts, 'ios', loc('General')),
    loc('c3'),
    'same value, other strategy',
  );
  assert.deepEqual(
    resolveLocator(facts, 'ios', loc('About')),
    cell.locator,
    'label shared by a cell and its text: the tappable one wins',
  );
  assert.equal(resolveLocator(facts, 'ios', loc('Nope')), undefined);
  recordObservation(facts, 'ios', screen('sim:1', [comp('t1', 'Dashboard\nTuesday 12')]));
  assert.match(
    resolveLocator(facts, 'ios', loc('Dashboard'))!.value,
    /contains\(@name,'Dashboard'\)/,
    'multi-line label matched on its stable first line',
  );
  assert.deepEqual(
    resolveLocator(facts, 'ios', {
      using: 'xpath',
      value: "//XCUIElementTypeCell[@label='General']",
    }),
    loc('c3'),
  );
});

test('an executed typing step survives a mis-copied selector and keeps the trace selector', () => {
  const pin = comp('pin', 'PIN', {
    type: 'XCUIElementTypeTextField',
    locator: { using: 'xpath', value: '//*[self::XCUIElementTypeTextField]' },
  });
  const before = screen('sim:1', [pin]);
  const after = screen('sim:1', [comp('dash', 'Dashboard\nTuesday 12')]);
  const facts = newFacts();
  facts.deviceByOs.set('ios', 'sim:1');
  recordObservation(facts, 'ios', before);
  recordObservation(facts, 'ios', after);
  facts.executed.set('sim:1', [
    {
      variant: makeVariant({ operation: 'type', value: '${PIN}', locator: pin.locator }),
      before,
      after,
    },
  ]);
  const s = makeNode('scenario', 'Login', []);
  const type = makeNode('action', 'Type PIN', []);
  type.variants.ios = makeVariant({
    operation: 'type',
    value: '${PIN}',
    locator: { using: 'xpath', value: '//XCUIElementTypeSecureTextField' },
  });
  const check = makeNode('test', 'Dashboard shown', []);
  check.variants.ios = makeVariant({ operation: 'assert', locator: loc('Dashboard') });
  s.children = [type, check];
  const r = repairProposal([s], project(), null, facts, t);
  assert.equal(r.nodes[0].children.length, 2);
  assert.deepEqual(r.nodes[0].children[0].variants.ios?.locator, pin.locator);
  assert.match(
    r.nodes[0].children[1].variants.ios!.locator!.value,
    /contains\(@name,'Dashboard'\)/,
    'dynamic part of the label is not part of the selector',
  );
});

test('destination screens come from the settled screen, never from a loading state, and ignore app-wide selectors', () => {
  const title = (extra: Partial<Component> = {}) =>
    comp('app-title', 'My App', { interactive: false, ...extra });
  const loading = screen('sim:1', [title(), comp('wait', 'Please wait', { interactive: false })]);
  const form = screen('sim:1', [
    title(),
    comp('auth-title', 'Authentication', { interactive: false }),
    comp('sso', 'SSO form', { interactive: false }),
  ]);
  const start = screen('sim:1', [title(), comp('connect', 'Connect')]);
  const facts = newFacts();
  facts.deviceByOs.set('ios', 'sim:1');
  for (const s of [start, loading, form]) recordObservation(facts, 'ios', s);
  facts.executed.set('sim:1', [
    {
      variant: makeVariant({ operation: 'tap', locator: loc('connect') }),
      before: start,
      after: loading,
      settled: form,
    },
  ]);

  const root = makeNode('scenario', 'Login', []);
  const nav = makeNode('navigation', 'Open the login form', []);
  nav.variants.ios = makeVariant({ operation: 'tap', locator: loc('connect') });
  nav.screen = {
    id: 'auth',
    name: 'Authentication',
    variants: {
      ios: {
        markers: [
          { using: 'xpath', value: '//XCUIElementTypeOther[@label="Authentication"]' },
          { using: 'xpath', value: '//XCUIElementTypeOther[@label="SSO form"]' },
        ],
      },
    },
  };
  root.children = [nav];
  const out = repairProposal([root], project(), null, facts, t);
  const markers = out.nodes[0].children[0].screen!.variants.ios!.markers.map((m) => m.value);
  assert.deepEqual(
    markers,
    ['auth-title', 'sso'],
    'model markers are mapped to the selectors really observed',
  );

  // Without usable model markers the screen is derived from the settled screen, skipping the app-wide title.
  nav.screen = {
    id: 'auth2',
    name: 'Authentication',
    variants: { ios: { markers: [{ using: 'id', value: 'nope' }] } },
  };
  const derived = repairProposal(
    [{ ...root, children: [nav] }],
    project(),
    null,
    facts,
    t,
  ).nodes[0].children[0].screen!.variants.ios!.markers.map((m) => m.value);
  assert.ok(
    derived.includes('auth-title') && !derived.includes('wait') && !derived.includes('app-title'),
    derived.join(),
  );
});

test('stable-text markers (contains) identify a screen whose labels carry dynamic text', () => {
  const marker = {
    using: 'xpath' as const,
    value: "//*[contains(@name,'Dashboard') or contains(@label,'Dashboard')]",
  };
  const def = { id: 'dash', name: 'Dashboard', variants: { ios: { markers: [marker] } } };
  const today = screen('sim:1', [comp('d1', 'Dashboard\nTuesday 12')]);
  const tomorrow = screen('sim:1', [comp('d2', 'Dashboard\nWednesday 13')]);
  const other = screen('sim:1', [comp('o', 'Settings')]);
  assert.ok(observedDefinition(def, today, 'ios') && observedDefinition(def, tomorrow, 'ios'));
  assert.ok(!observedDefinition(def, other, 'ios'));
});

test('instance counters and scroll bars never identify a screen', () => {
  const s = screen('sim:1', [
    comp('Login', 'Login', { interactive: false }),
    comp('platform_view[3]', 'platform_view[3]', { interactive: false }),
    comp('sb', 'Vertical scroll bar, 1 page', { interactive: false }),
    comp('12', '12', { interactive: false }),
    comp('form', 'Sign in form', { interactive: false }),
  ]);
  const markers = deriveMarkers(s, 5).map((m) => m.value);
  assert.deepEqual(markers.sort(), ['Login', 'form']);
});

test('an already-saved screen definition with an instance counter still identifies its screen', () => {
  const def = {
    id: 'auth',
    name: 'Auth',
    variants: { ios: { markers: [loc('Authentication'), loc('platform_view[1]')] } },
  };
  const run2 = screen('sim:1', [
    comp('Authentication', 'Authentication'),
    comp('platform_view[4]', 'platform_view[4]'),
  ]);
  assert.ok(observedDefinition(def, run2, 'ios'));
});
