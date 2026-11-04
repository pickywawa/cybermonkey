import { contextBridge, ipcRenderer } from 'electron';
import type { Bridge, LiveEvent } from '../shared/ipc.js';

// A single generic bridge: channels are typed by the shared Contract, validated by the main process.
const bridge: Bridge = {
  call: (channel, input) => ipcRenderer.invoke(channel, input),
  onEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, value: LiveEvent) => callback(value);
    ipcRenderer.on('live:event', listener);
    return () => ipcRenderer.removeListener('live:event', listener);
  },
};
contextBridge.exposeInMainWorld('cybermonkey', bridge);
