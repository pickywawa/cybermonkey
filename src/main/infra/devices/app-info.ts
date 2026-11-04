import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { command, commandEnv } from '../env.js';

export function parseApplicationBadging(text: string) {
  const name =
    text.match(/^application-label:'(.*)'$/m)?.[1] ??
    text.match(/^application: label='(.*?)'/m)?.[1];
  const icon = text.match(/^application: .*?icon='([^']+)'/m)?.[1];
  return { name, icon };
}
const readable = (file: string) =>
  fs.access(file).then(
    () => true,
    () => false,
  );

/** Reads installed APK metadata without launching or changing the application. */
export async function androidApplicationInfo(serial: string, application: string) {
  const sdk = commandEnv.ANDROID_HOME ?? '';
  const builds = await fs.readdir(path.join(sdk, 'build-tools')).catch(() => [] as string[]);
  let aapt: string | undefined;
  for (const version of builds.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))) {
    const candidate = path.join(
      sdk,
      'build-tools',
      version,
      process.platform === 'win32' ? 'aapt.exe' : 'aapt',
    );
    if (await readable(candidate)) {
      aapt = candidate;
      break;
    }
  }
  if (!aapt) return { id: application, name: application };
  const packages = (await command('adb', ['-s', serial, 'shell', 'pm', 'path', application]))
    .toString()
    .split(/\r?\n/);
  const apk =
    packages.find((l) => l.endsWith('/base.apk'))?.slice(8) ??
    packages.find((l) => l.startsWith('package:'))?.slice(8);
  if (!apk) throw new Error('Application non installée sur cet appareil.');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'cybermonkey-app-'));
  try {
    const local = path.join(temp, 'application.apk');
    await command('adb', ['-s', serial, 'pull', apk, local], { timeout: 60000 });
    const meta = parseApplicationBadging(
      (await command(aapt, ['dump', 'badging', local])).toString(),
    );
    let icon: string | undefined;
    if (meta.icon && !meta.icon.startsWith('-') && !meta.icon.includes('..')) {
      try {
        const png = await sharp(await command('unzip', ['-p', local, meta.icon]), {
          limitInputPixels: 16000000,
        })
          .resize(96, 96, { fit: 'inside' })
          .png()
          .toBuffer();
        icon = 'data:image/png;base64,' + png.toString('base64');
      } catch {
        /* adaptive icons cannot be decoded: keep the name only */
      }
    }
    return { id: application, name: meta.name ?? application, ...(icon ? { icon } : {}) };
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}
