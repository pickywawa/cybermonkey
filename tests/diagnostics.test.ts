import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { compareImages, describeRegion } from '../src/main/infra/visual.js';
import { findBaseline } from '../src/shared/domain/baseline.js';
import type { CampaignDetail, RunEntry } from '../src/shared/domain/report.js';

const png = async (
  w: number,
  h: number,
  blocks: { x: number; y: number; w: number; h: number; color: string }[] = [],
) => {
  const img = await sharp({ create: { width: w, height: h, channels: 3, background: '#ffffff' } })
    .composite(
      await Promise.all(
        blocks.map(async (b) => ({
          input: await sharp({
            create: { width: b.w, height: b.h, channels: 3, background: b.color },
          })
            .png()
            .toBuffer(),
          left: b.x,
          top: b.y,
        })),
      ),
    )
    .png()
    .toBuffer();
  return 'data:image/png;base64,' + img.toString('base64');
};

test('identical screens differ by nothing; the status bar clock is ignored', async () => {
  const a = await png(360, 780);
  const same = await compareImages(a, a);
  assert.equal(same.comparable, true);
  assert.equal(same.changedPercent, 0);
  assert.deepEqual(same.regions, []);
  assert.equal(same.diff, undefined);
  const clock = await compareImages(
    a,
    await png(360, 780, [{ x: 20, y: 5, w: 120, h: 20, color: '#000000' }]),
  );
  assert.equal(clock.changedPercent, 0);
});

test('a changed area is found, located in words and outlined on the failing capture', async () => {
  const before = await png(360, 780, [{ x: 40, y: 500, w: 280, h: 60, color: '#3b5bdb' }]);
  const after = await png(360, 780, [{ x: 40, y: 500, w: 280, h: 60, color: '#e03131' }]);
  const d = await compareImages(before, after);
  assert.equal(d.comparable, true);
  assert.ok(d.changedPercent > 3 && d.changedPercent < 15, String(d.changedPercent));
  assert.equal(d.regions.length, 1);
  assert.equal(describeRegion(d.regions[0]), 'bottom-center');
  assert.match(d.diff!, /^data:image\/jpeg;base64,/);
  const meta = await sharp(Buffer.from(d.diff!.split(',')[1], 'base64')).metadata();
  assert.equal(meta.width, 360); // same size as the failing capture, not the downscaled working copy
});

test('captures of another shape are not compared, and a different device size of the same shape is', async () => {
  const phone = await png(360, 780);
  const tablet = await png(800, 600);
  const r = await compareImages(phone, tablet);
  assert.equal(r.comparable, false);
  assert.match(r.reason!, /shape/);
  const bigger = await png(720, 1560);
  assert.equal((await compareImages(phone, bigger)).comparable, true);
});

const e = (
  id: string,
  startedAt: string,
  status: RunEntry['status'],
  screenshot?: string,
): RunEntry =>
  ({
    id,
    nodeId: 'n',
    nodeName: 'Step',
    deviceId: 'd',
    platform: 'ios',
    status,
    message: '',
    startedAt,
    screenshot,
  }) as RunEntry;
test('the baseline is the latest earlier pass that has a capture, across campaigns', () => {
  const detail = (id: string, entries: RunEntry[]): CampaignDetail =>
    ({ campaign: { id }, reports: [{ id: 'r-' + id, entries }] }) as never;
  const failing = e('f', '2026-03-10', 'failed', 'capture:f');
  const found = findBaseline(
    [
      detail('c1', [
        failing,
        e('p1', '2026-03-01', 'passed', 'capture:p1'),
        e('p2', '2026-03-05', 'passed'),
      ]),
      detail('c0', [
        e('p0', '2026-03-08', 'passed', 'capture:p0'),
        e('x', '2026-03-09', 'failed', 'capture:x'),
        e('late', '2026-03-11', 'passed', 'capture:late'),
      ]),
    ],
    failing,
  );
  assert.equal(found?.entry.id, 'p0');
  assert.equal(found?.campaignId, 'c0');
  assert.equal(findBaseline([], failing), undefined);
});

import { summarizeDeviceLog } from '../src/main/infra/devices/device-log.js';
test('the device log is cut down to the app’s own lines and real errors, and network trouble is named', () => {
  const t = 1_700_000_000_000;
  const app = 'com.acme.agenda';
  const e = (dt: number, message: string) => ({ timestamp: t + dt, message });
  const raw = [
    e(
      -60_000,
      '2026-11-04 18:00:00.000 E Runner[4242:aa] [com.acme.agenda:Default] old failure long before',
    ),
    ...Array.from({ length: 200 }, (_, i) =>
      e(
        i * 10,
        `2026-11-04 18:01:49.${i} Df testmanagerd[63803:4c771b] [com.apple.dt.xctest:Default] Fetching AX attributes error ${i}`,
      ),
    ),
    e(
      500,
      '2026-11-04 18:01:50.000 Df Runner[4242:aa] [com.acme.agenda:Default] GET /orders started',
    ),
    e(
      900,
      '2026-11-04 18:01:51.000 Ef Runner[4242:aa] [com.acme.agenda:Default] Task failed NSURLErrorDomain Code=-1009 "The Internet connection appears to be offline."',
    ),
    e(950, '2026-11-04 18:01:51.100 E WebDriverAgentRunner-Runner[1:2] failed to do something'),
    e(990, '2026-11-04 18:01:51.200 E kernel[0:0] panic-ish error unrelated'),
  ];
  const s = summarizeDeviceLog(raw, { application: app, language: 'en' });
  assert.deepEqual(
    s.lines.map((l) => l.replace(/^.*\[com\.acme\.agenda:Default\] /, '')),
    [
      'GET /orders started',
      'Task failed NSURLErrorDomain Code=-1009 "The Internet connection appears to be offline."',
    ],
  );
  assert.deepEqual(s.networkHints, ['No network or server unreachable']);
  assert.equal(s.total, raw.length);
  assert.deepEqual(summarizeDeviceLog([], { application: app }), {
    lines: [],
    networkHints: [],
    total: 0,
  });
  // French by default
  assert.match(summarizeDeviceLog(raw, { application: app }).networkHints[0], /Pas de réseau/);
});

test('logcat lines: the app’s package and its network stack are kept, other apps are not', () => {
  const t = 1_700_000_000_000;
  const raw = [
    {
      timestamp: t,
      message:
        '11-04 18:01:49.1 1234 1234 E OkHttp : java.net.UnknownHostException: Unable to resolve host "api.acme.com"',
    },
    { timestamp: t + 1, message: '11-04 18:01:49.2 1234 1234 I com.acme.agenda: Activity resumed' },
    { timestamp: t + 2, message: '11-04 18:01:49.3 999 999 D SomeOtherApp : chatter' },
    {
      timestamp: t + 3,
      message: '11-04 18:01:49.4 1234 1234 E AndroidRuntime: FATAL EXCEPTION: main',
    },
  ];
  const s = summarizeDeviceLog(raw, { application: 'com.acme.agenda', language: 'en' });
  assert.equal(s.lines.length, 3);
  assert.ok(!s.lines.some((l) => l.includes('SomeOtherApp')));
  assert.deepEqual(s.networkHints, ['No network or server unreachable']);
});

test('with the app’s process id the syslog is filtered exactly; system daemons are never blamed', () => {
  const t = 1_700_000_000_000;
  const raw = [
    {
      timestamp: t,
      message:
        '2026-11-04 18:07:13.502 E proactiveeventtrackerd[99157:4cd015] Failed to initialize the tracker',
    },
    {
      timestamp: t + 1,
      message:
        '2026-11-04 18:07:14.000 E pairedsyncd[99141:4ccfc9] Fatal error: pairing store path was nil',
    },
    {
      timestamp: t + 2,
      message:
        '2026-11-04 18:07:15.000 Df Runner[93032:aaa] flutter: GET /agenda -> 503 Service Unavailable status 503',
    },
    {
      timestamp: t + 3,
      message: '2026-11-04 18:07:16.000 Df Runner[93032:aaa] flutter: HTTP/1.1 503 error',
    },
  ];
  const s = summarizeDeviceLog(raw, { pid: 93032, language: 'en' });
  assert.equal(s.lines.length, 2);
  assert.ok(s.lines.every((l) => l.includes('Runner[93032')));
  assert.deepEqual(s.networkHints, ['The server answered with a 5xx error']);
  // no pid and no line naming the app: nothing is guessed
  assert.deepEqual(
    summarizeDeviceLog(raw.slice(0, 2), { application: 'com.acme.agenda' }).lines,
    [],
  );
});
