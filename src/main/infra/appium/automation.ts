import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import type { Device, Screen } from '../../../shared/domain/devices.js';
import type { AppInfo } from '../../../shared/domain/project.js';
import type { Locator, NodeKind, Variant } from '../../../shared/domain/scenario.js';
import type { Settings } from '../../../shared/domain/settings.js';
import { resolveVariant } from '../../../shared/domain/variables.js';
import type { LiveEvent } from '../../../shared/ipc.js';
import { command } from '../env.js';
import { log } from '../log.js';
import { nodeModules } from '../paths.js';
import { androidApplicationInfo } from '../devices/app-info.js';
import { iosCapabilities } from './ios-config.js';
import { performOperation, StepError } from './operations.js';
import { prepareWdaRuntime } from './runtime.js';
import type { AppiumServer } from './server.js';
import { parseScreen } from './source.js';

type KeepAwake = {
  state: 'waiting' | 'active' | 'paused' | 'locked' | 'error';
  detail?: string;
  lastActivity?: string;
};
const SESSION_LOST =
  /invalid session id|NoSuchDriver|socket hang up|ECONNRESET|session.*(terminated|not started)/i;

/**
 * Device sessions + exclusive leases. A lease lets one owner (a run, an AI exploration, the recorder)
 * drive a device without interference from mirror polling or another feature.
 */
export class Automation {
  private sessions = new Map<string, string>();
  private connecting = new Map<string, Promise<string>>();
  private failures = new Map<string, string>();
  private locks = new Map<string, Promise<unknown>>();
  private leases = new Map<string, string>();
  private queued = new Map<string, number>();
  private keepAwakeStates = new Map<string, KeepAwake>();
  private keepAwakeRunning = false;
  private stopping = false;
  private cleaned = false;
  private timer: ReturnType<typeof setInterval>;

  constructor(
    private server: AppiumServer,
    private device: (id: string) => Device | undefined,
    private settings: () => Settings,
    private emit: (event: LiveEvent) => void,
    private runtimeHome: string,
    private selectedDevices: () => string[] = () => [],
  ) {
    this.timer = setInterval(() => void this.keepAwakeTick(), 20000);
    this.timer.unref();
  }

  /* ---------- leases & serialization ---------- */
  acquire(ids: string[], owner: string) {
    for (const id of ids)
      if (this.leases.has(id))
        throw new Error(
          'Appareil déjà utilisé par une exécution, une exploration IA ou l’enregistrement',
        );
    for (const id of ids) this.leases.set(id, owner);
  }
  release(owner: string) {
    for (const [id, value] of this.leases) if (value === owner) this.leases.delete(id);
  }
  leaseOwner(id: string) {
    return this.leases.get(id);
  }
  private check(id: string, owner?: string) {
    const held = this.leases.get(id);
    if (held && held !== owner)
      throw new Error('Appareil occupé par une exécution, une exploration IA ou l’enregistrement');
  }
  private serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
    this.queued.set(id, (this.queued.get(id) ?? 0) + 1);
    const pending: Promise<T> = (this.locks.get(id) ?? Promise.resolve())
      .catch(() => {})
      .then(fn)
      .finally(() => {
        const n = (this.queued.get(id) ?? 1) - 1;
        if (n) this.queued.set(id, n);
        else this.queued.delete(id);
        if (this.locks.get(id) === pending) this.locks.delete(id);
      });
    this.locks.set(id, pending);
    return pending;
  }

  connectionState(id: string) {
    return {
      connected: this.sessions.has(id),
      sessionId: this.sessions.get(id),
      connecting: this.connecting.has(id),
      starting: this.server.isStarting,
      failure: this.failures.get(id),
      keepAwake: this.keepAwakeStates.get(id),
    };
  }

  /* ---------- sessions ---------- */
  private async session(id: string): Promise<string> {
    if (this.stopping) throw new Error('Cybermonkey est en cours de fermeture.');
    const current = this.sessions.get(id);
    if (current) return current;
    const pending = this.connecting.get(id);
    if (pending) return pending;
    const task = this.connect(id)
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        log('automation', `connect failed ${id}: ${message.slice(0, 400)}`);
        const ios = !id.startsWith('android:');
        this.failures.set(
          id,
          message + (ios && this.server.xcodeLog ? '\n\nXcode :\n' + this.server.xcodeLog : ''),
        );
        if (ios) {
          const reasons = this.server.xcodeLog
            .split('\n')
            .filter((l) =>
              /error:|No profiles|No Accounts|requires a development team|signing certificate|provisioning profile/i.test(
                l,
              ),
            )
            .slice(-5)
            .join('\n');
          throw new Error(`Connexion iOS impossible. ${message}${reasons ? '\n' + reasons : ''}`);
        }
        throw error;
      })
      .finally(() => this.connecting.delete(id));
    this.connecting.set(id, task);
    return task;
  }
  private async connect(id: string): Promise<string> {
    const device = this.device(id);
    if (!device || device.status !== 'ready') throw new Error('Appareil non connecté');
    log('automation', `connecting ${id}`);
    if (!this.cleaned && !id.startsWith('android:')) {
      this.cleaned = true;
      await this.killWda();
    }
    await this.server.ensure();
    const android = device.platform === 'android';
    const caps: Record<string, unknown> = {
      platformName: android ? 'Android' : 'iOS',
      'appium:automationName': android ? 'UiAutomator2' : 'XCUITest',
      'appium:udid': id.slice(id.indexOf(':') + 1),
      'appium:noReset': true,
      'appium:newCommandTimeout': 600,
      'appium:deviceName': device.name,
      'appium:autoLaunch': false,
    };
    const same = [...this.sessions.keys(), ...this.connecting.keys()].filter(
      (s) => s.startsWith('android:') === android,
    );
    if (android) caps['appium:systemPort'] = 8200 + same.indexOf(id);
    else {
      this.server.xcodeLog = '';
      Object.assign(caps, iosCapabilities(this.settings(), device));
      if (this.settings().iosWdaMode === 'build') {
        const bootstrap = await prepareWdaRuntime(nodeModules(), this.runtimeHome, id);
        caps['appium:bootstrapPath'] = bootstrap;
        caps['appium:agentPath'] = path.join(bootstrap, 'WebDriverAgent.xcodeproj');
        caps['appium:derivedDataPath'] = path.join(bootstrap, 'DerivedData');
      }
      caps['appium:wdaLocalPort'] = 8101 + same.indexOf(id);
      // Animated apps (calendars, carousels) never go idle: do not let quiescence waits stall commands.
      caps['appium:waitForIdleTimeout'] = 0;
      caps['appium:animationCoolOffTimeout'] = 0;
    }
    const value = await this.server.request(
      '/session',
      'POST',
      { capabilities: { alwaysMatch: caps, firstMatch: [{}] } },
      180000,
    );
    if (!value.sessionId) throw new Error('Appium : session sans identifiant');
    log('automation', `session ready ${id}`);
    this.failures.delete(id);
    this.sessions.set(id, value.sessionId);
    return value.sessionId;
  }
  /** Run an idempotent call; if the session died, reopen it once and retry. */
  private async withSession<T>(
    id: string,
    fn: (session: string) => Promise<T>,
    retry = true,
  ): Promise<T> {
    const session = await this.session(id);
    try {
      return await fn(session);
    } catch (error) {
      const text = `${(error as { code?: string }).code ?? ''} ${(error as Error).message}`;
      if (SESSION_LOST.test(text)) {
        this.sessions.delete(id);
        if (retry) return this.withSession(id, fn, false);
      }
      throw error;
    }
  }
  async reconnect(id: string) {
    const session = this.sessions.get(id);
    this.sessions.delete(id);
    this.failures.delete(id);
    if (session)
      await this.server.request(`/session/${session}`, 'DELETE', undefined, 3000).catch(() => {});
    await this.session(id);
  }

  /* ---------- queries ---------- */
  async inspect(id: string, owner?: string): Promise<Screen> {
    this.check(id, owner);
    return this.serial(id, () =>
      this.withSession(id, async (session) => {
        const screen = parseScreen(await this.server.request(`/session/${session}/source`), id);
        this.emit({ type: 'device', deviceId: id, ready: true });
        return screen;
      }),
    );
  }
  /** Every marker matches exactly one element: a handful of tiny requests instead of a page-source download. */
  async markersPresent(id: string, markers: Locator[], owner?: string): Promise<boolean> {
    this.check(id, owner);
    return this.serial(id, () =>
      this.withSession(id, async (session) => {
        for (const marker of markers) {
          const found: unknown[] = await this.server.request(
            `/session/${session}/elements`,
            'POST',
            marker,
            15000,
          );
          if (found.length !== 1) return false;
        }
        return true;
      }),
    );
  }
  async screenshot(id: string): Promise<string | undefined> {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    return `data:image/png;base64,${await this.server.request(`/session/${session}/screenshot`)}`;
  }

  /* ---------- actions ---------- */
  async perform(
    id: string,
    variant: Variant,
    kind: NodeKind,
    owner?: string,
    signal?: AbortSignal,
    variables: Record<string, string> = {},
    pointer = false,
  ) {
    const resolved = resolveVariant(variant, variables, process.env);
    this.check(id, owner);
    return this.serial(id, async () => {
      signal?.throwIfAborted();
      const session = await this.session(id);
      signal?.throwIfAborted();
      try {
        await performOperation(
          {
            deviceId: id,
            platform: this.device(id)!.platform,
            session,
            request: (route, method, body, timeout, s) =>
              this.server.request(route, method, body, timeout, s),
            // Pointer feedback costs two extra requests per step: only for manual "try" actions, never in runs.
            onPointer: pointer
              ? (x, y, width, height) =>
                  this.emit({ type: 'pointer', deviceId: id, x, y, width, height })
              : undefined,
          },
          resolved,
          kind,
          signal,
        );
      } catch (error) {
        if (
          SESSION_LOST.test(
            `${(error as { code?: string }).code ?? ''} ${(error as Error).message}`,
          )
        ) {
          this.sessions.delete(id);
          throw new StepError(
            'device',
            'Session appareil perdue : relancez l’action (reconnexion automatique).',
          );
        }
        throw error;
      }
    });
  }
  async ensureApplication(
    id: string,
    application: string,
    owner?: string,
    restart = false,
    signal?: AbortSignal,
  ) {
    this.check(id, owner);
    return this.serial(id, () =>
      this.withSession(id, async (session) => {
        signal?.throwIfAborted();
        const route = `/session/${session}/execute/sync`;
        const args = [
          this.device(id)?.platform === 'ios' ? { bundleId: application } : { appId: application },
        ];
        const run = (script: string) =>
          this.server.request(route, 'POST', { script, args }, 30000, signal);
        if (restart) await run('mobile: terminateApp');
        if ((await run('mobile: queryAppState')) !== 4) await run('mobile: activateApp');
      }),
    );
  }
  async applications(id: string, mode: 'current' | 'list' | 'all'): Promise<AppInfo[]> {
    this.check(id);
    return this.serial(id, async () => {
      const device = this.device(id);
      if (!device || device.status !== 'ready') throw new Error('Appareil non connecté.');
      const script = (session: string, name: string, args: unknown[] = []) =>
        this.server.request(`/session/${session}/execute/sync`, 'POST', { script: name, args });
      if (mode === 'current') {
        const session = await this.session(id);
        const app =
          device.platform === 'android'
            ? {
                bundleId: await this.server.request(
                  `/session/${session}/appium/device/current_package`,
                ),
              }
            : await script(session, 'mobile: activeAppInfo');
        if (
          !app?.bundleId ||
          ['com.apple.springboard', 'com.android.systemui'].includes(app.bundleId)
        )
          throw new Error(
            'Aucune application détectée au premier plan. Ouvrez votre application puis réessayez.',
          );
        return [{ id: app.bundleId, name: app.name || app.bundleId }];
      }
      if (device.platform === 'android') {
        const out = (
          await command('adb', [
            '-s',
            id.replace(/^android:/, ''),
            'shell',
            'pm',
            'list',
            'packages',
            ...(mode === 'list' ? ['-3'] : []),
          ])
        ).toString();
        return [
          ...new Set(
            out
              .split(/\r?\n/)
              .filter((l) => l.startsWith('package:'))
              .map((l) => l.slice(8).trim())
              .filter(Boolean),
          ),
        ]
          .sort()
          .map((x) => ({ id: x, name: x }));
      }
      let apps: Record<string, any> = {};
      if (id.startsWith('sim:')) {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cybermonkey-apps-'));
        try {
          const file = path.join(directory, 'apps.plist');
          await fs.writeFile(file, await command('xcrun', ['simctl', 'listapps', id.slice(4)]));
          apps = JSON.parse(
            (await command('plutil', ['-convert', 'json', '-o', '-', file])).toString(),
          );
        } finally {
          await fs.rm(directory, { recursive: true, force: true });
        }
        if (mode === 'list')
          apps = Object.fromEntries(
            Object.entries(apps).filter(([, v]) => v.ApplicationType === 'User'),
          );
      } else {
        const session = await this.session(id);
        for (const applicationType of mode === 'list' ? ['User'] : ['User', 'System'])
          Object.assign(
            apps,
            await script(session, 'mobile: listApps', [
              {
                applicationType,
                returnAttributes: ['CFBundleIdentifier', 'CFBundleDisplayName', 'CFBundleName'],
              },
            ]),
          );
      }
      return Object.entries(apps)
        .filter(([appId]) => !/WebDriverAgent/i.test(appId)) // the test runner is not an app under test
        .map(([appId, v]) => ({
          id: appId,
          name: String(v.CFBundleDisplayName || v.CFBundleName || appId),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    });
  }
  async applicationInfo(id: string, application: string): Promise<AppInfo> {
    this.check(id);
    return this.serial(id, async () => {
      const device = this.device(id);
      if (!device || device.status !== 'ready') throw new Error('Appareil non connecté.');
      if (device.platform === 'android')
        return androidApplicationInfo(id.replace(/^android:/, ''), application);
      const apps = (await this.applications(id, 'all').catch(() => [])) as AppInfo[];
      const app = apps.find((a) => a.id === application);
      if (!app) throw new Error('Application introuvable ; saisissez son nom manuellement.');
      return app;
    });
  }
  async openWdaProject(id: string) {
    if (process.platform !== 'darwin')
      throw new Error('Le projet WebDriverAgent doit être ouvert avec Xcode sur Mac.');
    if (this.device(id)?.platform !== 'ios')
      throw new Error('Sélectionnez un iPhone avant d’ouvrir son projet WDA.');
    return path.join(
      await prepareWdaRuntime(nodeModules(), this.runtimeHome, id),
      'WebDriverAgent.xcodeproj',
    );
  }

  /* ---------- iOS keep-awake (experimental) ---------- */
  private async keepAwakeTick() {
    if (this.keepAwakeRunning || this.stopping) return;
    if (!this.settings().iosKeepAwake) return void this.keepAwakeStates.clear();
    this.keepAwakeRunning = true;
    const selected = new Set(this.selectedDevices());
    try {
      for (const [id, session] of this.sessions) {
        const device = this.device(id);
        if (
          !selected.has(id) ||
          device?.platform !== 'ios' ||
          device.kind === 'simulator' ||
          device.status !== 'ready'
        )
          continue;
        const previous = this.keepAwakeStates.get(id);
        const busy = () => !!this.leases.get(id) && !this.leases.get(id)!.startsWith('ai:');
        if ((this.queued.get(id) ?? 0) > 0 || busy()) {
          this.keepAwakeStates.set(id, { ...previous, state: 'paused' });
          continue;
        }
        try {
          await this.serial(id, async () => {
            if (this.stopping || busy() || this.sessions.get(id) !== session) return;
            const run = (script: string, args: unknown[] = []) =>
              this.server.request(
                `/session/${session}/execute/sync`,
                'POST',
                { script, args },
                5000,
              );
            const locked = await run('mobile: isLocked');
            if (locked !== false)
              return void this.keepAwakeStates.set(id, {
                ...previous,
                state: locked === true ? 'locked' : 'error',
              });
            await run('mobile: pressButton', [{ name: 'volumeup' }]);
            await run('mobile: pressButton', [{ name: 'volumedown' }]);
            this.keepAwakeStates.set(id, {
              state: 'active',
              lastActivity: new Date().toISOString(),
            });
          });
        } catch (error) {
          this.keepAwakeStates.set(id, {
            ...previous,
            state: 'error',
            detail: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } finally {
      this.keepAwakeRunning = false;
    }
  }

  async stop() {
    this.stopping = true;
    clearInterval(this.timer);
    await Promise.race([Promise.allSettled([...this.locks.values()]), delay(500)]);
    // Deleting a session lets the driver stop WebDriverAgent itself: give it time before the server goes away.
    await Promise.allSettled(
      [...this.sessions.values()].map((s) =>
        this.server.request(`/session/${s}`, 'DELETE', undefined, 8000),
      ),
    );
    this.sessions.clear();
    this.server.stop();
    await this.killWda();
  }

  /**
   * WebDriverAgent (xcodebuild + runner) can outlive the app after a crash or a forced quit and keeps port 8101:
   * the next session then hangs. Only processes running from OUR runtime folder are touched.
   */
  async killWda() {
    if (process.platform === 'win32') return;
    await command('pkill', ['-f', path.join(this.runtimeHome, 'wda')], { timeout: 5000 }).catch(
      () => {},
    );
  }
}
