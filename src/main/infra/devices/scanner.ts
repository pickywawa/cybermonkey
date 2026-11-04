import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Device, DeviceScan } from '../../../shared/domain/devices.js';
import { command } from '../env.js';
import { tr } from '../../integrations/i18n.js';

/** Devices that are not plugged into this machine: adb over the network and device-cloud profiles. */
export interface RemoteSource {
  /** Starts `adb connect` for configured phones that are not listed yet (never waits). */
  ensureAdb(listed: Set<string>): void;
  /** Configured adb hosts that are not connected, shown offline with the reason. */
  adbPlaceholders(listed: Set<string>): Device[];
  /** Cloud / device-lab profiles of Settings. */
  profiles(): Promise<Device[]>;
}

export function parseAdb(text: string): Device[] {
  return text
    .split('\n')
    .slice(1)
    .flatMap((line) => {
      const [id, status, ...rest] = line.trim().split(/\s+/);
      if (!id || !['device', 'unauthorized', 'offline'].includes(status)) return [];
      const model = rest
        .find((s) => s.startsWith('model:'))
        ?.slice(6)
        .replaceAll('_', ' ');
      const kind = id.startsWith('emulator-')
        ? 'simulator'
        : rest.some((s) => s.startsWith('usb:')) || (!id.includes(':') && !id.startsWith('adb-'))
          ? 'usb'
          : 'network';
      return [
        {
          id: `android:${id}`,
          name: model ?? id,
          platform: 'android' as const,
          kind: kind as Device['kind'],
          status: status === 'device' ? ('ready' as const) : (status as 'unauthorized' | 'offline'),
          detail: status === 'unauthorized' ? 'Autoriser le débogage USB sur le téléphone' : id,
        },
      ];
    });
}

export interface WdaConfig {
  url: string;
  udid: string;
  mode?: string;
  platformVersion?: string;
}

/** Detects Android (adb), iOS simulators (simctl) and physical iPhones (devicectl). */
export class Devices {
  known = new Map<string, Device>();
  automationScreenshot?: (id: string) => Promise<string | undefined>;
  remoteSource?: RemoteSource;
  constructor(private wda: () => WdaConfig) {}

  async scan(): Promise<DeviceScan> {
    const devices: Device[] = [];
    const diagnostics: string[] = [];
    let adbListed = new Set<string>();
    const tasks: Promise<void>[] = [
      (async () => {
        try {
          const found = parseAdb((await command('adb', ['devices', '-l'])).toString());
          devices.push(...found);
          adbListed = new Set(found.map((d) => d.id.slice('android:'.length)));
        } catch {
          diagnostics.push('adb-missing');
        }
      })(),
    ];
    if (process.platform === 'darwin')
      tasks.push(
        (async () => {
          try {
            const data = JSON.parse(
              (await command('xcrun', ['simctl', 'list', 'devices', '--json'])).toString(),
            );
            for (const list of Object.values(data.devices) as any[][])
              for (const d of list)
                if (d.isAvailable)
                  devices.push({
                    id: `sim:${d.udid}`,
                    name: d.name,
                    platform: 'ios',
                    kind: 'simulator',
                    status: d.state === 'Booted' ? 'ready' : 'offline',
                    detail: d.state === 'Booted' ? 'Simulator · démarré' : 'Simulateur arrêté',
                  });
          } catch {
            diagnostics.push('simctl-missing');
          }
        })(),
        (async () => {
          const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'cybermonkey-devices-'));
          try {
            const file = path.join(temp, 'devices.json');
            await command('xcrun', ['devicectl', 'list', 'devices', '--json-output', file]);
            for (const d of JSON.parse(await fs.readFile(file, 'utf8')).result?.devices ?? []) {
              const udid = d.hardwareProperties?.udid;
              if (d.hardwareProperties?.reality !== 'physical' || !udid) continue;
              if (d.deviceProperties?.developerModeStatus !== 'enabled')
                diagnostics.push(`developer-mode:${d.deviceProperties.name}`);
              if (d.deviceProperties?.ddiServicesAvailable === false)
                diagnostics.push(`ddi:${d.deviceProperties.name}`);
              devices.push({
                id: 'ios:' + udid,
                name: d.deviceProperties.name,
                osVersion: d.deviceProperties.osVersionNumber,
                developerMode: d.deviceProperties.developerModeStatus,
                ddiReady: d.deviceProperties.ddiServicesAvailable,
                platform: 'ios',
                kind: d.connectionProperties?.transportType === 'wired' ? 'usb' : 'network',
                status:
                  d.connectionProperties?.pairingState === 'paired' &&
                  d.deviceProperties?.bootState === 'booted'
                    ? 'ready'
                    : 'offline',
                detail: `${udid} · ${d.connectionProperties?.transportType}`,
              });
            }
          } catch {
            diagnostics.push('devicectl-failed');
          } finally {
            await fs.rm(temp, { recursive: true, force: true });
          }
        })(),
      );
    await Promise.all(tasks);
    if (this.remoteSource) {
      this.remoteSource.ensureAdb(adbListed);
      devices.push(...this.remoteSource.adbPlaceholders(adbListed));
      devices.push(...(await this.remoteSource.profiles().catch(() => [])));
    }
    const config = this.wda();
    if (process.platform !== 'darwin' && config.udid && config.mode && config.mode !== 'build')
      devices.push({
        id: 'ios:' + config.udid,
        name: 'iPhone · ' + config.udid,
        platform: 'ios',
        kind: 'manual',
        status: 'ready',
        osVersion: config.platformVersion,
        detail: 'Configuration manuelle · connexion à vérifier',
      });
    this.known = new Map(devices.map((d) => [d.id, d]));
    return { devices, diagnostics };
  }

  async screenshot(id: string): Promise<string> {
    const d = this.known.get(id);
    if (!d || d.status !== 'ready') throw new Error('Appareil non connecté');
    const automated = await this.automationScreenshot?.(id);
    if (automated) return automated;
    if (d.kind === 'cloud')
      throw new Error(
        tr(
          'Appareil distant : l’écran n’est visible que pendant une session (exécution, exploration ou enregistrement).',
          'Remote device: the screen is only visible during a session (run, exploration or recording).',
        ),
      );
    let buffer: Buffer;
    if (d.platform === 'android')
      buffer = await command('adb', ['-s', id.slice(8), 'exec-out', 'screencap', '-p'], {
        timeout: 10000,
      });
    else if (id.startsWith('sim:'))
      buffer = await command(
        'xcrun',
        ['simctl', 'io', id.slice(4), 'screenshot', '--type=png', '-'],
        { timeout: 10000 },
      );
    else {
      const config = this.wda();
      if (config.udid !== id.slice(4))
        throw new Error(
          'Le miroir iOS nécessite WebDriverAgent. Attendez la connexion automatique ou utilisez Reconnecter.',
        );
      const base = config.url.replace(/\/$/, '');
      const status = (await fetch(`${base}/status`, { signal: AbortSignal.timeout(5000) }).then(
        (r) => r.json(),
      )) as any;
      if (!status.value?.ready)
        throw new Error(
          'WebDriverAgent n’est pas prêt. Vérifier le tunnel et le lancement sur cet iPhone.',
        );
      const response = await fetch(`${base}/screenshot`, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`WebDriverAgent HTTP ${response.status}`);
      buffer = Buffer.from(((await response.json()) as { value: string }).value, 'base64');
    }
    if (
      buffer.length > 20 * 1024 * 1024 ||
      buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
    )
      throw new Error('Capture PNG invalide');
    return `data:image/png;base64,${buffer.toString('base64')}`;
  }
}

/** Polls the host for devices and reports only real changes (automatic detection). */
export class DeviceMonitor {
  private timer?: ReturnType<typeof setInterval>;
  private last = '';
  private busy = false;
  constructor(
    private devices: Devices,
    private onChange: (scan: DeviceScan) => void,
    private enabled: () => boolean,
  ) {}
  start(intervalMs = 4000) {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref();
  }
  async tick(force = false) {
    if (this.busy || (!force && !this.enabled())) return;
    this.busy = true;
    try {
      const scan = await this.devices.scan();
      const signature = JSON.stringify([
        scan.devices.map((d) => [d.id, d.status, d.name]),
        scan.diagnostics,
      ]);
      if (signature !== this.last) {
        this.last = signature;
        this.onChange(scan);
      }
    } finally {
      this.busy = false;
    }
  }
  stop() {
    clearInterval(this.timer);
  }
}
