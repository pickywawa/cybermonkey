// Keeps startup failures visible even when an ESM dependency fails before main loads.
import { app, dialog } from 'electron';
// `--cli` runs the engine without any window (CI/CD); everything else opens the application.
const entry = process.argv.includes('--cli') ? './cli/electron.js' : './index.js';
void import(entry).catch((error: unknown) => {
  console.error('Cybermonkey could not load its main module:', error);
  void app.whenReady().then(() => {
    dialog.showErrorBox('Cybermonkey', String(error));
    app.exit(1);
  });
});
