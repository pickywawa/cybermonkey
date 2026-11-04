import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Automation } from '../src/main/infra/appium/automation.js';
import { AdbNetwork } from '../src/main/infra/remote/adb-network.js';
import { devicefarm, DeviceFarmApi } from '../src/main/infra/remote/devicefarm.js';
import { RemoteAppium } from '../src/main/infra/remote/endpoint.js';
import {
  appiumHost,
  browserstack,
  BROWSERSTACK_HUB,
  saucelabs,
  type ProviderContext,
  type RemoteTarget,
} from '../src/main/infra/remote/providers.js';
import { RemoteDevices } from '../src/main/infra/remote/remote-devices.js';
import { signV4 } from '../src/main/infra/remote/sigv4.js';
import { EXIT, UsageError, parseArgs } from '../src/main/cli/args.js';
import { chooseDevices, runCli } from '../src/main/cli/run.js';
import { installBuild } from '../src/main/cli/install.js';
import { SecretStore } from '../src/main/integrations/secrets.js';
import { followLanguage } from '../src/main/integrations/i18n.js';
import type { Device } from '../src/shared/domain/devices.js';
import type { Project } from '../src/shared/domain/project.js';
import { adbTarget, remoteSchema, slugFor } from '../src/shared/domain/remote.js';
import { settingsSchema, type Settings } from '../src/shared/domain/settings.js';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'cm-remote-'));
const settingsOf = (remote: unknown = {}, extra: Partial<Settings> = {}): Settings =>
  settingsSchema.parse({ projectsDirectory: '/x', language: 'fr', remote, ...extra });

/** A fetch that records requests and answers from a script. */
function fakeFetch(answer: (url: string, init: RequestInit) => unknown) {
  const calls: { url: string; init: RequestInit; json?: any; headers: Record<string, string> }[] =
    [];
  const impl = (async (url: string | URL, init: RequestInit = {}) => {
    const u = String(url);
    let json: unknown;
    try {
      json = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    } catch {
      /* not JSON */
    }
    calls.push({ url: u, init, json, headers: (init.headers ?? {}) as Record<string, string> });
    const out = answer(u, init);
    if (out instanceof Response) return out;
    return new Response(typeof out === 'string' ? out : JSON.stringify(out ?? {}), { status: 200 });
  }) as typeof fetch;
  return { impl, calls };
}

async function secrets(values: Record<string, string> = {}) {
  const store = new SecretStore(path.join(tmp(), 's.json'));
  for (const [k, v] of Object.entries(values)) await store.set(k as never, v);
  return store;
}
const ctxOf = (
  settings: Settings,
  store: SecretStore,
  fetchImpl?: typeof fetch,
  app = (): string | undefined => undefined,
): ProviderContext => ({
  settings: settings.remote,
  secret: (k) => store.get(k),
  fetchImpl,
  app,
});
const profile = (over: Record<string, unknown> = {}) => ({
  id: 'pixel',
  label: 'Pixel 8',
  provider: 'browserstack' as const,
  platform: 'android' as const,
  deviceName: 'Google Pixel 8',
  osVersion: '14.0',
  ref: '',
  ...over,
});

/* ---------- model ---------- */
test('remote model: defaults are empty, slugs are unique, adb targets are normalised', () => {
  const r = remoteSchema.parse({});
  assert.deepEqual(r.adb.hosts, []);
  assert.equal(r.devices.length, 0);
  assert.equal(r.idleMinutes, 5);
  assert.equal(slugFor('Galaxy S23 (BrowserStack)', []), 'galaxy-s23-browserstack');
  assert.equal(slugFor('Pixel', ['pixel', 'pixel-2']), 'pixel-3');
  assert.equal(slugFor('éè ??', []), 'ee');
  assert.equal(adbTarget('192.168.1.20'), '192.168.1.20:5555');
  assert.equal(adbTarget(' phone.local:6000 '), 'phone.local:6000');
  assert.equal(adbTarget('[::1]:5555'), '[::1]:5555');
  assert.equal(adbTarget('bad host'), '');
  assert.equal(adbTarget('host:99999'), '');
  assert.throws(() => remoteSchema.parse({ appium: { url: 'ftp://x' } }));
  assert.throws(() =>
    remoteSchema.parse({
      devices: [{ id: 'Bad Id', label: 'x', provider: 'appium', platform: 'ios' }],
    }),
  );
});

/* ---------- SigV4 ---------- */
test('sigv4: reproduces the signature AWS publishes for its documentation example', () => {
  const headers = signV4({
    method: 'GET',
    url: new URL('https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08'),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
    body: '',
    region: 'us-east-1',
    service: 'iam',
    credentials: {
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    },
    now: new Date('2015-08-30T12:36:00Z'),
  });
  assert.equal(
    headers.Authorization,
    'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7',
  );
  const withToken = signV4({
    method: 'POST',
    url: new URL('https://x.amazonaws.com/'),
    headers: {},
    body: '{}',
    region: 'us-west-2',
    service: 'devicefarm',
    credentials: { accessKeyId: 'A', secretAccessKey: 'S', sessionToken: 'TOKEN' },
    now: new Date('2026-01-01T00:00:00Z'),
  });
  assert.equal(withToken['x-amz-security-token'], 'TOKEN');
  assert.match(withToken.Authorization, /SignedHeaders=host;x-amz-date;x-amz-security-token/);
});

/* ---------- endpoint ---------- */
test('remote endpoint: sends credentials, returns value, explains refusals without leaking the key', async () => {
  const ok = fakeFetch(() => ({ value: { sessionId: 's1' } }));
  const endpoint = new RemoteAppium(
    'https://hub.example/wd/hub/',
    { Authorization: 'Basic abc' },
    ok.impl,
    ['secret-key'],
  );
  assert.deepEqual(await endpoint.request('/session', 'POST', { a: 1 }), { sessionId: 's1' });
  assert.equal(ok.calls[0].url, 'https://hub.example/wd/hub/session');
  assert.equal(ok.calls[0].headers.Authorization, 'Basic abc');
  assert.deepEqual(ok.calls[0].json, { a: 1 });
  const denied = new RemoteAppium(
    'https://hub.example',
    {},
    fakeFetch(() => new Response('{}', { status: 401 })).impl,
  );
  await assert.rejects(denied.request('/session', 'POST', {}), /Identifiants refusés \(HTTP 401\)/);
  const leaky = new RemoteAppium(
    'https://hub.example',
    {},
    fakeFetch(
      () =>
        new Response(
          JSON.stringify({
            value: { error: 'session not created', message: 'bad key secret-key here' },
          }),
          { status: 500 },
        ),
    ).impl,
    ['secret-key'],
  );
  await assert.rejects(
    leaky.request('/session', 'POST', {}),
    (e: Error) => /•••/.test(e.message) && !e.message.includes('secret-key'),
  );
  const down = new RemoteAppium('https://hub.example', {}, (async () => {
    throw new Error('ECONNREFUSED');
  }) as never);
  await assert.rejects(down.request('/status'), /Connexion impossible/);
});

/* ---------- providers ---------- */
test('browserstack: missing credentials are named, the session targets the hub with the app and options', async () => {
  const empty = settingsOf();
  assert.match((await browserstack.missing(ctxOf(empty, await secrets())))!, /nom d’utilisateur/);
  const noKey = settingsOf({ browserstack: { username: 'bob' } });
  assert.match((await browserstack.missing(ctxOf(noKey, await secrets())))!, /clé d’accès/);

  const s = settingsOf({ browserstack: { username: 'bob', appiumVersion: '2.6.0' } });
  const store = await secrets({ browserstackKey: 'KEY-123456' });
  assert.equal(await browserstack.missing(ctxOf(s, store)), undefined);
  const target = await browserstack.open(
    profile() as never,
    ctxOf(s, store, undefined, () => 'bs://abc'),
  );
  assert.equal(target.endpoint.base, BROWSERSTACK_HUB);
  const caps = target.capabilities as any;
  assert.equal(caps.platformName, 'Android');
  assert.equal(caps['appium:automationName'], 'UiAutomator2');
  assert.equal(caps['appium:deviceName'], 'Google Pixel 8');
  assert.equal(caps['appium:platformVersion'], '14.0');
  assert.equal(caps['appium:app'], 'bs://abc');
  assert.equal(caps['appium:autoLaunch'], false);
  assert.equal(caps['bstack:options'].userName, 'bob');
  assert.equal(caps['bstack:options'].accessKey, 'KEY-123456');
  assert.equal(caps['bstack:options'].appiumVersion, '2.6.0');
  const ios = (await browserstack.open(profile({ platform: 'ios' }) as never, ctxOf(s, store)))
    .capabilities as any;
  assert.equal(ios.platformName, 'iOS');
  assert.equal(ios['appium:automationName'], 'XCUITest');
  assert.ok(!('appium:app' in ios));
});

test('browserstack: upload posts the file and returns the bs:// reference; the test reads the plan', async () => {
  const dir = tmp();
  const apk = path.join(dir, 'app.apk');
  writeFileSync(apk, 'APKDATA');
  const s = settingsOf({ browserstack: { username: 'bob' } });
  const store = await secrets({ browserstackKey: 'KEY-123456' });
  const http = fakeFetch((url) =>
    url.endsWith('/upload') ? { app_url: 'bs://hash123' } : { parallel_sessions_max_allowed: 5 },
  );
  const ref = await browserstack.upload(apk, 'android', ctxOf(s, store, http.impl));
  assert.equal(ref, 'bs://hash123');
  assert.equal(http.calls[0].url, 'https://api-cloud.browserstack.com/app-automate/upload');
  assert.ok(http.calls[0].init.body instanceof FormData);
  assert.equal(
    http.calls[0].headers.Authorization,
    'Basic ' + Buffer.from('bob:KEY-123456').toString('base64'),
  );
  const result = await browserstack.test(ctxOf(s, store, http.impl));
  assert.match(result.message, /5 sessions/);
  const none = fakeFetch(() => ({}));
  await assert.rejects(browserstack.upload(apk, 'android', ctxOf(s, store, none.impl)), /app_url/);
});

test('sauce labs: region picks the hub, the app and options go in sauce:options, upload gives a storage reference', async () => {
  const s = settingsOf({ saucelabs: { username: 'sam', region: 'eu-central-1' } });
  const store = await secrets({ saucelabsKey: 'SAUCE-KEY-1' });
  const target = await saucelabs.open(
    profile({ provider: 'saucelabs', deviceName: 'Samsung.*' }) as never,
    ctxOf(s, store, undefined, () => 'storage:filename=app.apk'),
  );
  assert.equal(target.endpoint.base, 'https://ondemand.eu-central-1.saucelabs.com/wd/hub');
  const caps = target.capabilities as any;
  assert.equal(caps['appium:deviceName'], 'Samsung.*');
  assert.equal(caps['appium:app'], 'storage:filename=app.apk');
  assert.equal(caps['sauce:options'].username, 'sam');
  assert.equal(caps['sauce:options'].accessKey, 'SAUCE-KEY-1');
  const apk = path.join(tmp(), 'a.apk');
  writeFileSync(apk, 'x');
  const http = fakeFetch(() => ({ item: { id: 'uuid-1', name: 'a.apk' } }));
  assert.equal(
    await saucelabs.upload(apk, 'android', ctxOf(s, store, http.impl)),
    'storage:uuid-1',
  );
  assert.equal(http.calls[0].url, 'https://api.eu-central-1.saucelabs.com/v1/storage/upload');
  const byName = fakeFetch(() => ({ item: { name: 'a.apk' } }));
  assert.equal(
    await saucelabs.upload(apk, 'android', ctxOf(s, store, byName.impl)),
    'storage:filename=a.apk',
  );
});

test('own appium server: auth modes, udid capability, no app storage', async () => {
  const basic = settingsOf({
    appium: { url: 'https://lab.example:4723/', auth: 'basic', username: 'lab' },
  });
  const store = await secrets({ remoteAppiumSecret: 'pw-secret' });
  assert.equal(await appiumHost.missing(ctxOf(basic, store)), undefined);
  assert.match((await appiumHost.missing(ctxOf(basic, await secrets())))!, /mot de passe/);
  assert.match((await appiumHost.missing(ctxOf(settingsOf(), store)))!, /adresse/);
  const target = await appiumHost.open(
    profile({ provider: 'appium', ref: 'R58M123', deviceName: '' }) as never,
    ctxOf(basic, store),
  );
  assert.equal(target.endpoint.base, 'https://lab.example:4723');
  assert.equal((target.capabilities as any)['appium:udid'], 'R58M123');
  assert.equal((target.capabilities as any)['appium:deviceName'], 'Pixel 8');
  const bearer = settingsOf({ appium: { url: 'http://lab:4723', auth: 'bearer' } });
  const probe = fakeFetch(() => ({ value: { ready: true, build: { version: '2.5.1' } } }));
  const result = await appiumHost.test(ctxOf(bearer, store, probe.impl));
  assert.match(result.message, /2\.5\.1/);
  assert.equal(probe.calls[0].headers.Authorization, 'Bearer pw-secret');
  await assert.rejects(appiumHost.upload('f', 'android', ctxOf(bearer, store)), /stockage/);
});

/* ---------- AWS Device Farm ---------- */
const dfSettings = () =>
  settingsOf({
    devicefarm: {
      accessKeyId: 'AKIAX',
      projectArn: 'arn:aws:devicefarm:us-west-2:1:project:p',
      appiumVersion: '2',
    },
  });
function farm(script: (op: string, body: any) => unknown) {
  const http = fakeFetch((url, init) => {
    // Anything that is not the Device Farm API (the presigned S3 upload) just succeeds.
    if (!url.startsWith('https://devicefarm.')) return '';
    const op = String((init.headers as Record<string, string>)['X-Amz-Target']).split('.')[1];
    return script(op, JSON.parse(String(init.body)));
  });
  return http;
}

test('device farm: a session is created, waited for until RUNNING, and handed over with its Appium URL', async () => {
  devicefarm.pollMs = 1;
  let polls = 0;
  const http = farm((op, body) => {
    if (op === 'CreateRemoteAccessSession')
      return { remoteAccessSession: { arn: 'arn:session/1' } };
    if (op === 'GetRemoteAccessSession')
      return ++polls < 3
        ? { remoteAccessSession: { status: 'PENDING_DEVICE' } }
        : {
            remoteAccessSession: {
              status: 'RUNNING',
              endpoints: {
                remoteDriverEndpoint:
                  'https://devicefarm-interactive-global.us-west-2.api.aws/remote-endpoint/ABC',
              },
            },
          };
    return {};
  });
  const store = await secrets({ awsSecretKey: 'AWS-SECRET-KEY' });
  const target = await devicefarm.open(
    profile({ provider: 'devicefarm', ref: 'arn:aws:devicefarm:us-west-2::device:XYZ' }) as never,
    ctxOf(dfSettings(), store, http.impl, () => 'arn:app/1'),
  );
  const create = http.calls[0];
  assert.equal(create.url, 'https://devicefarm.us-west-2.amazonaws.com/');
  assert.match(
    create.headers.Authorization,
    /^AWS4-HMAC-SHA256 Credential=AKIAX\/\d{8}\/us-west-2\/devicefarm\/aws4_request/,
  );
  assert.equal(create.headers['Content-Type'], 'application/x-amz-json-1.1');
  assert.equal(create.json.deviceArn, 'arn:aws:devicefarm:us-west-2::device:XYZ');
  assert.equal(create.json.appArn, 'arn:app/1');
  assert.equal(polls, 3);
  assert.equal(
    target.endpoint.base,
    'https://devicefarm-interactive-global.us-west-2.api.aws/remote-endpoint/ABC',
  );
  assert.equal((target.capabilities as any)['appium:version'], '2');
  assert.ok(
    !JSON.stringify(http.calls.map((c) => c.headers)).includes('AWS-SECRET-KEY'),
    'the secret key is never sent',
  );
  await target.close();
  assert.equal(
    String((http.calls.at(-1)!.headers as any)['X-Amz-Target']),
    'DeviceFarm_20150623.StopRemoteAccessSession',
  );
  assert.equal(http.calls.at(-1)!.json.arn, 'arn:session/1');
});

test('device farm: a session that ends before it starts is reported and always given back', async () => {
  devicefarm.pollMs = 1;
  const http = farm((op) =>
    op === 'CreateRemoteAccessSession'
      ? { remoteAccessSession: { arn: 'arn:session/2' } }
      : op === 'GetRemoteAccessSession'
        ? {
            remoteAccessSession: {
              status: 'COMPLETED',
              result: 'ERRORED',
              message: 'device unavailable',
            },
          }
        : {},
  );
  const store = await secrets({ awsSecretKey: 'AWS-SECRET-KEY' });
  await assert.rejects(
    devicefarm.open(
      profile({ provider: 'devicefarm', ref: 'arn:device' }) as never,
      ctxOf(dfSettings(), store, http.impl),
    ),
    /device unavailable/,
  );
  assert.ok(
    http.calls.some((c) =>
      String((c.headers as any)['X-Amz-Target']).endsWith('StopRemoteAccessSession'),
    ),
    'no leaked billed session',
  );
  await assert.rejects(
    devicefarm.open(
      profile({ provider: 'devicefarm', ref: '' }) as never,
      ctxOf(dfSettings(), store, http.impl),
    ),
    /ARN de l’appareil/,
  );
});

test('device farm: upload asks for a URL, puts the file, waits for SUCCEEDED; errors never echo the secret', async () => {
  devicefarm.pollMs = 1;
  let polls = 0;
  const http = fakeFetch((url, init) => {
    if (url.startsWith('https://s3.example/')) return '';
    const op = String((init.headers as any)['X-Amz-Target']).split('.')[1];
    if (op === 'CreateUpload')
      return { upload: { arn: 'arn:upload/1', url: 'https://s3.example/put?sig=1' } };
    if (op === 'GetUpload') return { upload: { status: ++polls < 2 ? 'PROCESSING' : 'SUCCEEDED' } };
    return {};
  });
  const apk = path.join(tmp(), 'app.apk');
  writeFileSync(apk, 'APK');
  const store = await secrets({ awsSecretKey: 'AWS-SECRET-KEY' });
  assert.equal(
    await devicefarm.upload(apk, 'android', ctxOf(dfSettings(), store, http.impl)),
    'arn:upload/1',
  );
  assert.equal(http.calls[0].json.type, 'ANDROID_APP');
  const put = http.calls.find((c) => c.url.startsWith('https://s3.example/'))!;
  assert.equal(put.init.method, 'PUT');
  const denied = new DeviceFarmApi(
    { accessKeyId: 'A', secretAccessKey: 'AWS-SECRET-KEY' },
    fakeFetch(() => new Response('{"message":"bad AWS-SECRET-KEY"}', { status: 403 })).impl,
  );
  await assert.rejects(
    denied.call('GetProject', {}),
    (e: Error) => /403/.test(e.message) && !e.message.includes('AWS-SECRET-KEY'),
  );
  const failing = farm((op) =>
    op === 'CreateUpload'
      ? { upload: { arn: 'a', url: 'https://s3.example/x' } }
      : op === 'GetUpload'
        ? { upload: { status: 'FAILED', message: 'not an APK' } }
        : '',
  );
  await assert.rejects(
    devicefarm.upload(apk, 'android', ctxOf(dfSettings(), store, failing.impl)),
    /not an APK/,
  );
});

/* ---------- RemoteDevices ---------- */
test('remote devices: profiles are offline with the reason until credentials exist, then ready', async () => {
  const state = {
    settings: settingsOf({
      devices: [
        profile(),
        profile({ id: 'farm', label: 'Farm', provider: 'devicefarm', ref: 'arn:d' }),
      ],
      browserstack: { username: 'bob' },
    }),
  };
  const store = await secrets();
  const remote = new RemoteDevices({ settings: () => state.settings, secrets: store });
  let devices = await remote.devices();
  assert.deepEqual(
    devices.map((d) => d.id),
    ['remote:pixel', 'remote:farm'],
  );
  assert.equal(devices[0].status, 'offline');
  assert.match(devices[0].detail, /BrowserStack · clé d’accès/);
  assert.equal(devices[0].kind, 'cloud');
  assert.deepEqual(devices[0].remote, { provider: 'browserstack', profile: 'pixel' });
  await store.set('browserstackKey', 'KEY-123456');
  devices = await remote.devices();
  assert.equal(devices[0].status, 'ready');
  assert.match(devices[0].detail, /Google Pixel 8 14\.0/);
  assert.equal(devices[1].status, 'offline');
  assert.equal(remote.profile('remote:pixel')?.label, 'Pixel 8');
  assert.equal(remote.profile('android:abc'), undefined);
});

test('remote devices: no session without an application; uploads are checked and remembered for the process', async () => {
  const store = await secrets({ browserstackKey: 'KEY-123456' });
  const http = fakeFetch(() => ({ app_url: 'bs://fresh' }));
  const remote = new RemoteDevices({
    settings: () => settingsOf({ devices: [profile()], browserstack: { username: 'bob' } }),
    secrets: store,
    fetchImpl: http.impl,
  });
  await assert.rejects(
    remote.open('remote:pixel'),
    /Aucune application Android envoyée à BrowserStack/,
  );
  await assert.rejects(remote.open('remote:nope'), /introuvable/);
  const dir = tmp();
  const wrong = path.join(dir, 'a.ipa');
  writeFileSync(wrong, 'x');
  await assert.rejects(remote.upload('browserstack', 'android', wrong), /\.apk/);
  await assert.rejects(
    remote.upload('browserstack', 'android', path.join(dir, 'missing.apk')),
    /introuvable/,
  );
  const apk = path.join(dir, 'a.apk');
  writeFileSync(apk, 'x');
  assert.equal(await remote.upload('browserstack', 'android', apk), 'bs://fresh');
  const target = await remote.open('remote:pixel');
  assert.equal((target.capabilities as any)['appium:app'], 'bs://fresh');
  const saved = new RemoteDevices({
    settings: () =>
      settingsOf({
        devices: [profile()],
        browserstack: { username: 'bob', app: { android: 'bs://saved', ios: '' } },
      }),
    secrets: store,
  });
  assert.equal(
    ((await saved.open('remote:pixel')).capabilities as any)['appium:app'],
    'bs://saved',
  );
  assert.equal(
    (
      await new RemoteDevices({ settings: () => settingsOf(), secrets: await secrets() }).test(
        'saucelabs',
      )
    ).ok,
    false,
  );
});

test('remote devices: the test button uses the configuration being edited and reports a refusal', async () => {
  const store = await secrets({ browserstackKey: 'KEY-123456' });
  const remote = new RemoteDevices({
    settings: () => settingsOf(),
    secrets: store,
    fetchImpl: fakeFetch(() => new Response('{"message":"Unauthorized"}', { status: 401 })).impl,
  });
  const draft = remoteSchema.parse({ browserstack: { username: 'bob' } });
  const refused = await remote.test('browserstack', draft);
  assert.equal(refused.ok, false);
  assert.match(refused.message, /401/);
  const ok = new RemoteDevices({
    settings: () => settingsOf(),
    secrets: store,
    fetchImpl: fakeFetch(() => ({})).impl,
  });
  assert.equal((await ok.test('browserstack', draft)).ok, true);
  const status = await ok.status();
  assert.equal(
    status.providers.browserstack.ready,
    false,
    'saved settings have no username: not ready',
  );
});

/* ---------- adb over the network ---------- */
test('adb network: connect results are read from adb’s words, retried at most every 20 s, never block a scan', async () => {
  const seen: string[][] = [];
  const answers = new Map<string, string>([
    ['10.0.0.5:5555', 'connected to 10.0.0.5:5555'],
    ['10.0.0.6:5555', 'failed to connect to 10.0.0.6:5555'],
  ]);
  const run = (async (_file: string, args: string[]) => {
    seen.push(args);
    return Buffer.from(answers.get(args[1]) ?? 'unable');
  }) as never;
  const adb = new AdbNetwork(run);
  const results = await adb.connectNow(['10.0.0.5', '10.0.0.6:5555', 'bad host', '10.0.0.5:5555']);
  assert.deepEqual(
    results.map((r) => [r.host, r.ok]),
    [
      ['10.0.0.5:5555', true],
      ['10.0.0.6:5555', false],
    ],
  );
  assert.deepEqual(seen.map((a) => a[1]).sort(), ['10.0.0.5:5555', '10.0.0.6:5555']);
  seen.length = 0;
  adb.ensure(['10.0.0.5:5555', '10.0.0.6:5555'], new Set(['10.0.0.5:5555']));
  assert.equal(seen.length, 0, 'tried a moment ago: not again');
  const fresh = new AdbNetwork(run);
  fresh.ensure(['10.0.0.5:5555', '10.0.0.6:5555'], new Set(['10.0.0.5:5555']));
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(
    seen.map((a) => a[1]),
    ['10.0.0.6:5555'],
    'a host already listed is left alone',
  );
  const states = adb.states(
    ['10.0.0.5:5555', '10.0.0.6:5555', '10.0.0.7:5555', '10.0.0.8'],
    new Map([
      ['10.0.0.5:5555', 'device'],
      ['10.0.0.7:5555', 'unauthorized'],
    ]),
  );
  assert.deepEqual(
    states.map((s) => s.state),
    ['connected', 'unreachable', 'unauthorized', 'unknown'],
  );
});

test('adb network: pairing needs an address and a 6-digit code and reads adb’s answer', async () => {
  const calls: string[][] = [];
  const adb = new AdbNetwork(
    (async (_f: string, args: string[]) => (
      calls.push(args),
      Buffer.from('Successfully paired to 10.0.0.5:37000 [guid=x]')
    )) as never,
  );
  assert.equal((await adb.pair('10.0.0.5:37000', '12')).ok, false);
  assert.equal((await adb.pair('', '123456')).ok, false);
  assert.equal(calls.length, 0);
  const ok = await adb.pair('10.0.0.5:37000', '123456');
  assert.equal(ok.ok, true);
  assert.deepEqual(calls[0], ['pair', '10.0.0.5:37000', '123456']);
  const failing = new AdbNetwork((async () => {
    throw new Error('adb: Failed: Wrong password or connection closed');
  }) as never);
  assert.match((await failing.pair('10.0.0.5:37000', '123456')).message, /Wrong password/);
});

/* ---------- Automation with a remote device ---------- */
function fakeTarget(log: string[]) {
  const target: RemoteTarget & { closed: number } = {
    closed: 0,
    capabilities: { platformName: 'Android' },
    endpoint: {
      base: 'https://cloud',
      request: async (route: string, method = 'GET') => {
        log.push(`${method} ${route}`);
        if (route === '/session') return { sessionId: 'sess-1' };
        if (route.endsWith('/execute/sync')) return 4;
        if (route.endsWith('/screenshot')) return 'iVBOR';
        return {};
      },
    } as never,
    close: async () => void target.closed++,
  };
  return target;
}
function remoteAutomation(idleMinutes = 5) {
  const log: string[] = [];
  const target = fakeTarget(log);
  const localCalls: string[] = [];
  const server = {
    request: async (r: string) => (localCalls.push(r), {}),
    isStarting: false,
    ensure: async () => {},
    stop() {},
  } as never;
  const device: Device = {
    id: 'remote:pixel',
    name: 'Pixel 8',
    platform: 'android',
    kind: 'cloud',
    status: 'ready',
    detail: '',
    remote: { provider: 'browserstack', profile: 'pixel' },
  };
  const settings = settingsOf({ idleMinutes });
  const automation = new Automation(
    server,
    (id) => (id === device.id ? device : undefined),
    () => settings,
    () => {},
    tmp(),
  );
  let opened = 0;
  automation.remote = { open: async () => (opened++, target) } as never;
  return { automation, log, target, localCalls, device, opened: () => opened };
}

test('automation: a cloud session only starts under a lease, uses the provider endpoint, and ends with the lease', async () => {
  const { automation, log, target, localCalls, opened } = remoteAutomation();
  await assert.rejects(
    automation.ensureApplication('remote:pixel', 'com.acme'),
    /session \(facturée/,
  );
  assert.equal(opened(), 0, 'no billed session without a run');
  automation.acquire(['remote:pixel'], 'run-1');
  await automation.ensureApplication('remote:pixel', 'com.acme', 'run-1');
  assert.equal(opened(), 1);
  assert.equal(log[0], 'POST /session');
  assert.ok(log.some((l) => l.includes('/session/sess-1/execute/sync')));
  assert.deepEqual(localCalls, [], 'nothing went to the local Appium server');
  assert.equal(automation.connectionState('remote:pixel').connected, true);
  assert.match((await automation.screenshot('remote:pixel'))!, /^data:image\/png;base64,iVBOR/);
  automation.release('run-1');
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(log.includes('DELETE /session/sess-1'));
  assert.equal(target.closed, 1);
  assert.equal(automation.connectionState('remote:pixel').connected, false);
  await assert.rejects(
    automation.ensureApplication('remote:pixel', 'com.acme'),
    /session \(facturée/,
  );
  await automation.stop();
});

test('automation: « Reconnect » opens a cloud session by hand and an idle one is closed; stop gives everything back', async () => {
  const t = remoteAutomation(1);
  await t.automation.reconnect('remote:pixel');
  assert.equal(t.opened(), 1);
  await t.automation.ensureApplication('remote:pixel', 'com.acme');
  const realNow = Date.now;
  Date.now = () => realNow() + 2 * 60000;
  try {
    await (t.automation as any).sweepRemote();
  } finally {
    Date.now = realNow;
  }
  assert.equal(t.target.closed, 1, 'idle for over a minute: given back');
  const u = remoteAutomation();
  await u.automation.reconnect('remote:pixel');
  await u.automation.stop();
  assert.equal(u.target.closed, 1, 'closing the app ends the billed session');
  // A session that dies is replaced without leaking the provider side of the old one.
  const v = remoteAutomation();
  await v.automation.reconnect('remote:pixel');
  await v.automation.reconnect('remote:pixel');
  assert.equal(v.target.closed, 1, 'the first session was closed before the second opened');
  assert.equal(v.opened(), 2);
  await v.automation.stop();
  await t.automation.stop();
});

/* ---------- command line ---------- */
test('cli args: remote actions and the new run options are parsed, mistakes are refused', () => {
  const run = parseArgs([
    'run',
    '--adb-host',
    '10.0.0.5:5555, 10.0.0.6',
    '--android-app-ref',
    'bs://x',
    '--ios-app-ref=storage:y',
  ]);
  assert.equal(run.name, 'run');
  if (run.name === 'run') {
    assert.deepEqual(run.options.adbHosts, ['10.0.0.5:5555', '10.0.0.6']);
    assert.equal(run.options.androidAppRef, 'bs://x');
    assert.equal(run.options.iosAppRef, 'storage:y');
  }
  assert.deepEqual(
    parseArgs(['run']).name === 'run' && (parseArgs(['run']) as any).options.adbHosts,
    [],
  );
  const test = parseArgs(['remote', 'test', 'devicefarm', '--json']);
  assert.deepEqual(
    [test.name, (test as any).action, (test as any).provider, (test as any).json],
    ['remote', 'test', 'devicefarm', true],
  );
  const up = parseArgs(['remote', 'upload', 'browserstack', 'app.apk', '--platform', 'android']);
  assert.deepEqual(
    [(up as any).provider, (up as any).positional, (up as any).platform],
    ['browserstack', ['app.apk'], 'android'],
  );
  const connect = parseArgs([
    'remote',
    'adb-connect',
    '10.0.0.5',
    '10.0.0.6:5556',
    '--adb-host',
    '10.0.0.7',
  ]);
  assert.deepEqual((connect as any).adbHosts, ['10.0.0.5', '10.0.0.6:5556', '10.0.0.7']);
  assert.deepEqual(
    (parseArgs(['remote', 'adb-pair', '10.0.0.5:37000', '123456']) as any).positional,
    ['10.0.0.5:37000', '123456'],
  );
  assert.equal((parseArgs(['devices', '--adb-host', '10.0.0.5']) as any).adbHosts[0], '10.0.0.5');
  const bad = (...a: string[]) => assert.throws(() => parseArgs(a), UsageError);
  bad('remote');
  bad('remote', 'nope');
  bad('remote', 'test');
  bad('remote', 'test', 'aws');
  bad('remote', 'upload', 'browserstack');
  bad('remote', 'adb-pair', '10.0.0.5');
  bad('remote', 'status', 'extra');
  bad('remote', 'status', '--project', 'x');
  bad('remote', 'upload', 'browserstack', 'a.apk', '--platform', 'windows');
  bad('run', 'stray');
  bad('devices', '--project', 'x');
});

const cloudDevice = (over: Partial<Device> = {}): Device => ({
  id: 'remote:pixel',
  name: 'Pixel 8',
  platform: 'android',
  kind: 'cloud',
  status: 'ready',
  detail: 'BrowserStack · Google Pixel 8 14.0',
  remote: { provider: 'browserstack', profile: 'pixel' },
  ...over,
});

test('cli: a cloud device is chosen like any other, and an unusable one says why', () => {
  const project = { deviceIds: { android: 'remote:pixel' } } as unknown as Project;
  assert.equal(
    chooseDevices(project, ['android'], [cloudDevice()], {}).android?.id,
    'remote:pixel',
  );
  assert.equal(
    chooseDevices({ deviceIds: {} } as unknown as Project, ['android'], [cloudDevice()], {
      android: 'pixel 8',
    }).android?.id,
    'remote:pixel',
  );
  assert.throws(
    () =>
      chooseDevices(
        project,
        ['android'],
        [cloudDevice({ status: 'offline', detail: 'BrowserStack · clé d’accès manquante' })],
        {},
      ),
    /clé d’accès manquante/,
  );
});

test('cli install: a build for a cloud device is uploaded to its provider, not installed', async () => {
  const dir = tmp();
  const apk = path.join(dir, 'a.apk');
  writeFileSync(apk, 'x');
  const uploads: string[] = [];
  const lines: string[] = [];
  const uploader = {
    upload: async (p: string, platform: string, file: string) => (
      uploads.push(`${p}:${platform}:${path.basename(file)}`),
      'bs://ref'
    ),
  };
  await installBuild(
    cloudDevice(),
    apk,
    'com.acme',
    true,
    (l) => lines.push(l),
    (async () => {
      throw new Error('adb must not run');
    }) as never,
    uploader as never,
  );
  assert.deepEqual(uploads, ['browserstack:android:a.apk']);
  assert.ok(lines.some((l) => /bs:\/\/ref/.test(l) && /--fresh/.test(l)));
  await assert.rejects(
    installBuild(cloudDevice(), path.join(dir, 'x.ipa'), '', false, () => {}),
    /introuvable/,
  );
  const ipa = path.join(dir, 'a.ipa');
  writeFileSync(ipa, 'x');
  await assert.rejects(
    installBuild(cloudDevice(), ipa, '', false, () => {}, undefined, uploader as never),
    /\.apk/,
  );
  await installBuild(
    cloudDevice({
      id: 'remote:ios',
      platform: 'ios',
      name: 'iPhone',
      remote: { provider: 'saucelabs', profile: 'ios' },
    }),
    ipa,
    '',
    false,
    () => {},
    undefined,
    uploader as never,
  );
  assert.equal(uploads.at(-1), 'saucelabs:ios:a.ipa');
});

test('cli runCli remote: status, test and upload answer with the right exit code on an empty setup', async () => {
  const data = tmp();
  const out: string[] = [];
  const err: string[] = [];
  const io = { out: (l: string) => out.push(l), err: (l: string) => err.push(l) };
  followLanguage(() => 'fr');
  assert.equal(await runCli(['remote', 'status', '--data-dir', data, '--json'], io), EXIT.OK);
  const status = JSON.parse(out.join('\n'));
  assert.equal(status.providers.browserstack.ready, false);
  assert.equal(
    await runCli(['remote', 'test', 'browserstack', '--data-dir', data], io),
    EXIT.USAGE_OR_INFRA,
  );
  assert.match(err.join('\n'), /nom d’utilisateur BrowserStack/);
  assert.equal(
    await runCli(['remote', 'upload', 'browserstack', '/nope/a.apk', '--data-dir', data], io),
    EXIT.USAGE_OR_INFRA,
  );
  assert.equal(
    await runCli(['remote', 'adb-pair', 'bad host', '123456', '--data-dir', data], io),
    EXIT.USAGE_OR_INFRA,
  );
  assert.equal(
    await runCli(['remote', 'adb-connect', '--data-dir', data], io),
    EXIT.USAGE_OR_INFRA,
  );
  assert.match(err.join('\n'), /Aucun hôte/);
});

test('remote devices: CI environment variables fill in what the settings leave empty', async () => {
  const store = await secrets();
  const remote = new RemoteDevices({ settings: () => settingsOf(), secrets: store });
  assert.match((await remote.missing('browserstack'))!, /nom d’utilisateur/);
  process.env.BROWSERSTACK_USERNAME = 'ci-user';
  process.env.BROWSERSTACK_ACCESS_KEY = 'ci-key-123';
  try {
    assert.equal(await remote.missing('browserstack'), undefined);
    assert.equal((await remote.status()).providers.browserstack.ready, true);
  } finally {
    delete process.env.BROWSERSTACK_USERNAME;
    delete process.env.BROWSERSTACK_ACCESS_KEY;
  }
  assert.match((await remote.missing('browserstack'))!, /nom d’utilisateur/);
});
