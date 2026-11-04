import { spawn } from 'node:child_process';
import { watch, readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import electron from 'electron';

const ROOT = 'dist-electron';
// TypeScript watch can rewrite identical output at startup; only content changes require a restart.
function fingerprint(root) {
  const hash = createHash('sha256');
  (function visit(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (/\.(?:js|cjs)$/.test(entry.name)) hash.update(path.relative(root, file)).update(readFileSync(file));
    }
  })(root);
  return hash.digest('hex');
}
let print = fingerprint(ROOT), child, timer, restarting = false, stopping = false;
const terminate = (target) => {
  target.kill('SIGTERM');
  const force = setTimeout(() => target.exitCode === null && target.kill('SIGKILL'), 8000);
  target.once('exit', () => clearTimeout(force));
};
function start() {
  print = fingerprint(ROOT);
  child = spawn(electron, ['.'], { env: { ...process.env, CYBERMONKEY_DEV: '1' }, stdio: 'inherit' });
  child.once('exit', () => {
    child = undefined;
    if (restarting && !stopping) { restarting = false; start(); } else if (!stopping) process.exit(0);
  });
}
const watcher = watch(ROOT, { recursive: true }, (_, file) => {
  if (!file || !/\.(?:js|cjs)$/.test(file) || stopping) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    let next;
    try { next = fingerprint(ROOT); } catch { return; }
    if (next === print || restarting) return;
    print = next;
    console.log('[Cybermonkey dev] Backend changed; restarting Electron…');
    restarting = true;
    if (child) terminate(child); else { restarting = false; start(); }
  }, 700);
});
const stop = () => { stopping = true; clearTimeout(timer); watcher.close(); child ? terminate(child) : process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
start();
