import type { Bridge, Channel, Input, LiveEvent, Output } from '../../shared/ipc';
import { classifyError } from '../../shared/errors';
import { createMockBridge } from './mock-bridge';

/** Desktop: the Electron preload bridge. Browser preview: an in-memory mock with demo data. */
export const isDesktop = typeof window !== 'undefined' && !!window.cybermonkey;
const bridge: Bridge = window.cybermonkey ?? createMockBridge();

export function call<C extends Channel>(channel: C, input?: Input<C>): Promise<Output<C>> {
  return bridge.call(channel, input as Input<C>).catch((error) => {
    // Electron prefixes remote errors; keep only the useful message.
    const message = String(error?.message ?? error).replace(
      /^Error invoking remote method '[^']+': (Error: )?/,
      '',
    );
    throw Object.assign(new Error(message), { info: classifyError(message) });
  });
}
export const onEvent = (callback: (e: LiveEvent) => void) => bridge.onEvent(callback);
export const appVersion = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
