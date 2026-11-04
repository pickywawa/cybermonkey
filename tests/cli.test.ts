import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EXIT, UsageError, parseArgs } from '../src/main/cli/args.js';
import { checkBuild, installPlan, installBuild } from '../src/main/cli/install.js';
import { verdictOf } from '../src/main/cli/outcome.js';
import { chooseDevices, defaultDataDir, pick, runCli } from '../src/main/cli/run.js';
import type { Device } from '../src/shared/domain/devices.js';
import type { Project } from '../src/shared/domain/project.js';
import type { RunEntry, RunReport } from '../src/shared/domain/report.js';

const run = (...args: string[]) => {
  const parsed = parseArgs(['run', ...args]);
  assert.equal(parsed.name, 'run');
  return parsed.name === 'run' ? parsed.options : (undefined as never);
};

test('cli args: defaults and every option', () => {
  const o = run();
  assert.equal(o.out, 'cybermonkey-report');
  assert.deepEqual(o.formats, ['junit', 'html', 'json']);
  assert.equal(o.prepare, 'existing');
  assert.equal(o.timeoutS, 3600);
  assert.equal(o.fresh, false);
  const full = run(
    '--project=Atlas',
    '--env',
    'recette',
    '--os',
    'all',
    '--android-app',
    'a.apk',
    '--fresh',
    '--format',
    'junit,junit,csv',
    '--timeout',
    '120',
    '--artifacts',
    '--quiet',
  );
  assert.equal(full.project, 'Atlas');
  assert.equal(full.environment, 'recette');
  assert.deepEqual(full.os, ['android', 'ios']);
  assert.deepEqual(full.formats, ['junit', 'csv']);
  assert.equal(full.timeoutS, 120);
  assert.ok(full.fresh && full.artifacts && full.quiet);
});

test('cli args: mistakes are reported, never ignored', () => {
  const bad = (...a: string[]) => assert.throws(() => parseArgs(a), UsageError);
  bad('deploy');
  bad('run', '--nope');
  bad('run', '--project');
  bad('run', '--project', '--env');
  bad('run', '--os', 'windows');
  bad('run', '--prepare', 'magic');
  bad('run', '--format', 'pdf');
  bad('run', '--timeout', 'abc');
  bad('run', '--timeout', '5');
  bad('run', '--fresh=1');
  bad('run', '--os', 'ios', '--android-app', 'a.apk');
  bad('devices', '--project', 'x');
  bad('run', '--json');
  assert.equal(parseArgs([]).name, 'help');
  assert.equal(parseArgs(['run', '--help']).name, 'help');
  assert.equal(parseArgs(['--version']).name, 'version');
  assert.deepEqual(parseArgs(['devices', '--json', '--data-dir', '/x']), {
    name: 'devices',
    dataDir: '/x',
    json: true,
    adbHosts: [],
  });
});

const device = (over: Partial<Device>): Device => ({
  id: 'emulator-5554',
  name: 'Pixel',
  platform: 'android',
  kind: 'usb',
  status: 'ready',
  detail: '',
  ...over,
});

test('cli install: one plan per kind of device, fresh uninstall is optional', () => {
  const android = installPlan(device({}), '/b/app.apk', 'com.acme', true);
  assert.deepEqual(
    android.map((s) => [s.file, s.args, !!s.optional]),
    [
      ['adb', ['-s', 'emulator-5554', 'uninstall', 'com.acme'], true],
      ['adb', ['-s', 'emulator-5554', 'install', '-r', '-t', '-g', '/b/app.apk'], false],
    ],
  );
  assert.equal(installPlan(device({}), '/b/app.apk', '', false).length, 1);
  const sim = installPlan(
    device({ id: 'sim:AAA', platform: 'ios', kind: 'simulator' }),
    '/b/App.app',
    'com.acme',
    true,
  );
  assert.deepEqual(sim[0].args, ['simctl', 'uninstall', 'AAA', 'com.acme']);
  assert.deepEqual(sim[1].args, ['simctl', 'install', 'AAA', '/b/App.app']);
  const phone = installPlan(
    device({ id: 'ios:UDID', platform: 'ios' }),
    '/b/App.ipa',
    'c.a',
    false,
  );
  assert.deepEqual(
    phone.map((s) => s.args),
    [['devicectl', 'device', 'install', 'app', '--device', 'UDID', '/b/App.ipa']],
  );
});

test('cli install: wrong or missing builds are refused before touching the device', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cm-cli-'));
  const apk = path.join(dir, 'a.apk');
  const ipa = path.join(dir, 'a.ipa');
  const app = path.join(dir, 'A.app');
  writeFileSync(apk, '');
  writeFileSync(ipa, '');
  mkdirSync(app);
  const sim = device({ id: 'sim:A', platform: 'ios', kind: 'simulator' });
  const phone = device({ id: 'ios:A', platform: 'ios' });
  assert.doesNotThrow(() => checkBuild(device({}), apk));
  assert.doesNotThrow(() => checkBuild(sim, app));
  assert.doesNotThrow(() => checkBuild(phone, ipa));
  assert.throws(() => checkBuild(device({}), path.join(dir, 'missing.apk')), /introuvable/);
  assert.throws(() => checkBuild(device({}), ipa), /\.apk/);
  assert.throws(() => checkBuild(sim, ipa), /\.app/);
  assert.throws(() => checkBuild(phone, apk), /\.ipa/);
});

test('cli install: failures surface, a missing previous install does not', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cm-cli-'));
  const apk = path.join(dir, 'a.apk');
  writeFileSync(apk, '');
  const seen: string[] = [];
  const fake = (async (file: string, args: string[]) => {
    seen.push(`${file} ${args[2]}`);
    if (args.includes('uninstall')) throw new Error('not installed');
    return Buffer.alloc(0);
  }) as never;
  await installBuild(device({}), apk, 'com.acme', true, () => {}, fake);
  assert.deepEqual(seen, ['adb uninstall', 'adb install']);
  const broken = (async () => {
    throw new Error('INSTALL_FAILED');
  }) as never;
  await assert.rejects(
    installBuild(device({}), apk, 'com.acme', false, () => {}, broken),
    /INSTALL_FAILED/,
  );
  await assert.rejects(
    installBuild(device({}), apk, '', true, () => {}, fake),
    /--fresh/,
  );
});

const entry = (over: Partial<RunEntry>): RunEntry =>
  ({
    id: Math.random().toString(),
    nodeId: 'n',
    nodeName: 'Étape',
    deviceId: 'emulator-5554',
    platform: 'android',
    status: 'passed',
    message: '',
    kind: 'test',
    startedAt: '2026-01-01T00:00:00Z',
    ...over,
  }) as RunEntry;
const report = (entries: RunEntry[], status: RunReport['status'] = 'passed'): RunReport => ({
  id: 'r',
  projectId: 'p',
  startedAt: '2026-01-01T00:00:00Z',
  status,
  entries,
  snapshot: [],
});

test('cli verdict: a regression, a broken machine and a green run are three different codes', () => {
  assert.equal(verdictOf(report([entry({})]), false).code, EXIT.OK);
  assert.equal(
    verdictOf(report([entry({}), entry({ status: 'failed', message: 'x' })], 'failed'), false).code,
    EXIT.TESTS_FAILED,
  );
  // No device paired: infrastructure, not a regression.
  assert.equal(
    verdictOf(
      report(
        [entry({ status: 'blocked', deviceId: 'missing:ios', message: 'Aucun appareil' })],
        'passed',
      ),
      false,
    ).code,
    EXIT.USAGE_OR_INFRA,
  );
  assert.equal(
    verdictOf(
      report([entry({ nodeId: 'engine', status: 'failed', message: 'boom' })], 'failed'),
      false,
    ).code,
    EXIT.USAGE_OR_INFRA,
  );
  // Nothing ran at all must never be green.
  assert.equal(verdictOf(report([]), false).code, EXIT.USAGE_OR_INFRA);
  assert.equal(verdictOf(report([entry({})]), true).code, EXIT.CANCELLED);
  assert.equal(verdictOf(report([entry({})], 'cancelled'), false).code, EXIT.CANCELLED);
});

test('cli verdict: handlers, preconditions and scenario headers are not results; flaky passes are counted', () => {
  const v = verdictOf(
    report([
      entry({ interruption: 'Cookies', status: 'failed' }),
      entry({ precondition: true, status: 'failed' }),
      entry({ kind: 'scenario', status: 'failed' }),
      entry({ flaky: true }),
      entry({}),
    ]),
    false,
  );
  assert.equal(v.code, EXIT.OK);
  assert.equal(v.passed, 2);
  assert.equal(v.flaky, 1);
  const overridden = verdictOf(report([entry({ status: 'failed', outcome: 'passed' })]), false);
  assert.equal(overridden.code, EXIT.OK);
});

test('cli: project / scenario lookup by id or exact name, never by guess', () => {
  const items = [
    { id: 'a1', name: 'Atlas' },
    { id: 'b2', name: 'Boreal' },
    { id: 'c3', name: 'boreal' },
  ];
  const name = (i: { name: string }) => i.name;
  assert.equal(pick(items, 'a1', name, 'Le projet').id, 'a1');
  assert.equal(pick(items, ' atlas ', name, 'Le projet').id, 'a1');
  assert.throws(() => pick(items, 'Boreal', name, 'Le projet'), /ambigu/);
  assert.throws(() => pick(items, 'Atl', name, 'Le projet'), /introuvable.*Atlas/);
});

test('cli devices: explicit flag, then the paired one, then the only ready one', () => {
  const a1 = device({ id: 'A1', name: 'Pixel 7' });
  const a2 = device({ id: 'A2', name: 'Pixel 8' });
  const off = device({ id: 'A3', status: 'offline' });
  const ios = device({ id: 'sim:S', platform: 'ios', kind: 'simulator', name: 'iPhone 16' });
  const project = { deviceIds: {} } as unknown as Project;
  const paired = { deviceIds: { android: 'A2' } } as unknown as Project;
  assert.equal(chooseDevices(project, ['android'], [a1], {}).android, a1);
  assert.equal(chooseDevices(paired, ['android'], [a1, a2], {}).android, a2);
  assert.equal(chooseDevices(paired, ['android'], [a1, a2], { android: 'pixel 7' }).android, a1);
  assert.equal(chooseDevices(project, ['android', 'ios'], [a1, ios], {}).ios, ios);
  assert.throws(() => chooseDevices(project, ['android'], [a1, a2], {}), /--android-device/);
  assert.throws(() => chooseDevices(project, ['android'], [], {}), /Aucun appareil Android/);
  assert.throws(() => chooseDevices(project, ['android'], [off], { android: 'A3' }), /hors ligne/);
  assert.throws(() => chooseDevices(project, ['android'], [a1], { android: 'zzz' }), /non détecté/);
});

test('cli: data folder follows the installed app per OS', () => {
  assert.match(defaultDataDir({}, 'darwin'), /Library[\\/]Application Support[\\/]Cybermonkey$/);
  assert.equal(
    defaultDataDir({ APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'win32'),
    path.join('C:\\Users\\a\\AppData\\Roaming', 'Cybermonkey'),
  );
  assert.equal(
    defaultDataDir({ XDG_CONFIG_HOME: '/cfg' }, 'linux'),
    path.join('/cfg', 'Cybermonkey'),
  );
  assert.equal(defaultDataDir({ CYBERMONKEY_USER_DATA: '/mine' }, 'darwin'), '/mine');
});

test('cli runCli: usage errors and unknown projects exit 2 without touching a device', async () => {
  const lines: string[] = [];
  const io = { out: (l: string) => lines.push(l), err: (l: string) => lines.push(l) };
  assert.equal(await runCli(['run', '--bogus'], io), EXIT.USAGE_OR_INFRA);
  assert.equal(await runCli(['--help'], io), EXIT.OK);
  const empty = mkdtempSync(path.join(os.tmpdir(), 'cm-cli-data-'));
  assert.equal(await runCli(['projects', '--data-dir', empty], io), EXIT.OK);
  assert.equal(await runCli(['run', '--data-dir', empty], io), EXIT.USAGE_OR_INFRA);
  assert.ok(lines.some((l) => /Aucun projet/.test(l)));
});
