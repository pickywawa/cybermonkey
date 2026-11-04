// Keeps startup failures visible even when an ESM dependency fails before main loads.
import { app, dialog } from 'electron';
void import('./index.js').catch((error: unknown) => {
  console.error('Cybermonkey could not load its main module:', error);
  void app.whenReady().then(() => {
    dialog.showErrorBox('Cybermonkey', String(error));
    app.exit(1);
  });
});
