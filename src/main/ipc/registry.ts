import { ipcMain, BrowserWindow } from 'electron';
import type { z } from 'zod';
import type { Channel, Input, Output } from '../../shared/ipc.js';

/** Typed IPC registration: the handler signature is derived from the shared Contract. */
export class Ipc {
  constructor(private isAllowed: (win: BrowserWindow | null) => boolean) {}
  handle<C extends Channel>(
    channel: C,
    handler: (input: Input<C>) => Output<C> | Promise<Output<C>>,
    schema?: z.ZodType<Input<C>>,
  ) {
    ipcMain.handle(channel, (event, arg) => {
      const owner = BrowserWindow.fromWebContents(event.sender);
      if (!owner || !this.isAllowed(owner) || event.senderFrame !== owner.webContents.mainFrame)
        throw new Error('IPC interdit');
      return handler((schema ? schema.parse(arg) : arg) as Input<C>);
    });
  }
}
