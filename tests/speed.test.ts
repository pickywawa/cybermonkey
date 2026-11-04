import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { onEachOs } from '../src/main/mcp/devices.js';
import { prepareStart, startingTarget } from '../src/main/engine/execution/start-state.js';
import { performOperation, type OperationContext } from '../src/main/infra/appium/operations.js';
import { durationProfile, entryDurationMs } from '../src/shared/domain/profile.js';
import { makeNode, makeVariant } from '../src/shared/domain/scenario.js';
import type { CampaignDetail, RunEntry } from '../src/shared/domain/report.js';

test('both OS are driven at the same time: the slowest one sets the duration, not the sum', async () => {
  const ctx = {
    c: {
      devices: {
        known: new Map([
          ['a', { id: 'a', name: 'Pixel', platform: 'android', status: 'ready' }],
          ['i', { id: 'i', name: 'iPhone', platform: 'ios', status: 'ready' }],
        ]),
      },
    },
  };
  const project = { deviceIds: { android: 'a', ios: 'i' } };
  const started = Date.now();
  let running = 0;
  let peak = 0;
  const out = await onEachOs(ctx as never, project as never, ['android', 'ios'], async () => {
    peak = Math.max(peak, ++running);
    await sleep(150);
    running--;
    return 'ok';
  });
  assert.equal(peak, 2);
  assert.ok(Date.now() - started < 270, 'took the sum of both OS');
  assert.deepEqual(
    out.map((o) => o.ok),
    [true, true],
  );
});

const scenario = (link?: string) => {
  const s = makeNode('scenario', 'Commandes', []);
  s.startScreen = {
    id: 'orders',
    name: 'Commandes',
    variants: { ios: { markers: [{ using: 'accessibility id', value: 'Mes commandes' }], link } },
  };
  return s;
};
function prep(options: {
  reachedAfterLink: boolean;
  linkThrows?: boolean;
  reachedAfterRestart?: boolean;
}) {
  const log: string[] = [];
  let state: 'start' | 'link' | 'restart' = 'start';
  return {
    log,
    run: (link?: string) =>
      prepareStart({
        target: startingTarget(scenario(link), 'ios')!,
        nodes: [],
        platform: 'ios',
        signal: new AbortController().signal,
        // the check passes only once the right action brought the app to the screen
        perform: async () => {
          const ok =
            (state === 'link' && options.reachedAfterLink) ||
            (state === 'restart' && options.reachedAfterRestart !== false);
          if (!ok) throw new Error('not there');
        },
        execute: async () => void 0,
        restart: async () => void (log.push('restart'), (state = 'restart')),
        openLink: async (url) => {
          log.push('link ' + url);
          if (options.linkThrows) throw new Error('no handler');
          state = 'link';
        },
      }),
  };
}

test('a start screen with a deep link is reached without restarting the app', async () => {
  const p = prep({ reachedAfterLink: true });
  await p.run('acme://orders');
  assert.deepEqual(p.log, ['link acme://orders']);
});

test('when the link does not land on the screen, the slow sure way still runs', async () => {
  const wrong = prep({ reachedAfterLink: false });
  await wrong.run('acme://orders');
  assert.deepEqual(wrong.log, ['link acme://orders', 'restart']);
  const broken = prep({ reachedAfterLink: false, linkThrows: true });
  await broken.run('acme://orders');
  assert.deepEqual(broken.log, ['link acme://orders', 'restart']);
  const none = prep({ reachedAfterLink: false });
  await none.run(undefined);
  assert.deepEqual(none.log, ['restart']);
});

test('typing into a web view waits for the keyboard instead of sleeping a fixed time', async () => {
  const polls: number[] = [];
  const answers = [false, false, true];
  const calls: string[] = [];
  const ctx: OperationContext = {
    deviceId: 'd',
    platform: 'ios',
    session: 's',
    request: async (route, _m, body: any) => {
      if (route.endsWith('/window/rect')) return { width: 100, height: 100 };
      if (body?.script === 'mobile: isKeyboardShown') return answers[polls.push(1) - 1] ?? true;
      if (body?.script) calls.push(body.script);
      return null;
    },
  };
  const t = Date.now();
  await performOperation(
    ctx,
    makeVariant({ operation: 'type', point: { x: 0.5, y: 0.5 }, value: 'abc' }),
    'action',
  );
  assert.equal(polls.length, 3);
  assert.deepEqual(calls, ['mobile: keys']);
  assert.ok(Date.now() - t < 330, 'slept the old fixed 350 ms');
  // a driver that cannot answer keeps the old safe behaviour
  const blind: OperationContext = {
    ...ctx,
    request: async (route, _m, body: any) => {
      if (body?.script === 'mobile: isKeyboardShown') throw new Error('unsupported');
      return route.endsWith('/window/rect') ? { width: 100, height: 100 } : null;
    },
  };
  await performOperation(
    blind,
    makeVariant({ operation: 'type', point: { x: 0.5, y: 0.5 }, value: 'abc' }),
    'action',
  );
});

const entry = (p: Partial<RunEntry>): RunEntry => ({
  id: crypto.randomUUID(),
  nodeId: 'n',
  nodeName: 'Step',
  kind: 'action',
  deviceId: 'd',
  platform: 'ios',
  status: 'passed',
  message: '',
  startedAt: '2026-01-01T00:00:00.000Z',
  completedAt: '2026-01-01T00:00:01.000Z',
  ...p,
});
test('the duration profile ranks steps, averages runs and tells how much time is evidence gathering', () => {
  const at = (s: number) => `2026-01-01T00:00:${String(s).padStart(2, '0')}.000Z`;
  const detail = {
    campaign: {} as never,
    reports: [
      {
        id: 'r',
        projectId: 'p',
        startedAt: at(0),
        status: 'passed',
        snapshot: [],
        entries: [
          entry({
            nodeId: 'fast',
            nodeName: 'Fast',
            completedAt: at(1),
            performMs: 300,
            proofMs: 700,
          }),
          entry({
            nodeId: 'slow',
            nodeName: 'Slow',
            completedAt: at(9),
            performMs: 8000,
            proofMs: 1000,
          }),
          entry({
            nodeId: 'slow',
            nodeName: 'Slow',
            completedAt: at(5),
            performMs: 4000,
            proofMs: 1000,
          }),
          entry({ nodeId: 'scn', kind: 'scenario', completedAt: at(30) }),
          entry({ nodeId: 'skipped', status: 'skipped', completedAt: at(20) }),
          entry({ nodeId: 'engine', completedAt: at(20) }),
        ],
      },
    ],
  } as unknown as CampaignDetail;
  const p = durationProfile(detail);
  assert.equal(p.steps, 3);
  assert.equal(p.totalMs, 15000);
  assert.deepEqual(
    p.slowest.map((s) => [s.name, s.runs, s.avgMs, s.maxMs]),
    [
      ['Slow', 2, 7000, 9000],
      ['Fast', 1, 1000, 1000],
    ],
  );
  assert.equal(p.slowest[0].performMs, 6000);
  assert.equal(p.proofShare, 0.18);
  assert.deepEqual(p.perOs.ios, { steps: 3, totalMs: 15000 });
  assert.equal(entryDurationMs(entry({ completedAt: undefined })), undefined);
  assert.deepEqual(durationProfile(null).slowest, []);
});
