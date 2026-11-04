import { existsSync, statSync } from 'node:fs';
import type { Device } from '../../shared/domain/devices.js';
import { command } from '../infra/env.js';
import { PROVIDER_LABEL, type RemoteProvider } from '../../shared/domain/remote.js';
import type { OS } from '../../shared/domain/scenario.js';

/** What the installer needs from the remote-devices service to put a build on a device cloud. */
export interface CloudUploader {
  upload(provider: RemoteProvider, platform: OS, file: string): Promise<string>;
}

export interface InstallStep {
  file: string;
  args: string[];
  /** Uninstalling an application that is not there fails: that is the expected case, not an error. */
  optional?: boolean;
  timeout: number;
  label: string;
}

/** Throws with a plain message when the build cannot be installed on this kind of device. */
export function checkBuild(device: Device, buildPath: string): void {
  if (!existsSync(buildPath)) throw new Error(`Build introuvable : ${buildPath}`);
  const isDir = statSync(buildPath).isDirectory();
  const lower = buildPath.toLowerCase().replace(/[\\/]+$/, '');
  if (device.platform === 'android') {
    if (isDir || !lower.endsWith('.apk'))
      throw new Error(
        `Android attend un fichier .apk (reçu : ${buildPath}). Un .aab doit d’abord être converti en APK.`,
      );
    return;
  }
  if (device.kind === 'simulator') {
    if (!isDir || !lower.endsWith('.app'))
      throw new Error(
        `Un simulateur iOS attend un dossier .app compilé pour le simulateur (reçu : ${buildPath}). Un .ipa ne s’installe que sur un iPhone.`,
      );
    return;
  }
  if (!lower.endsWith('.ipa') && !(isDir && lower.endsWith('.app')))
    throw new Error(`Un iPhone attend un .ipa signé (ou un .app) (reçu : ${buildPath}).`);
}

/** The commands that put `buildPath` on `device`, optionally wiping the previous install first. Pure: no I/O. */
export function installPlan(
  device: Device,
  buildPath: string,
  appId: string,
  fresh: boolean,
): InstallStep[] {
  const steps: InstallStep[] = [];
  const raw = device.id;
  if (device.platform === 'android') {
    if (fresh)
      steps.push({
        file: 'adb',
        args: ['-s', raw, 'uninstall', appId],
        optional: true,
        timeout: 60_000,
        label: `désinstallation de ${appId}`,
      });
    // -r replace, -t accept test builds, -g grant runtime permissions so no system dialog hides the first screen.
    steps.push({
      file: 'adb',
      args: ['-s', raw, 'install', '-r', '-t', '-g', buildPath],
      timeout: 300_000,
      label: 'installation de l’APK',
    });
    return steps;
  }
  if (device.kind === 'simulator') {
    const udid = raw.replace(/^sim:/, '');
    if (fresh)
      steps.push({
        file: 'xcrun',
        args: ['simctl', 'uninstall', udid, appId],
        optional: true,
        timeout: 60_000,
        label: `désinstallation de ${appId}`,
      });
    steps.push({
      file: 'xcrun',
      args: ['simctl', 'install', udid, buildPath],
      timeout: 300_000,
      label: 'installation sur le simulateur',
    });
    return steps;
  }
  const udid = raw.replace(/^ios:/, '');
  if (fresh)
    steps.push({
      file: 'xcrun',
      args: ['devicectl', 'device', 'uninstall', 'app', '--device', udid, appId],
      optional: true,
      timeout: 60_000,
      label: `désinstallation de ${appId}`,
    });
  steps.push({
    file: 'xcrun',
    args: ['devicectl', 'device', 'install', 'app', '--device', udid, buildPath],
    timeout: 300_000,
    label: 'installation sur l’iPhone',
  });
  return steps;
}

export async function installBuild(
  device: Device,
  buildPath: string,
  appId: string,
  fresh: boolean,
  log: (message: string) => void,
  run: typeof command = command,
  cloud?: CloudUploader,
): Promise<void> {
  checkBuild(device, buildPath);
  if (device.remote) {
    // A cloud device installs from what the provider stores: the build goes there, each session starts clean.
    if (!cloud) throw new Error('Appareils distants non disponibles');
    log(`  ${device.name} : envoi vers ${PROVIDER_LABEL[device.remote.provider]}…`);
    const ref = await cloud.upload(device.remote.provider, device.platform, buildPath);
    log(`  référence : ${ref}${fresh ? ' (--fresh : chaque session cloud démarre propre)' : ''}`);
    return;
  }
  if (fresh && !appId)
    throw new Error(
      `--fresh demande l’identifiant de l’application ${device.platform === 'ios' ? 'iOS' : 'Android'} : renseignez-le dans les réglages du projet.`,
    );
  for (const step of installPlan(device, buildPath, appId, fresh)) {
    log(`  ${device.name} : ${step.label}…`);
    try {
      await run(step.file, step.args, { timeout: step.timeout });
    } catch (error) {
      if (step.optional) continue;
      throw new Error(`${device.name} : échec de l’${step.label} — ${String(error)}`);
    }
  }
}
