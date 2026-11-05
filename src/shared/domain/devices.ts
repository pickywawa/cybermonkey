import type { AccessibilityIssue } from './report.js';
import type { Locator, OS } from './scenario.js';

export interface Device {
  id: string;
  name: string;
  platform: OS;
  /** cloud = a profile on a device cloud or on your own Appium server: nothing is plugged in here. */
  kind: 'usb' | 'simulator' | 'network' | 'manual' | 'cloud';
  status: 'ready' | 'unauthorized' | 'offline';
  detail: string;
  osVersion?: string;
  developerMode?: string;
  ddiReady?: boolean;
  /** Set for remote profiles: which provider serves it and which profile of Settings it comes from. */
  remote?: { provider: import('./remote.js').RemoteProvider; profile: string };
}
export interface DeviceCheck {
  id: string;
  label: string;
  state: 'ok' | 'error' | 'pending' | 'unknown';
  detail: string;
  fix?: string;
  /** Shell command the user can copy/run to fix the issue. */
  command?: string;
  log?: string;
  documentation?: string;
}
export interface DeviceHealth {
  deviceId: string;
  checkedAt: string;
  checks: DeviceCheck[];
}
export interface DeviceScan {
  devices: Device[];
  diagnostics: string[];
}
export interface Component {
  id: string;
  type: string;
  label: string;
  text: string;
  locator?: Locator;
  rect: { x: number; y: number; width: number; height: number };
  enabled: boolean;
  password: boolean;
  /** Looks tappable (button, cell, tab, clickable view…). */
  interactive?: boolean;
  /** Selected / checked / current tab state when exposed by the platform. */
  selected?: boolean;
}
export interface OpaqueRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  type: string;
}
export interface Screen {
  deviceId: string;
  /** Regions (web views…) drawn on screen but whose content is not in the accessibility tree. */
  opaque?: OpaqueRegion[];
  components: Component[];
  /** Accessibility problems seen in the page source (computed with it, nothing extra is asked of the device). */
  a11y?: AccessibilityIssue[];
  width: number;
  height: number;
  capturedAt: string;
}
/** Shorter representation of a screen sent to an LLM: fewer tokens, same actionable information. */
export function compactScreen(screen: Screen, limit = 140) {
  const seen = new Set<string>();
  const components = screen.components
    .filter((c) => c.locator && !seen.has(c.id) && seen.add(c.id))
    .slice(0, limit)
    .map((c) => ({
      id: c.id,
      type: c.type.replace(/^XCUIElementType|^android\.(widget|view)\./, ''),
      label: c.label.slice(0, 80),
      ...(c.text && c.text !== c.label ? { text: c.text.slice(0, 80) } : {}),
      ...(c.enabled ? {} : { disabled: true }),
      ...(c.password ? { secure: true } : {}),
      ...(c.interactive ? { tap: true } : {}),
      ...(c.selected ? { selected: true } : {}),
      at: [
        Math.round((c.rect.x + c.rect.width / 2) / 10),
        Math.round((c.rect.y + c.rect.height / 2) / 10),
      ],
    }));
  return {
    deviceId: screen.deviceId,
    size: [screen.width, screen.height],
    components,
    truncated: screen.components.length > components.length,
    ...(screen.opaque?.length ? { opaque: screen.opaque } : {}),
  };
}
/** Stable signature of what a screen shows (locators, texts, state). */
export function screenFingerprint(screen: Screen): string {
  return JSON.stringify(screen.components.map((c) => [c.locator, c.text, c.enabled]));
}
/** Pick one ready USB device per platform when none is selected yet. */
export function autoSelectDevices(
  current: Partial<Record<OS, string>>,
  devices: Device[],
  platforms: readonly OS[],
): Partial<Record<OS, string>> {
  const ids = { ...current };
  for (const os of platforms) {
    if (devices.some((d) => d.id === ids[os] && d.platform === os && d.status === 'ready'))
      continue;
    const rank = (d: Device) => (d.kind === 'usb' ? 0 : d.kind === 'simulator' ? 1 : 2);
    const candidate = devices
      .filter((d) => d.platform === os && d.status === 'ready')
      .sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id))[0];
    if (candidate && candidate.kind === 'usb') ids[os] = candidate.id;
  }
  return ids;
}
