import { app, dialog, shell } from 'electron';
import { createContainer, type Container } from './container.js';
import { WindowManager } from './app/windows.js';
import { createUpdater } from './app/updates.js';
import { registerHandlers } from './ipc/handlers.js';
import { McpService } from './mcp/server.js';
import { Ipc } from './ipc/registry.js';
import { paths } from './infra/paths.js';
import type { Updater } from './infra/updater/updater.js';
import type { LiveEvent } from '../shared/ipc.js';

if (process.env.CYBERMONKEY_USER_DATA) app.setPath('userData', process.env.CYBERMONKEY_USER_DATA);
if (process.env.CYBERMONKEY_DEV === '1') {
  // Lets local tools inspect the real renderer and its IPC bridge.
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
  app.commandLine.appendSwitch('remote-debugging-port', '0');
  process.on('SIGTERM', () => app.quit());
}
paths.appRoot = app.getAppPath();
paths.userData = app.getPath('userData');
paths.documents = app.getPath('documents');

let container: Container | undefined;
let mcp: McpService | undefined;
const emit = (event: LiveEvent) => windows.broadcast('live:event', event);
const windows = new WindowManager(() => container?.store, emit);
const AUTH_HOSTS = [
  'auth.openai.com',
  'github.com',
  'claude.ai',
  'claude.com',
  'console.anthropic.com',
  'platform.claude.com',
];

app
  .whenReady()
  .then(async () => {
    container = await createContainer({
      userData: paths.userData,
      documents: paths.documents,
      emit,
      openAuthUrl: async (url) => {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' || !AUTH_HOSTS.includes(parsed.hostname))
          throw new Error('URL OAuth non autorisée');
        await shell.openExternal(url);
      },
    });
    const c = container;
    let updater: Updater;
    mcp = new McpService(c, app.getVersion());
    registerHandlers(new Ipc(windows.isAllowed), c, windows, () => updater, mcp);
    windows.refreshMenu();
    await windows.open('main');
    updater = await createUpdater(c, () => windows.main());
    if (c.settings().devicesDetached) await windows.open('devices');
    if (c.settings().aiDetached) await windows.open('ai');
    c.monitor.start();
    await mcp.apply();
    app.on('activate', () => !windows.main() && !windows.quitting && void windows.open('main'));
  })
  .catch((e) => {
    console.error('Cybermonkey startup failed:', e);
    dialog.showErrorBox('Cybermonkey', String(e));
    app.quit();
  });

app.on('window-all-closed', () => app.quit());
app.on('before-quit', (e) => {
  if (windows.quitting) return;
  e.preventDefault();
  windows.quitting = true;
  const deadline = setTimeout(() => app.quit(), 6000);
  void Promise.allSettled([mcp?.stop(), container?.stop()]).finally(() => {
    clearTimeout(deadline);
    app.quit();
  });
});
