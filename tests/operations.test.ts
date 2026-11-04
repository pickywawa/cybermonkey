import test from 'node:test';
import assert from 'node:assert/strict';
import { performOperation, type OperationContext } from '../src/main/infra/appium/operations.js';
import { makeVariant, needsComponent, type Variant } from '../src/shared/domain/scenario.js';

interface Call {
  route: string;
  method?: string;
  body?: any;
}
/** Fake Appium server: scripted answers per route suffix, every call recorded. */
function fake(
  platform: 'ios' | 'android',
  answer: (c: Call, n: number) => unknown,
  application: string | undefined = 'com.acme.app',
) {
  const calls: Call[] = [];
  const ctx: OperationContext = {
    deviceId: 'd1',
    platform,
    session: 's1',
    application,
    request: async (route, method, body) => {
      const call = { route, method, body };
      calls.push(call);
      return answer(call, calls.length);
    },
  };
  return { ctx, calls };
}
const run = (ctx: OperationContext, v: Partial<Variant>, kind: 'action' | 'test' = 'action') =>
  performOperation(ctx, makeVariant(v), kind);
const scripts = (calls: Call[]) =>
  calls
    .filter((c) => c.route.endsWith('/execute/sync'))
    .map((c) => [c.body.script, c.body.args[0]]);
const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';
const el = (id: string) => ({ [ELEMENT]: id });
const loc = { using: 'accessibility id' as const, value: 'row' };

test('device-level operations need no component', () => {
  for (const o of ['back', 'deeplink', 'alert', 'relaunch', 'orientation', 'hidekeyboard'] as const)
    assert.equal(needsComponent(o), false, o);
  for (const o of ['tap', 'longpress', 'doubletap', 'scroll', 'assert'] as const)
    assert.equal(needsComponent(o), true, o);
});

test('relaunch terminates then activates the project app, per platform', async () => {
  const ios = fake('ios', () => null);
  await run(ios.ctx, { operation: 'relaunch' });
  assert.deepEqual(scripts(ios.calls), [
    ['mobile: terminateApp', { bundleId: 'com.acme.app' }],
    ['mobile: activateApp', { bundleId: 'com.acme.app' }],
  ]);
  const android = fake('android', () => null);
  await run(android.ctx, { operation: 'terminate' });
  assert.deepEqual(scripts(android.calls), [['mobile: terminateApp', { appId: 'com.acme.app' }]]);
});

test('lifecycle without a configured application explains what to do', async () => {
  const { ctx } = fake('ios', () => null, '');
  await assert.rejects(run(ctx, { operation: 'launch' }), /Applications/);
  // …unless the step names the application itself
  const named = fake('ios', () => null, '');
  await run(named.ctx, { operation: 'launch', value: 'com.other.app' });
  assert.deepEqual(scripts(named.calls), [['mobile: activateApp', { bundleId: 'com.other.app' }]]);
});

test('deeplink opens the url in the project app (bundleId on iOS, package on Android)', async () => {
  const ios = fake('ios', () => null);
  await run(ios.ctx, { operation: 'deeplink', value: ' acme://order/42 ' });
  assert.deepEqual(scripts(ios.calls), [
    ['mobile: deepLink', { url: 'acme://order/42', bundleId: 'com.acme.app' }],
  ]);
  const android = fake('android', () => null);
  await run(android.ctx, { operation: 'deeplink', value: 'acme://order/42' });
  assert.deepEqual(scripts(android.calls), [
    ['mobile: deepLink', { url: 'acme://order/42', package: 'com.acme.app' }],
  ]);
  await assert.rejects(run(android.ctx, { operation: 'deeplink' }), /Lien manquant/);
});

test('alert: accept by default, dismiss, or a named button; waits for the dialog to show up', async () => {
  const a = fake('ios', () => null);
  await run(a.ctx, { operation: 'alert' });
  assert.deepEqual(scripts(a.calls), [['mobile: alert', { action: 'accept' }]]);
  const d = fake('android', () => null);
  await run(d.ctx, { operation: 'alert', value: 'dismiss' });
  assert.deepEqual(scripts(d.calls), [['mobile: dismissAlert', {}]]);
  const named = fake('ios', () => null);
  await run(named.ctx, { operation: 'alert', value: 'Autoriser' });
  assert.deepEqual(scripts(named.calls), [
    ['mobile: alert', { action: 'accept', buttonLabel: 'Autoriser' }],
  ]);
  // The dialog appears on the 3rd try.
  const late = fake('ios', (_c, n) => {
    if (n < 3)
      throw Object.assign(
        new Error('An attempt was made to operate on a modal dialog: no such alert'),
        {},
      );
    return null;
  });
  await run(late.ctx, { operation: 'alert', timeoutMs: 5000 });
  assert.equal(late.calls.length, 3);
  // Never shows up: a clear error, not a hang.
  const none = fake('ios', () => {
    throw new Error('no such alert');
  });
  await assert.rejects(run(none.ctx, { operation: 'alert', timeoutMs: 300 }), /Aucune alerte/);
  // Other errors are not swallowed.
  const broken = fake('ios', () => {
    throw new Error('session lost');
  });
  await assert.rejects(run(broken.ctx, { operation: 'alert' }), /session lost/);
});

test('orientation and keyboard', async () => {
  const f = fake('android', () => null);
  await run(f.ctx, { operation: 'orientation', value: 'landscape' });
  assert.deepEqual(f.calls[0].body, { orientation: 'LANDSCAPE' });
  await run(f.ctx, { operation: 'orientation' });
  assert.deepEqual(f.calls[1].body, { orientation: 'PORTRAIT' });
  // no keyboard on screen is not a failure
  const k = fake('ios', () => {
    throw new Error('keyboard not present');
  });
  await run(k.ctx, { operation: 'hidekeyboard' });
});

test('long press and double tap use the native element gestures', async () => {
  const answer = (c: Call) => (c.route.endsWith('/elements') ? [el('e1')] : null);
  const ios = fake('ios', answer);
  await run(ios.ctx, { operation: 'longpress', locator: loc, value: '1500' });
  await run(ios.ctx, { operation: 'doubletap', locator: loc });
  assert.deepEqual(scripts(ios.calls), [
    ['mobile: touchAndHold', { elementId: 'e1', duration: 1.5 }],
    ['mobile: doubleTap', { elementId: 'e1' }],
  ]);
  const android = fake('android', answer);
  await run(android.ctx, { operation: 'longpress', locator: loc });
  await run(android.ctx, { operation: 'doubletap', locator: loc });
  assert.deepEqual(scripts(android.calls), [
    ['mobile: longClickGesture', { elementId: 'e1', duration: 1000 }],
    ['mobile: doubleClickGesture', { elementId: 'e1' }],
  ]);
});

test('long press on a screen position holds the finger, double tap taps twice', async () => {
  const answer = (c: Call) =>
    c.route.endsWith('/window/rect') ? { width: 400, height: 800 } : null;
  const f = fake('ios', answer);
  await run(f.ctx, { operation: 'longpress', point: { x: 0.5, y: 0.25 }, value: '900' });
  const press = f.calls.find((c) => c.route.endsWith('/actions') && c.method === 'POST')!;
  const steps = press.body.actions[0].actions;
  assert.deepEqual(steps[0], { type: 'pointerMove', duration: 0, x: 200, y: 200 });
  assert.deepEqual(steps[2], { type: 'pause', duration: 900 });
  const g = fake('ios', answer);
  await run(g.ctx, { operation: 'doubletap', point: { x: 0.5, y: 0.5 } });
  const taps = g.calls
    .find((c) => c.route.endsWith('/actions') && c.method === 'POST')!
    .body.actions[0].actions.filter((a: any) => a.type === 'pointerDown');
  assert.equal(taps.length, 2);
});

test('scroll swipes until the component is displayed, and stops after the maximum', async () => {
  let swipes = 0;
  const f = fake('ios', (c) => {
    if (c.route.endsWith('/window/rect')) return { width: 400, height: 800 };
    if (c.route.endsWith('/actions') && c.method === 'POST') return void swipes++;
    if (c.route.endsWith('/elements')) return swipes >= 3 ? [el('e9')] : [];
    if (c.route.endsWith('/displayed')) return true;
    return null;
  });
  await run(f.ctx, { operation: 'scroll', locator: loc, direction: 'up' });
  assert.equal(swipes, 3);
  const never = fake('android', (c) => {
    if (c.route.endsWith('/window/rect')) return { width: 400, height: 800 };
    if (c.route.endsWith('/elements')) return [];
    return null;
  });
  await assert.rejects(
    run(never.ctx, { operation: 'scroll', locator: loc, value: '2' }),
    /introuvable après 2 défilement/,
  );
  assert.equal(
    never.calls.filter((c) => c.route.endsWith('/actions') && c.method === 'POST').length,
    2,
  );
});

test('count assertion accepts exact numbers and comparisons', async () => {
  const three = fake('ios', (c) =>
    c.route.endsWith('/elements') ? [el('a'), el('b'), el('c')] : null,
  );
  const check = (expected: string, timeoutMs = 0) =>
    run(
      three.ctx,
      { operation: 'assert', assertion: 'count', locator: loc, expected, timeoutMs },
      'test',
    );
  await check('3');
  await check('=3');
  await check('>=2');
  await check('<4');
  await assert.rejects(check('5'), /attendu « 5 », obtenu 3/);
  await assert.rejects(check('>3'), /obtenu 3/);
  await assert.rejects(check('plusieurs'), /Nombre attendu invalide/);
  // zero components is a valid count
  const none = fake('ios', () => []);
  await run(
    none.ctx,
    { operation: 'assert', assertion: 'count', locator: loc, expected: '0', timeoutMs: 0 },
    'test',
  );
});

test('matches and selected assertions', async () => {
  const f = fake('ios', (c) => {
    if (c.route.endsWith('/elements')) return [el('e1')];
    if (c.route.endsWith('/displayed')) return true;
    if (c.route.endsWith('/text')) return 'Commande n°4821 confirmée';
    if (c.route.endsWith('/selected')) return false;
    return null;
  });
  const t = (v: Partial<Variant>) =>
    run(f.ctx, { operation: 'assert', locator: loc, timeoutMs: 0, ...v }, 'test');
  await t({ assertion: 'matches', expected: 'n°\\d{4} confirmée' });
  await assert.rejects(t({ assertion: 'matches', expected: '^annulée' }), /ne correspond pas/);
  await assert.rejects(t({ assertion: 'matches', expected: '(' }), /Expression régulière invalide/);
  await assert.rejects(t({ assertion: 'selected' }), /non sélectionné/);
});
