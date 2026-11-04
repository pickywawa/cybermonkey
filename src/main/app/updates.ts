import { app, dialog, session, shell, type BrowserWindow } from 'electron';
import path from 'node:path';
import { Updater } from '../infra/updater/updater.js';
import type { Container } from '../container.js';

/** Wires the GitHub-release updater to Electron's proxy-aware network stack and install dialog. */
export async function createUpdater(c: Container, mainWindow: () => BrowserWindow | undefined) {
  const network = session.fromPartition('persist:cybermonkey-updates');
  await network.setProxy({ mode: 'system' });
  const updater = new Updater({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    directory: path.join(app.getPath('userData'), 'updates'),
    fetch: (url, init) => network.fetch(url, init),
    refreshProxy: async () => {
      await network.forceReloadProxyConfig();
      await network.closeAllConnections();
    },
    emit: (status) => c.emit({ type: 'update', status }),
    open: async (file) => {
      const fr = c.settings().language === 'fr';
      if (c.runner.isRunning())
        throw new Error(
          fr
            ? 'Arrêtez l’exécution des tests avant la mise à jour.'
            : 'Stop the test run before updating.',
        );
      const result = await dialog.showMessageBox(mainWindow()!, {
        type: 'question',
        title: fr ? 'Mettre à jour Cybermonkey' : 'Update Cybermonkey',
        message: fr
          ? 'Ouvrir l’installateur et fermer Cybermonkey ?'
          : 'Open the installer and close Cybermonkey?',
        detail: fr
          ? 'Sur macOS, glissez Cybermonkey dans Applications et remplacez la version existante. Vos projets et paramètres sont conservés.'
          : 'On macOS, drag Cybermonkey into Applications and replace the existing version. Your projects and settings are preserved.',
        buttons: fr
          ? ['Ouvrir et fermer Cybermonkey', 'Plus tard']
          : ['Open and close Cybermonkey', 'Later'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (result.response !== 0) return;
      const error = await shell.openPath(file);
      if (error) throw new Error(error);
      app.quit();
    },
  });
  const automatic = () =>
    updater
      .check()
      .then((s) =>
        s.state === 'available' && s.compatible && c.settings().autoDownloadUpdates
          ? updater.download()
          : undefined,
      )
      .catch(() => {});
  if (app.isPackaged && c.settings().checkUpdatesOnStart) void automatic();
  setInterval(
    () => app.isPackaged && c.settings().checkUpdatesOnStart && void automatic(),
    4 * 60 * 60 * 1000,
  ).unref();
  return updater;
}
