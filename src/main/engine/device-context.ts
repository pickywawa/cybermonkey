import type { Screen } from '../../shared/domain/devices.js';
import type { Locator, NodeKind, OS, Variant } from '../../shared/domain/scenario.js';
import type { Automation } from '../infra/appium/automation.js';
import type { Devices } from '../infra/devices/scanner.js';

/** Everything the engine needs to drive ONE device, with lease owner, cancellation and variables bound. */
export interface DeviceContext {
  deviceId: string;
  platform: OS;
  owner: string;
  signal: AbortSignal;
  perform(variant: Variant, kind: NodeKind): Promise<void>;
  inspect(): Promise<Screen>;
  /** True when every marker resolves to exactly one element (cheap alternative to a full inspection). */
  markersPresent(markers: Locator[]): Promise<boolean>;
  screenshot(): Promise<string | undefined>;
  ensureApplication(application: string, restart: boolean): Promise<void>;
}
export function deviceContext(
  automation: Automation,
  devices: Devices,
  deviceId: string,
  owner: string,
  signal: AbortSignal,
  variables: () => Record<string, string>,
): DeviceContext {
  const platform = devices.known.get(deviceId)?.platform;
  if (!platform) throw new Error('Appareil inconnu : ' + deviceId);
  return {
    deviceId,
    platform,
    owner,
    signal,
    perform: (variant, kind) =>
      automation.perform(deviceId, variant, kind, owner, signal, variables()),
    inspect: () => automation.inspect(deviceId, owner),
    markersPresent: (markers) => automation.markersPresent(deviceId, markers, owner),
    screenshot: () =>
      automation.screenshot(deviceId).then((s) => s ?? devices.screenshot(deviceId)),
    ensureApplication: (application, restart) =>
      automation.ensureApplication(deviceId, application, owner, restart, signal),
  };
}
