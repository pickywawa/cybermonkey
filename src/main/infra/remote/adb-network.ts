import { command } from '../env.js';
import { adbTarget } from '../../../shared/domain/remote.js';
import type { RemoteStatus } from '../../../shared/domain/remote.js';
import { tr } from '../../integrations/i18n.js';

export type Run = typeof command;

/**
 * Android phones reached over the network (`adb connect host:port`). Once connected they show up in `adb devices`
 * like any other, so everything else (mirror, install, logcat, Appium) works unchanged.
 */
export class AdbNetwork {
  private last = new Map<string, { at: number; ok: boolean; detail: string }>();
  private inFlight = new Map<string, Promise<void>>();
  constructor(private run: Run = command) {}

  private async attempt(host: string) {
    try {
      const out = (await this.run('adb', ['connect', host], { timeout: 6000 })).toString().trim();
      // adb exits 0 even when it could not connect: only the words tell.
      const ok = /^(connected to|already connected to)/i.test(out);
      this.last.set(host, { at: Date.now(), ok, detail: out.split('\n').pop() ?? out });
    } catch (error) {
      this.last.set(host, {
        at: Date.now(),
        ok: false,
        detail: String((error as Error).message)
          .replace(/^adb: /, '')
          .slice(0, 200),
      });
    }
  }
  /** Starts a connection for each host that is not listed yet, without waiting (the next scan sees the result). */
  ensure(hosts: string[], listed: Set<string>, retryMs = 20000) {
    for (const raw of hosts) {
      const host = adbTarget(raw);
      if (!host || listed.has(host) || this.inFlight.has(host)) continue;
      if (Date.now() - (this.last.get(host)?.at ?? 0) < retryMs) continue;
      const task = this.attempt(host).finally(() => this.inFlight.delete(host));
      this.inFlight.set(host, task);
    }
  }
  /** Connects now and waits (command line, « Connect » button). */
  async connectNow(hosts: string[]) {
    const targets = [...new Set(hosts.map(adbTarget).filter(Boolean))];
    await Promise.all(targets.map((h) => this.attempt(h)));
    return targets.map((host) => ({ host, ...this.last.get(host)! }));
  }
  async disconnect(host: string) {
    const target = adbTarget(host);
    if (target) await this.run('adb', ['disconnect', target], { timeout: 6000 }).catch(() => {});
    this.last.delete(target);
  }
  /** Android 11+ « wireless debugging »: pair once with the code shown on the phone, then connect. */
  async pair(hostPort: string, code: string): Promise<{ ok: boolean; message: string }> {
    const target = adbTarget(hostPort);
    if (!target || !/^\d{6}$/.test(code.trim()))
      return {
        ok: false,
        message: tr(
          'Adresse (hôte:port d’appairage) et code à 6 chiffres requis.',
          'Pairing address (host:port) and 6-digit code required.',
        ),
      };
    try {
      const out = (await this.run('adb', ['pair', target, code.trim()], { timeout: 15000 }))
        .toString()
        .trim();
      const ok = /successfully paired/i.test(out);
      return { ok, message: out.split('\n').pop() ?? out };
    } catch (error) {
      return {
        ok: false,
        message: String((error as Error).message)
          .replace(/^adb: /, '')
          .slice(0, 300),
      };
    }
  }
  /** What each configured host looks like, from the last attempt and the current `adb devices` list. */
  states(
    hosts: string[],
    listed: Map<string, 'device' | 'unauthorized' | 'offline'>,
  ): RemoteStatus['adb'] {
    return hosts.map((raw) => {
      const host = adbTarget(raw) || raw;
      const seen = listed.get(host);
      if (seen === 'device')
        return { host, state: 'connected', detail: tr('Connecté', 'Connected') };
      if (seen === 'unauthorized')
        return {
          host,
          state: 'unauthorized',
          detail: tr(
            'Acceptez la connexion sur le téléphone (« Toujours autoriser »).',
            'Accept the connection on the phone (“Always allow”).',
          ),
        };
      const last = this.last.get(host);
      return last
        ? { host, state: last.ok ? 'unknown' : 'unreachable', detail: last.detail }
        : { host, state: 'unknown', detail: tr('Pas encore essayé', 'Not tried yet') };
    });
  }
}
