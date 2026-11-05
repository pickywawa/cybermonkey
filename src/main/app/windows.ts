import { app, BrowserWindow, Menu, screen } from 'electron';
import path from 'node:path';
import { paths } from '../infra/paths.js';
import type { WorkspaceStore } from '../infra/storage/workspace-store.js';
import type { LiveEvent, MenuAction } from '../../shared/ipc.js';
import { restoreWindowState, saveWindowState } from './window-state.js';

export type WindowKind = 'main' | 'devices' | 'ai';
const TITLES: Record<WindowKind, string> = {
  main: 'Cybermonkey',
  devices: 'Cybermonkey · Appareils',
  ai: 'Cybermonkey · IA',
};

/** Main window + the two detachable panels (devices, AI), each remembering its own bounds. */
export class WindowManager {
  private windows = new Map<WindowKind, BrowserWindow>();
  private allowed = new Set<BrowserWindow>();
  quitting = false;
  private readonly dev = process.env.CYBERMONKEY_DEV === '1';
  constructor(
    private store: () => WorkspaceStore | undefined,
    private emit: (e: LiveEvent) => void,
  ) {}

  main() {
    return this.windows.get('main');
  }
  isAllowed = (win: BrowserWindow | null) => !!win && this.allowed.has(win);
  broadcast(channel: string, value: unknown) {
    for (const w of this.allowed) if (!w.isDestroyed()) w.webContents.send(channel, value);
  }
  private get icon() {
    return app.isPackaged
      ? path.join(process.resourcesPath, 'icon.png')
      : path.join(paths.appRoot, 'build/icon.png');
  }

  async open(kind: WindowKind) {
    const existing = this.windows.get(kind);
    if (existing) return existing;
    const auxiliary = kind !== 'main';
    const stateFile = path.join(app.getPath('userData'), 'window-state.json');
    const defaults = {
      width: auxiliary ? 900 : 1510,
      height: 960,
      minWidth: auxiliary ? 360 : 1000,
      minHeight: 600,
    };
    const saved = restoreWindowState(
      stateFile,
      kind,
      screen.getAllDisplays().map((d) => d.workArea),
      defaults,
    );
    const win = new BrowserWindow({
      ...saved.bounds,
      minWidth: defaults.minWidth,
      minHeight: defaults.minHeight,
      title: TITLES[kind],
      icon: this.icon,
      backgroundColor: '#16171d',
      // macOS: the title bar blends into the app. Elsewhere the native frame keeps its window controls.
      ...(process.platform === 'darwin'
        ? {
            titleBarStyle: auxiliary ? ('default' as const) : ('hiddenInset' as const),
            trafficLightPosition: { x: 16, y: 17 },
          }
        : { autoHideMenuBar: true }),
      webPreferences: {
        preload: path.join(import.meta.dirname, '../../preload/index.cjs'),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const persist = () => {
      if (win.isDestroyed()) return;
      try {
        saveWindowState(stateFile, kind, {
          bounds: win.getNormalBounds(),
          maximized: win.isMaximized(),
        });
      } catch (error) {
        console.warn('Window state could not be saved:', String(error));
      }
    };
    const schedule = () => (clearTimeout(timer), (timer = setTimeout(persist, 250)));
    win.on('resize', schedule);
    win.on('move', schedule);
    win.on('maximize', schedule);
    win.on('unmaximize', schedule);
    win.on('close', (event) => {
      clearTimeout(timer);
      persist();
      if (!auxiliary && !this.quitting) {
        event.preventDefault();
        app.quit();
      }
    });
    if (saved.maximized) win.maximize();
    this.allowed.add(win);
    this.windows.set(kind, win);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on(
      'will-navigate',
      (e, url) => url !== win.webContents.getURL() && e.preventDefault(),
    );
    win.on('closed', () => {
      this.allowed.delete(win);
      this.windows.delete(kind);
      if (auxiliary && !this.quitting) {
        void this.store()
          ?.patchSettings(kind === 'devices' ? { devicesDetached: false } : { aiDetached: false })
          .then(() => this.emit({ type: 'workspace' }));
      }
    });
    const view = auxiliary ? kind : '';
    if (this.dev) await win.loadURL('http://127.0.0.1:5273' + (view ? `?view=${view}` : ''));
    else
      await win.loadFile(path.join(paths.appRoot, 'dist/index.html'), {
        query: view ? { view } : {},
      });
    return win;
  }

  async detach(kind: 'devices' | 'ai', value: boolean) {
    await this.store()?.patchSettings(
      kind === 'devices' ? { devicesDetached: value } : { aiDetached: value },
    );
    if (value) {
      const existing = this.windows.get(kind);
      if (existing) existing.focus();
      else await this.open(kind);
    } else this.windows.get(kind)?.close();
    this.emit({ type: 'workspace' });
  }

  send(action: MenuAction) {
    const win = this.main();
    if (!win || win.isDestroyed()) return;
    win.show();
    win.focus();
    this.emit({ type: 'menu', action });
  }
  refreshMenu() {
    const store = this.store();
    const fr = (store?.state.settings.language ?? 'fr') === 'fr';
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
        {
          label: fr ? 'Fichier' : 'File',
          submenu: [
            {
              label: fr ? 'Nouveau projet…' : 'New project…',
              accelerator: 'CmdOrCtrl+N',
              click: () => this.send('new-project'),
            },
            {
              label: fr ? 'Modifier le projet courant…' : 'Edit current project…',
              enabled: !!store?.state.activeProjectId,
              click: () => this.send('edit-project'),
            },
            { type: 'separator' as const },
            {
              label: fr ? 'Paramètres…' : 'Settings…',
              accelerator: 'CmdOrCtrl+,',
              click: () => this.send('open-settings'),
            },
            { type: 'separator' as const },
            { role: 'quit' as const },
          ],
        },
        { role: 'editMenu' },
        { role: 'viewMenu' },
        { role: 'windowMenu' },
      ]),
    );
  }
}
