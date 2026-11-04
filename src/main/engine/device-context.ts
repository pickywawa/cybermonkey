import type { Screen } from '../../shared/domain/devices.js';
import type { Locator, NodeKind, OS, Variant } from '../../shared/domain/scenario.js';
import type { Automation } from '../infra/appium/automation.js';
import type { LogEntry } from '../infra/devices/device-log.js';
import type { Devices } from '../infra/devices/scanner.js';

/** Everything the engine needs to drive ONE device, with lease owner, cancellation and variables bound. */
export interface DeviceContext {
  deviceId: string;
  platform: OS;
  owner: string;
  signal: AbortSignal;
  /** Returns the text a `capture` step read (also stored as a run variable). */
  perform(variant: Variant, kind: NodeKind): Promise<string | void>;
  /** Run variables: captured values and dataset columns, layered over the project variables. */
  setVariables(values: Record<string, string>): void;
  clearVariables(): void;
  inspect(): Promise<Screen>;
  /** True when every marker resolves to exactly one element (cheap alternative to a full inspection). */
  markersPresent(markers: Locator[]): Promise<boolean>;
  screenshot(): Promise<string | undefined>;
  /** Foreground state of the app (4 = foreground); undefined when unknown. */
  appState(application: string): Promise<number | undefined>;
  /** The dialog blocking the app, if any. */
  alertInfo(): Promise<{ text: string; buttons: string[] } | null>;
  /** Starts a screen recording; false when this device cannot record. */
  startRecording(): Promise<boolean>;
  /** Stops it and returns the video (base64 mp4). */
  stopRecording(): Promise<string | undefined>;
  /** Recent device log (empty when unavailable). */
  deviceLog(): Promise<{ entries: LogEntry[]; pid?: number }>;
  ensureApplication(application: string, restart: boolean): Promise<void>;
}
export function deviceContext(
  automation: Automation,
  devices: Devices,
  deviceId: string,
  owner: string,
  signal: AbortSignal,
  variables: () => Record<string, string>,
  application?: string,
): DeviceContext {
  const platform = devices.known.get(deviceId)?.platform;
  if (!platform) throw new Error('Appareil inconnu : ' + deviceId);
  const run: Record<string, string> = {};
  return {
    deviceId,
    platform,
    owner,
    signal,
    perform: async (variant, kind) => {
      const out = await automation.perform(
        deviceId,
        variant,
        kind,
        owner,
        signal,
        { ...variables(), ...run },
        false,
        application,
      );
      if (variant.operation === 'capture' && typeof out === 'string') run[variant.value] = out;
      return out;
    },
    setVariables: (values) => void Object.assign(run, values),
    clearVariables: () => {
      for (const k of Object.keys(run)) delete run[k];
    },
    inspect: () => automation.inspect(deviceId, owner),
    deviceLog: () => automation.deviceLog(deviceId, application, owner),
    appState: (app) => automation.appState(deviceId, app, owner),
    alertInfo: () => automation.alertInfo(deviceId, owner),
    startRecording: () => automation.startRecording(deviceId, owner),
    stopRecording: () => automation.stopRecording(deviceId),
    markersPresent: (markers) => automation.markersPresent(deviceId, markers, owner),
    screenshot: () =>
      automation.screenshot(deviceId).then((s) => s ?? devices.screenshot(deviceId)),
    ensureApplication: (application, restart) =>
      automation.ensureApplication(deviceId, application, owner, restart, signal),
  };
}
