import { appendFileSync, mkdirSync, statSync, renameSync } from 'node:fs';
import path from 'node:path';
import { paths } from './paths.js';

/** Small persistent log (userData/logs/cybermonkey.log, rotated at 2 MB) so field problems can be diagnosed. */
export function log(scope: string, message: string) {
  try {
    if (!paths.userData) return;
    const dir = path.join(paths.userData, 'logs');
    const file = path.join(dir, 'cybermonkey.log');
    mkdirSync(dir, { recursive: true });
    try {
      if (statSync(file).size > 2_000_000) renameSync(file, file + '.1');
    } catch {
      /* first write */
    }
    appendFileSync(file, `${new Date().toISOString()} [${scope}] ${message.replace(/\s+$/, '')}\n`);
  } catch {
    /* logging must never break the app */
  }
}
