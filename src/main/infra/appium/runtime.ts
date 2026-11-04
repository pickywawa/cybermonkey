import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

/** The Appium child runs in plain Node mode: every dependency must be a real file, outside the ASAR. */
export async function prepareAppiumRuntime(nodeModules: string, home: string) {
  const cache = path.join(home, 'node_modules', '.cache', 'appium');
  await fs.mkdir(cache, { recursive: true });
  const drivers: Record<string, unknown> = {};
  for (const name of ['appium-uiautomator2-driver', 'appium-xcuitest-driver']) {
    const installPath = path.join(nodeModules, name);
    const pkg = JSON.parse(await fs.readFile(path.join(installPath, 'package.json'), 'utf8'));
    drivers[pkg.appium.driverName] = {
      ...pkg.appium,
      pkgName: name,
      version: pkg.version,
      installType: 'npm',
      installSpec: `${name}@${pkg.version}`,
      installPath,
    };
    const link = path.join(home, 'node_modules', name);
    try {
      const existing = await fs.readlink(link);
      if (path.resolve(path.dirname(link), existing) === installPath) continue;
      await fs.unlink(link);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await fs.symlink(installPath, link, process.platform === 'win32' ? 'junction' : 'dir');
  }
  const target = path.join(cache, 'extensions.yaml');
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify({ drivers, plugins: {}, schemaRev: 4 }), {
    mode: 0o600,
  });
  await fs.rename(temporary, target);
  return home;
}

/** Xcode and the driver patch/sign this project: never mutate the installed app bundle. */
export async function prepareWdaRuntime(nodeModules: string, home: string, deviceId: string) {
  const require = createRequire(path.join(nodeModules, 'appium-xcuitest-driver/package.json'));
  const manifest = require.resolve('appium-webdriveragent/package.json');
  const pkg = JSON.parse(await fs.readFile(manifest, 'utf8'));
  const target = path.join(home, 'wda', pkg.version, deviceId.replace(/[^a-zA-Z0-9-]/g, '_'));
  const marker = path.join(target, '.cybermonkey-ready');
  try {
    await fs.access(marker);
  } catch {
    await fs.cp(path.dirname(manifest), target, { recursive: true });
    await fs.writeFile(marker, pkg.version);
  }
  return target;
}
