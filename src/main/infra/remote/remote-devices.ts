import { promises as fs } from 'node:fs';
import type { Device } from '../../../shared/domain/devices.js';
import {
  PROVIDER_LABEL,
  REMOTE_PREFIX,
  REMOTE_PROVIDERS,
  remoteIdOf,
  type RemoteDevice,
  type RemoteProvider,
  type RemoteSettings,
  type RemoteStatus,
} from '../../../shared/domain/remote.js';
import type { OS } from '../../../shared/domain/scenario.js';
import type { Settings } from '../../../shared/domain/settings.js';
import { tr } from '../../integrations/i18n.js';
import type { SecretStore } from '../../integrations/secrets.js';
import { AdbNetwork, type Run } from './adb-network.js';
import { devicefarm } from './devicefarm.js';
import {
  appiumHost,
  browserstack,
  saucelabs,
  type Provider,
  type ProviderContext,
  type RemoteTarget,
} from './providers.js';

const PROVIDERS: Record<RemoteProvider, Provider> = {
  browserstack,
  saucelabs,
  devicefarm,
  appium: appiumHost,
};

/** Everything about phones that are not plugged into this machine. */
export class RemoteDevices {
  readonly adb: AdbNetwork;
  /** References of applications uploaded for this process only (command line), above the saved ones. */
  private overrides = new Map<string, string>();

  constructor(
    private d: {
      settings: () => Settings;
      secrets: SecretStore;
      fetchImpl?: typeof fetch;
      run?: Run;
    },
  ) {
    this.adb = new AdbNetwork(d.run);
  }

  /** Usernames the vendors' own tools already export in CI: used when the settings leave them empty. */
  private withEnvironment(remote: RemoteSettings): RemoteSettings {
    const env = process.env;
    return {
      ...remote,
      browserstack: {
        ...remote.browserstack,
        username: remote.browserstack.username || env.BROWSERSTACK_USERNAME?.trim() || '',
      },
      saucelabs: {
        ...remote.saucelabs,
        username: remote.saucelabs.username || env.SAUCE_USERNAME?.trim() || '',
      },
      devicefarm: {
        ...remote.devicefarm,
        accessKeyId: remote.devicefarm.accessKeyId || env.AWS_ACCESS_KEY_ID?.trim() || '',
      },
    };
  }
  private context(remote: RemoteSettings = this.d.settings().remote): ProviderContext {
    remote = this.withEnvironment(remote);
    return {
      settings: remote,
      secret: (key) => this.d.secrets.get(key),
      fetchImpl: this.d.fetchImpl,
      app: (platform: OS) => this.appRef(remote, platform),
    };
  }
  private currentProvider = (device: RemoteDevice) => device.provider;
  private appRef(remote: RemoteSettings, platform: OS, provider?: RemoteProvider) {
    return (provider ? [provider] : REMOTE_PROVIDERS)
      .map(
        (p) =>
          this.overrides.get(`${p}:${platform}`) ??
          (p === 'appium' ? undefined : remote[p].app[platform]),
      )
      .find(Boolean);
  }
  setAppOverride(provider: RemoteProvider, platform: OS, ref: string) {
    this.overrides.set(`${provider}:${platform}`, ref);
  }

  async missing(provider: RemoteProvider, remote?: RemoteSettings) {
    return PROVIDERS[provider].missing(this.context(remote));
  }

  /** The profiles of Settings as devices of the Devices panel. Offline (with the reason) until credentials exist. */
  async devices(): Promise<Device[]> {
    const remote = this.d.settings().remote;
    const ready = new Map<RemoteProvider, string | undefined>();
    const out: Device[] = [];
    for (const profile of remote.devices) {
      if (!ready.has(profile.provider))
        ready.set(profile.provider, await this.missing(profile.provider));
      const missing = ready.get(profile.provider);
      out.push({
        id: REMOTE_PREFIX + profile.id,
        name: profile.label,
        platform: profile.platform,
        kind: 'cloud',
        status: missing ? 'offline' : 'ready',
        osVersion: profile.osVersion || undefined,
        detail: missing
          ? `${PROVIDER_LABEL[profile.provider]} · ${missing}`
          : `${PROVIDER_LABEL[profile.provider]} · ${[profile.deviceName, profile.osVersion].filter(Boolean).join(' ') || profile.ref}`,
        remote: { provider: profile.provider, profile: profile.id },
      });
    }
    return out;
  }
  profile(deviceId: string): RemoteDevice | undefined {
    return deviceId.startsWith(REMOTE_PREFIX)
      ? this.d.settings().remote.devices.find((p) => p.id === remoteIdOf(deviceId))
      : undefined;
  }

  /** Opens the provider side of a session (and allocates what it needs). The caller must `close()` it. */
  async open(deviceId: string): Promise<RemoteTarget> {
    const profile = this.profile(deviceId);
    if (!profile)
      throw new Error(
        tr('Profil d’appareil distant introuvable : ', 'Remote device profile not found: ') +
          deviceId,
      );
    const ctx = this.context();
    const provider = PROVIDERS[this.currentProvider(profile)];
    const missing = await provider.missing(ctx);
    if (missing) throw new Error(`${PROVIDER_LABEL[profile.provider]} : ${missing}`);
    if (
      profile.provider !== 'appium' &&
      profile.provider !== 'devicefarm' &&
      !ctx.app(profile.platform)
    )
      throw new Error(
        tr(
          `Aucune application ${profile.platform === 'ios' ? 'iOS' : 'Android'} envoyée à ${PROVIDER_LABEL[profile.provider]} : envoyez un fichier dans Réglages → Appareils (ou --${profile.platform}-app en ligne de commande).`,
          `No ${profile.platform === 'ios' ? 'iOS' : 'Android'} application sent to ${PROVIDER_LABEL[profile.provider]}: upload a file in Settings → Devices (or --${profile.platform}-app on the command line).`,
        ),
      );
    return provider.open(profile, ctx);
  }

  async upload(provider: RemoteProvider, platform: OS, file: string): Promise<string> {
    const ctx = this.context();
    const missing = await PROVIDERS[provider].missing(ctx);
    if (missing) throw new Error(`${PROVIDER_LABEL[provider]} : ${missing}`);
    const stat = await fs.stat(file).catch(() => null);
    if (!stat?.isFile()) throw new Error(tr('Fichier introuvable : ', 'File not found: ') + file);
    const ext = file.toLowerCase().split('.').pop();
    if (platform === 'android' ? ext !== 'apk' : ext !== 'ipa' && ext !== 'zip')
      throw new Error(
        platform === 'android'
          ? tr('Un fichier .apk est attendu pour Android.', 'An .apk file is expected for Android.')
          : tr(
              'Un fichier .ipa est attendu pour iOS (compilé pour un appareil réel).',
              'An .ipa file is expected for iOS (built for a real device).',
            ),
      );
    const ref = await PROVIDERS[provider].upload(file, platform, ctx);
    this.setAppOverride(provider, platform, ref);
    return ref;
  }

  /** Read-only check of the credentials, with the configuration being edited (not necessarily saved yet). */
  async test(
    provider: RemoteProvider,
    remote?: RemoteSettings,
  ): Promise<{ ok: boolean; message: string }> {
    const ctx = this.context(remote);
    const missing = await PROVIDERS[provider].missing(ctx);
    if (missing) return { ok: false, message: missing };
    try {
      return await PROVIDERS[provider].test(ctx);
    } catch (error) {
      return { ok: false, message: String((error as Error).message ?? error) };
    }
  }

  async status(
    listed: Map<string, 'device' | 'unauthorized' | 'offline'> = new Map(),
  ): Promise<RemoteStatus> {
    const remote = this.d.settings().remote;
    const providers = {} as RemoteStatus['providers'];
    for (const p of REMOTE_PROVIDERS) {
      const missing = await this.missing(p);
      providers[p] = { ready: !missing, missing: missing ?? '' };
    }
    return { adb: this.adb.states(remote.adb.hosts, listed), providers };
  }
}
