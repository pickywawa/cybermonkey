import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

export function verifyMacPackage(appPath) {
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], {
    stdio: 'inherit',
  });
  const resources = path.join(appPath, 'Contents/Resources');
  const plist = path.join(appPath, 'Contents/Info.plist');
  const value = (key) =>
    execFileSync('plutil', ['-extract', key, 'raw', '-o', '-', plist], { encoding: 'utf8' }).trim();
  assert.equal(value('CFBundleIdentifier'), 'com.pickywawa.cybermonkey');
  const bundledIcon = path.join(resources, value('CFBundleIconFile'));
  assert.deepEqual(
    readFileSync(bundledIcon),
    readFileSync(new URL('../build/icon.icns', import.meta.url)),
  );
  assert.ok(existsSync(path.join(resources, 'icon.png')), 'Missing runtime Dock icon');
  const github = path.join(resources, 'app.asar.unpacked/node_modules/@github');
  assert.ok(
    readdirSync(github).every((name) => !name.startsWith('copilot-sdk-')),
    'Duplicate Copilot runtime is bundled',
  );
  let total = 0;
  function measure(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) measure(file);
      else if (entry.isFile()) total += statSync(file).size;
    }
  }
  measure(appPath);
  console.log(
    `Verified macOS signature, Cybermonkey icons and single Copilot runtime; ${(total / 1024 / 1024).toFixed(1)} MiB installed`,
  );
}

export default async function afterSign(context) {
  if (context.electronPlatformName === 'darwin')
    verifyMacPackage(path.join(context.appOutDir, 'Cybermonkey.app'));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const folder = process.arch === 'x64' ? 'mac' : `mac-${process.arch}`;
  verifyMacPackage(
    path.resolve(process.argv[2] ?? path.join('release', folder, 'Cybermonkey.app')),
  );
}
