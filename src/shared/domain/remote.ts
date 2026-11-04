import { z } from 'zod';
import { osSchema } from './scenario.js';

/**
 * Remote devices: phones that are not plugged into this machine.
 *  - adb over the network: `adb connect host:port`, then they behave like any local Android device;
 *  - a device cloud (BrowserStack, Sauce Labs, AWS Device Farm): each « device » is a profile whose session is opened
 *    on the provider's Appium endpoint when a run starts;
 *  - your own Appium server on another machine (a device lab).
 * Credentials never live here: see `SECRET_KEYS`.
 */
export const REMOTE_PROVIDERS = ['browserstack', 'saucelabs', 'devicefarm', 'appium'] as const;
export type RemoteProvider = (typeof REMOTE_PROVIDERS)[number];
export const SAUCE_REGIONS = ['us-west-1', 'eu-central-1', 'us-east-4'] as const;

const text = (max: number) => z.string().trim().max(max).default('');
const url = z
  .string()
  .trim()
  .max(500)
  .default('')
  .refine((v) => !v || /^https?:\/\//i.test(v), 'URL http(s) attendue');
/** The reference the provider gave to an uploaded application (`bs://…`, `storage:filename=…`, an ARN). */
const appRefs = z.object({ android: text(500), ios: text(500) }).default({ android: '', ios: '' });

export const remoteDeviceSchema = z.object({
  /** Stable slug: the device id is `remote:<id>`. */
  id: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9][a-z0-9-]*$/),
  label: z.string().trim().min(1).max(80),
  provider: z.enum(REMOTE_PROVIDERS),
  platform: osSchema,
  /** BrowserStack / Sauce Labs: the model (« Samsung Galaxy S23 »; Sauce also accepts a regular expression). */
  deviceName: text(120),
  /** « 13.0 », « 17 ». */
  osVersion: text(30),
  /** AWS Device Farm: the device ARN. Your own Appium server: the device udid. */
  ref: text(300),
});
export type RemoteDevice = z.infer<typeof remoteDeviceSchema>;

export const remoteSchema = z.object({
  adb: z
    .object({
      /** `host:port`, one per phone. Reconnected automatically while the app is open. */
      hosts: z.array(z.string().trim().max(120)).max(20).default([]),
    })
    .default({ hosts: [] }),
  browserstack: z
    .object({
      username: text(120),
      appiumVersion: text(20),
      app: appRefs,
    })
    .default({ username: '', appiumVersion: '', app: { android: '', ios: '' } }),
  saucelabs: z
    .object({
      username: text(120),
      region: z.enum(SAUCE_REGIONS).default('us-west-1'),
      appiumVersion: text(20),
      app: appRefs,
    })
    .default({
      username: '',
      region: 'us-west-1',
      appiumVersion: '',
      app: { android: '', ios: '' },
    }),
  devicefarm: z
    .object({
      accessKeyId: text(120),
      /** `arn:aws:devicefarm:us-west-2:<account>:project:<id>` */
      projectArn: text(300),
      appiumVersion: text(20),
      /** ARNs of the uploaded applications. */
      app: appRefs,
    })
    .default({
      accessKeyId: '',
      projectArn: '',
      appiumVersion: '',
      app: { android: '', ios: '' },
    }),
  appium: z
    .object({
      url,
      auth: z.enum(['none', 'basic', 'bearer']).default('none'),
      username: text(120),
    })
    .default({ url: '', auth: 'none', username: '' }),
  devices: z.array(remoteDeviceSchema).max(40).default([]),
  /** A cloud session nobody uses is closed after this long (they are billed by the minute). */
  idleMinutes: z.number().int().min(1).max(60).default(5),
});
export type RemoteSettings = z.infer<typeof remoteSchema>;

export const REMOTE_PREFIX = 'remote:';
export const isRemoteId = (id: string) => id.startsWith(REMOTE_PREFIX);
export const remoteIdOf = (id: string) => id.slice(REMOTE_PREFIX.length);

/** `Galaxy S23 (BrowserStack)` → `galaxy-s23-browserstack`, unique among `taken`. */
export function slugFor(label: string, taken: string[]): string {
  const base =
    label
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'device';
  let slug = base;
  for (let i = 2; taken.includes(slug); i++) slug = `${base}-${i}`;
  return slug;
}

/** `192.168.1.20:5555` or `phone.local` (port 5555 by default); empty when it cannot be an adb target. */
export function adbTarget(value: string): string {
  const v = value.trim();
  const m = v.match(/^([A-Za-z0-9][A-Za-z0-9._-]*|\[[0-9a-fA-F:]+\])(?::(\d{1,5}))?$/);
  if (!m) return '';
  const port = m[2] ? Number(m[2]) : 5555;
  return port >= 1 && port <= 65535 ? `${m[1]}:${port}` : '';
}

export const PROVIDER_LABEL: Record<RemoteProvider, string> = {
  browserstack: 'BrowserStack',
  saucelabs: 'Sauce Labs',
  devicefarm: 'AWS Device Farm',
  appium: 'Appium',
};

export interface RemoteStatus {
  /** What each adb host looks like right now. */
  adb: {
    host: string;
    state: 'connected' | 'unreachable' | 'unauthorized' | 'unknown';
    detail: string;
  }[];
  /** Which providers have what they need to open a session. */
  providers: Record<RemoteProvider, { ready: boolean; missing: string }>;
}
