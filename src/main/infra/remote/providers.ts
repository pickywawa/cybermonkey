import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  PROVIDER_LABEL,
  type RemoteDevice,
  type RemoteProvider,
  type RemoteSettings,
} from '../../../shared/domain/remote.js';
import type { OS } from '../../../shared/domain/scenario.js';
import type { SecretKey } from '../../../shared/domain/integrations.js';
import { basicAuth, request, trimSlash } from '../../integrations/http.js';
import { tr } from '../../integrations/i18n.js';
import { RemoteAppium } from './endpoint.js';

/** A session target: where to talk Appium, as whom, with which capabilities, and how to give the device back. */
export interface RemoteTarget {
  endpoint: RemoteAppium;
  capabilities: Record<string, unknown>;
  /** Frees whatever was allocated for this device (a Device Farm session). Never throws. */
  close(): Promise<void>;
}
export interface ProviderContext {
  settings: RemoteSettings;
  secret(key: SecretKey): Promise<string | undefined>;
  fetchImpl?: typeof fetch;
  /** The application reference to install for this platform, when the provider needs one. */
  app(platform: OS): string | undefined;
}
export interface Provider {
  /** Why a session cannot be opened yet (in words), or undefined when everything is there. */
  missing(ctx: ProviderContext): Promise<string | undefined>;
  open(device: RemoteDevice, ctx: ProviderContext): Promise<RemoteTarget>;
  /** Puts an application file on the provider and returns the reference to install it from. */
  upload(file: string, platform: OS, ctx: ProviderContext): Promise<string>;
  /** Read-only check of the credentials. */
  test(ctx: ProviderContext): Promise<{ ok: boolean; message: string }>;
}

const android = (os: OS) => os === 'android';
const baseCaps = (device: RemoteDevice) => ({
  platformName: android(device.platform) ? 'Android' : 'iOS',
  'appium:automationName': android(device.platform) ? 'UiAutomator2' : 'XCUITest',
  // Our engine opens the application itself (activateApp): never let the session decide.
  'appium:autoLaunch': false,
  'appium:newCommandTimeout': 600,
});
const stamp = () => new Date().toISOString().slice(0, 16).replace('T', ' ');
const noClose = async () => {};
const name = (device: RemoteDevice) => `Cybermonkey · ${device.label}`;

async function fileForm(file: string, field: string, extra: Record<string, string> = {}) {
  const form = new FormData();
  form.append(field, new Blob([await fs.readFile(file)]), path.basename(file));
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return form;
}

/* ---------- BrowserStack App Automate ---------- */
export const BROWSERSTACK_HUB = 'https://hub-cloud.browserstack.com/wd/hub';
const BROWSERSTACK_API = 'https://api-cloud.browserstack.com/app-automate';
export const browserstack: Provider = {
  async missing(ctx) {
    if (!ctx.settings.browserstack.username)
      return tr('nom d’utilisateur BrowserStack manquant', 'BrowserStack username missing');
    if (!(await ctx.secret('browserstackKey')))
      return tr('clé d’accès BrowserStack manquante', 'BrowserStack access key missing');
  },
  async open(device, ctx) {
    const key = (await ctx.secret('browserstackKey'))!;
    const c = ctx.settings.browserstack;
    const app = ctx.app(device.platform);
    const capabilities = {
      ...baseCaps(device),
      'appium:deviceName': device.deviceName,
      ...(device.osVersion ? { 'appium:platformVersion': device.osVersion } : {}),
      ...(app ? { 'appium:app': app } : {}),
      'bstack:options': {
        userName: c.username,
        accessKey: key,
        projectName: 'Cybermonkey',
        buildName: `Cybermonkey ${stamp()}`,
        sessionName: name(device),
        ...(c.appiumVersion ? { appiumVersion: c.appiumVersion } : {}),
      },
    };
    return {
      endpoint: new RemoteAppium(
        BROWSERSTACK_HUB,
        { Authorization: basicAuth(c.username, key) },
        ctx.fetchImpl,
        [key],
      ),
      capabilities,
      close: noClose,
    };
  },
  async upload(file, _platform, ctx) {
    const key = (await ctx.secret('browserstackKey'))!;
    const result = await request<{ app_url?: string }>(`${BROWSERSTACK_API}/upload`, {
      body: await fileForm(file, 'file'),
      headers: { Authorization: basicAuth(ctx.settings.browserstack.username, key) },
      secrets: [key],
      fetchImpl: ctx.fetchImpl,
      timeoutMs: 600000,
    });
    if (!result?.app_url)
      throw new Error(
        tr(
          'BrowserStack n’a pas renvoyé de référence (app_url).',
          'BrowserStack returned no app reference (app_url).',
        ),
      );
    return result.app_url;
  },
  async test(ctx) {
    const key = (await ctx.secret('browserstackKey'))!;
    const plan = await request<{ parallel_sessions_max_allowed?: number }>(
      `${BROWSERSTACK_API}/plan.json`,
      {
        headers: { Authorization: basicAuth(ctx.settings.browserstack.username, key) },
        secrets: [key],
        fetchImpl: ctx.fetchImpl,
      },
    );
    return {
      ok: true,
      message: tr(
        `Compte BrowserStack joignable${plan?.parallel_sessions_max_allowed ? ` (${plan.parallel_sessions_max_allowed} sessions en parallèle)` : ''}.`,
        `BrowserStack account reachable${plan?.parallel_sessions_max_allowed ? ` (${plan.parallel_sessions_max_allowed} parallel sessions)` : ''}.`,
      ),
    };
  },
};

/* ---------- Sauce Labs real devices ---------- */
const sauceHub = (region: string) => `https://ondemand.${region}.saucelabs.com/wd/hub`;
const sauceApi = (region: string) => `https://api.${region}.saucelabs.com`;
export const saucelabs: Provider = {
  async missing(ctx) {
    if (!ctx.settings.saucelabs.username)
      return tr('nom d’utilisateur Sauce Labs manquant', 'Sauce Labs username missing');
    if (!(await ctx.secret('saucelabsKey')))
      return tr('clé d’accès Sauce Labs manquante', 'Sauce Labs access key missing');
  },
  async open(device, ctx) {
    const key = (await ctx.secret('saucelabsKey'))!;
    const c = ctx.settings.saucelabs;
    const app = ctx.app(device.platform);
    const capabilities = {
      ...baseCaps(device),
      'appium:deviceName': device.deviceName,
      ...(device.osVersion ? { 'appium:platformVersion': device.osVersion } : {}),
      ...(app ? { 'appium:app': app } : {}),
      'sauce:options': {
        username: c.username,
        accessKey: key,
        name: name(device),
        build: `Cybermonkey ${stamp()}`,
        ...(c.appiumVersion ? { appiumVersion: c.appiumVersion } : {}),
      },
    };
    return {
      endpoint: new RemoteAppium(
        sauceHub(c.region),
        { Authorization: basicAuth(c.username, key) },
        ctx.fetchImpl,
        [key],
      ),
      capabilities,
      close: noClose,
    };
  },
  async upload(file, _platform, ctx) {
    const key = (await ctx.secret('saucelabsKey'))!;
    const c = ctx.settings.saucelabs;
    const result = await request<{ item?: { id?: string; name?: string } }>(
      `${sauceApi(c.region)}/v1/storage/upload`,
      {
        body: await fileForm(file, 'payload', { name: path.basename(file) }),
        headers: { Authorization: basicAuth(c.username, key) },
        secrets: [key],
        fetchImpl: ctx.fetchImpl,
        timeoutMs: 600000,
      },
    );
    const item = result?.item;
    if (item?.id) return `storage:${item.id}`;
    if (item?.name) return `storage:filename=${item.name}`;
    throw new Error(
      tr(
        'Sauce Labs n’a pas renvoyé de référence de stockage.',
        'Sauce Labs returned no storage reference.',
      ),
    );
  },
  async test(ctx) {
    const key = (await ctx.secret('saucelabsKey'))!;
    const c = ctx.settings.saucelabs;
    const user = await request<{ username?: string }>(
      `${sauceApi(c.region)}/rest/v1/users/${encodeURIComponent(c.username)}`,
      {
        headers: { Authorization: basicAuth(c.username, key) },
        secrets: [key],
        fetchImpl: ctx.fetchImpl,
      },
    );
    return {
      ok: true,
      message: tr(
        `Compte Sauce Labs « ${user?.username ?? c.username} » joignable (${c.region}).`,
        `Sauce Labs account “${user?.username ?? c.username}” reachable (${c.region}).`,
      ),
    };
  },
};

/* ---------- your own Appium server (a device lab) ---------- */
export const appiumHost: Provider = {
  async missing(ctx) {
    const c = ctx.settings.appium;
    if (!c.url) return tr('adresse du serveur Appium manquante', 'Appium server URL missing');
    if (c.auth !== 'none' && !(await ctx.secret('remoteAppiumSecret')))
      return tr(
        'mot de passe ou jeton du serveur Appium manquant',
        'Appium server password or token missing',
      );
  },
  async open(device, ctx) {
    const c = ctx.settings.appium;
    const secret = c.auth === 'none' ? undefined : await ctx.secret('remoteAppiumSecret');
    const headers: Record<string, string> = {};
    if (c.auth === 'basic' && secret) headers.Authorization = basicAuth(c.username, secret);
    if (c.auth === 'bearer' && secret) headers.Authorization = `Bearer ${secret}`;
    return {
      endpoint: new RemoteAppium(trimSlash(c.url), headers, ctx.fetchImpl, secret ? [secret] : []),
      capabilities: {
        ...baseCaps(device),
        'appium:udid': device.ref,
        'appium:deviceName': device.deviceName || device.label,
        ...(device.osVersion ? { 'appium:platformVersion': device.osVersion } : {}),
        'appium:noReset': true,
      },
      close: noClose,
    };
  },
  async upload() {
    throw new Error(
      tr(
        'Un serveur Appium personnel n’a pas de stockage d’applications : installez l’application sur ses appareils.',
        'Your own Appium server has no app storage: install the application on its devices.',
      ),
    );
  },
  async test(ctx) {
    const c = ctx.settings.appium;
    const secret = c.auth === 'none' ? undefined : await ctx.secret('remoteAppiumSecret');
    const headers: Record<string, string> = {};
    if (c.auth === 'basic' && secret) headers.Authorization = basicAuth(c.username, secret);
    if (c.auth === 'bearer' && secret) headers.Authorization = `Bearer ${secret}`;
    const endpoint = new RemoteAppium(
      trimSlash(c.url),
      headers,
      ctx.fetchImpl,
      secret ? [secret] : [],
    );
    const status = await endpoint.request('/status', 'GET', undefined, 8000);
    if (!status?.ready)
      throw new Error(
        tr('Le serveur répond mais n’est pas prêt.', 'The server answers but is not ready.'),
      );
    return {
      ok: true,
      message: tr(
        `Serveur Appium joignable${status.build?.version ? ` (version ${status.build.version})` : ''}.`,
        `Appium server reachable${status.build?.version ? ` (version ${status.build.version})` : ''}.`,
      ),
    };
  },
};

export const label = (p: RemoteProvider) => PROVIDER_LABEL[p];
