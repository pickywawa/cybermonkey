#!/usr/bin/env node
// Standalone launcher: `node dist-electron/main/cli/index.js run …` (no Electron, no window).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { paths } from '../infra/paths.js';
import { runCli } from './run.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
paths.appRoot = root;
try {
  process.env.CYBERMONKEY_VERSION ??= JSON.parse(
    readFileSync(path.join(root, 'package.json'), 'utf8'),
  ).version;
} catch {
  /* version stays unknown */
}

const code = await runCli(process.argv.slice(2));
// Appium and the device tools may leave handles open: the exit code is already decided.
process.exit(code);
