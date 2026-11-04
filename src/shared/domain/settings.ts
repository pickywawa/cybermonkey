import { z } from 'zod';

const localUrl = z
  .string()
  .url()
  .refine((v) => {
    const u = new URL(v);
    return (
      u.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) &&
      !u.username &&
      !u.password
    );
  }, 'Local HTTP address required');

export const THEMES = [
  'system',
  'light',
  'dark',
  'midnight',
  'dracula',
  'forest',
  'sunset',
] as const;
export const PROVIDERS = ['claude', 'codex', 'copilot'] as const;
export type Provider = (typeof PROVIDERS)[number];

export const settingsSchema = z.object({
  theme: z.enum(THEMES).default('system'),
  language: z.enum(['fr', 'en']).default('fr'),
  projectsDirectory: z.string().min(1),

  provider: z.enum(PROVIDERS).default('claude'),
  claudeModel: z.string().max(100).default(''),
  codexModel: z.string().max(100).default(''),
  copilotModel: z.string().max(100).default(''),
  reasoningEffort: z.enum(['default', 'low', 'medium', 'high']).default('default'),

  /* AI-assisted creation */
  explorationMode: z.enum(['interactive', 'auto-approve']).default('interactive'),
  creationMaxDecisions: z.number().int().min(1).max(500).default(40),
  creationTimeoutMinutes: z.number().int().min(1).max(120).default(12),
  creationPrompt: z.string().max(20000).default(''),
  /** Low reasoning effort while navigating (several times faster); the final proposal is validated by the host anyway. */
  creationFastMode: z.boolean().default(true),
  creationReplay: z.boolean().default(true),
  creationPreparation: z.boolean().default(true),
  creationQuestions: z.boolean().default(true),

  /* AI during test execution */
  executionPreparation: z.enum(['off', 'existing', 'ai']).default('existing'),
  healing: z.enum(['off', 'actions']).default('actions'),
  /** Evidence kept per step: every step, only screens/checks/failures, or failures only. Fewer captures = faster runs. */
  executionProof: z.enum(['all', 'key', 'failures']).default('key'),
  analysisMode: z.enum(['automatic', 'ask', 'off']).default('ask'),

  /* Devices */
  deviceAutoRefresh: z.boolean().default(true),
  appiumUrl: localUrl.default('http://127.0.0.1:4723'),
  wdaUrl: localUrl.default('http://127.0.0.1:8100'),
  wdaDeviceId: z.string().max(100).default(''),
  iosTeamId: z.string().max(40).default(''),
  iosWdaBundleId: z.string().max(180).default(''),
  iosKeepAwake: z.boolean().default(false),
  iosWdaMode: z.enum(['build', 'preinstalled', 'external']).default('build'),
  iosXcodeConfigFile: z.string().max(2000).default(''),
  iosPlatformVersion: z.string().max(30).default(''),

  /* Updates & layout */
  checkUpdatesOnStart: z.boolean().default(true),
  autoDownloadUpdates: z.boolean().default(false),
  devicesDetached: z.boolean().default(false),
  aiDetached: z.boolean().default(false),
  leftWidth: z.number().min(180).max(600).default(264),
  rightWidth: z.number().min(280).max(1600).default(440),
  chatHeight: z.number().min(130).max(800).default(250),
});
export type Settings = z.infer<typeof settingsSchema>;
export const defaultSettings = (projectsDirectory: string): Settings =>
  settingsSchema.parse({ projectsDirectory });

export interface ProviderStatus {
  provider: Provider;
  installed: boolean;
  authenticated: boolean;
  message: string;
  account?: string;
  models: { id: string; name: string }[];
  lastUsage?: { input: number; output: number };
  quota?: { label: string; usedPercent: number };
  /** Actionable help when something is wrong. */
  help?: string;
}
export interface LoginProgress {
  provider: Provider;
  output: string;
  running: boolean;
}
