// Smoke test of an unpacked, packaged Cybermonkey (run with the app's own Electron as Node):
//   ELECTRON_RUN_AS_NODE=1 Cybermonkey.exe scripts/smoke-packaged.cjs <folder containing resources/>
// Checks that the native pieces were bundled for this platform and that they load.
const fs = require('node:fs');
const path = require('node:path');
const app = path.resolve(process.argv[2] ?? '.');
const modules = path.join(app, 'resources', 'app.asar.unpacked', 'node_modules');
const win = process.platform === 'win32';
const exe = win ? '.exe' : '';
const key = `${process.platform}-${process.arch}`;
const need = [
  'appium/build/lib/main.js',
  'appium-uiautomator2-driver/package.json',
  `@anthropic-ai/claude-agent-sdk-${key}/claude${exe}`,
  `@github/copilot-${key}/copilot${exe}`,
];
const missing = need.filter((f) => !fs.existsSync(path.join(modules, f)));
const codex = [`@openai/codex-${key}/vendor`, '@openai/codex/vendor'].some((f) =>
  fs.existsSync(path.join(modules, f)),
);
if (!codex) missing.push('@openai/codex vendor binaries');
if (missing.length) {
  console.error('MISSING in the package:\n  ' + missing.join('\n  '));
  process.exit(1);
}
(async () => {
  const sharp = require(path.join(modules, 'sharp'));
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ff0000' } })
    .png()
    .toBuffer();
  if (!png.length) throw new Error('sharp produced nothing');
  console.log(
    `OK ${key}: native binaries present, sharp ${sharp.versions?.sharp ?? ''} works (${png.length} bytes)`,
  );
})().catch((e) => {
  console.error('FAILED to load a native module:', e);
  process.exit(1);
});
