import { z } from 'zod';

/**
 * Secrets never live in `settings` (which the window receives whole): they sit in a separate store and the window only
 * learns whether each one is set.
 */
export const SECRET_KEYS = [
  'slackWebhook',
  'teamsWebhook',
  'smtpPassword',
  'githubToken',
  'jiraToken',
  'testrailApiKey',
  'azurePat',
  'browserstackKey',
  'saucelabsKey',
  'awsSecretKey',
  'remoteAppiumSecret',
] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

const text = (max: number) => z.string().trim().max(max).default('');
const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .default('')
  .refine((v) => !v || /^https?:\/\//i.test(v), 'URL http(s) attendue');

/* ---------- Git ---------- */
export const gitSyncSchema = z.object({
  /** Check the remote when the app starts and offer to fast-forward (always asks first). */
  pullOnStart: z.boolean().default(false),
  /** Also check the remote every N minutes while the app is open (0 = never). */
  pullEveryMinutes: z.number().int().min(0).max(1440).default(0),
  /** Offer to commit and push once scenarios or project data were created / modified. */
  pushOnChange: z.boolean().default(false),
  /** Offer to commit and push once a run has finished (campaign results). */
  pushOnRun: z.boolean().default(false),
  /** Screenshots and videos of campaigns are heavy: left out unless asked for. */
  includeMedia: z.boolean().default(false),
  /** Wait this long after the last change before proposing a push, so one burst of edits makes one proposal. */
  delaySeconds: z.number().int().min(10).max(3600).default(60),
  commitMessage: text(200).default('Cybermonkey : {summary}'),
});
export type GitSyncSettings = z.infer<typeof gitSyncSchema>;

/* ---------- Notifications ---------- */
export const PROGRESS_STEPS = [5, 10, 20, 25, 50] as const;
export const notificationsSchema = z.object({
  slack: z.object({ enabled: z.boolean().default(false) }).default({ enabled: false }),
  teams: z.object({ enabled: z.boolean().default(false) }).default({ enabled: false }),
  email: z
    .object({
      enabled: z.boolean().default(false),
      host: text(200),
      port: z.number().int().min(1).max(65535).default(587),
      security: z.enum(['none', 'starttls', 'tls']).default('starttls'),
      username: text(200),
      from: text(200),
      /** Comma / semicolon separated. */
      to: text(1000),
    })
    .default({
      enabled: false,
      host: '',
      port: 587,
      security: 'starttls',
      username: '',
      from: '',
      to: '',
    }),
  events: z
    .object({
      /** One message per failing test (rate-limited). Off by default: it is the noisiest. */
      stepFailed: z.boolean().default(false),
      /** One message per run listing the steps that passed before and fail now. */
      regression: z.boolean().default(true),
      /** Campaign progress, once per threshold crossed. */
      progress: z.boolean().default(false),
      /** One summary when a run ends, whatever the result. */
      runFinished: z.boolean().default(false),
    })
    .default({ stepFailed: false, regression: true, progress: false, runFinished: false }),
  /** Progress is announced every N % (5, 10, 20, 25 or 50). */
  progressStep: z
    .number()
    .int()
    .refine((v) => (PROGRESS_STEPS as readonly number[]).includes(v))
    .default(10),
  /** Failing-test messages sent per run at most; the rest is counted in the end-of-run message. */
  maxFailuresPerRun: z.number().int().min(1).max(50).default(5),
  include: z
    .object({
      analysis: z.boolean().default(true),
      /** E-mail only: Slack and Teams incoming webhooks cannot carry files. */
      screenshot: z.boolean().default(false),
      /** E-mail only, and only when small enough. */
      video: z.boolean().default(false),
    })
    .default({ analysis: true, screenshot: false, video: false }),
});
export type NotificationSettings = z.infer<typeof notificationsSchema>;

/* ---------- Test management tools ---------- */
export const TRACKER_KINDS = ['testrail', 'azure'] as const;
export type TrackerKind = (typeof TRACKER_KINDS)[number];
export const AUTOMATION_MODES = ['off', 'ask', 'auto'] as const;
export type AutomationMode = (typeof AUTOMATION_MODES)[number];

export const trackersSchema = z.object({
  /** off = never; ask = confirmation window; auto = send when a run ends. */
  mode: z.enum(AUTOMATION_MODES).default('off'),
  kind: z.enum(TRACKER_KINDS).default('testrail'),
  testrail: z
    .object({
      url: httpsUrl,
      username: text(200),
      projectId: text(20),
      suiteId: text(20),
    })
    .default({ url: '', username: '', projectId: '', suiteId: '' }),
  azure: z
    .object({
      /** https://dev.azure.com/<organization> or an on-premise collection URL. */
      url: httpsUrl,
      project: text(200),
      planId: text(20),
      suiteId: text(20),
    })
    .default({ url: '', project: '', planId: '', suiteId: '' }),
});
export type TrackerSettings = z.infer<typeof trackersSchema>;

/* ---------- Tickets ---------- */
export const ticketsSchema = z.object({
  mode: z.enum(AUTOMATION_MODES).default('off'),
  provider: z.enum(['github', 'jira']).default('github'),
  /** One ticket for the whole run, or one per regressed step. */
  grouping: z.enum(['run', 'step']).default('run'),
  /** Never more tickets than this per run, whatever the grouping. */
  maxPerRun: z.number().int().min(1).max(20).default(3),
  github: z
    .object({
      owner: text(100),
      repo: text(100),
      labels: text(300).default('bug, cybermonkey'),
      assignees: text(300),
    })
    .default({ owner: '', repo: '', labels: 'bug, cybermonkey', assignees: '' }),
  jira: z
    .object({
      url: httpsUrl,
      /** Jira Cloud: e-mail + API token (basic). Server / Data Center: personal access token (bearer). */
      auth: z.enum(['basic', 'bearer']).default('basic'),
      email: text(200),
      projectKey: text(40),
      issueType: text(80).default('Bug'),
      labels: text(300).default('cybermonkey'),
      /** JSON object merged into the issue `fields` (custom fields that are the same for every ticket). */
      extraFields: text(8000),
    })
    .default({
      url: '',
      auth: 'basic',
      email: '',
      projectKey: '',
      issueType: 'Bug',
      labels: 'cybermonkey',
      extraFields: '',
    }),
  /** Let the AI write the ticket (title, description, custom fields) from the instructions below. */
  useAi: z.boolean().default(false),
  /** Describes the fields of your tracker, house rules, an example `curl` creation… given to the AI as is. */
  instructions: text(8000),
  /** Jira only: attach the screenshot of the failing step. */
  attachScreenshot: z.boolean().default(true),
});
export type TicketSettings = z.infer<typeof ticketsSchema>;

export const integrationsSchema = z.object({
  git: gitSyncSchema.default(gitSyncSchema.parse({})),
  notifications: notificationsSchema.default(notificationsSchema.parse({})),
  trackers: trackersSchema.default(trackersSchema.parse({})),
  tickets: ticketsSchema.default(ticketsSchema.parse({})),
});
export type IntegrationSettings = z.infer<typeof integrationsSchema>;

/* ---------- Runtime shapes shared with the window ---------- */
export interface GitInfo {
  /** The folder is inside a git work tree. */
  isRepo: boolean;
  root?: string;
  branch?: string;
  /** Remote-tracking branch, e.g. origin/main. */
  upstream?: string;
  remote?: string;
  /** Uncommitted files under the folder. */
  changes?: number;
  ahead?: number;
  behind?: number;
  /** git itself is missing, or the folder cannot be read. */
  error?: string;
}
export interface JournalEntry {
  at: string;
  target: string;
  ok: boolean;
  message: string;
}
export interface IntegrationStatus {
  secrets: Record<SecretKey, boolean>;
  journal: JournalEntry[];
  /** True when the app can show confirmation windows (it cannot when run from the command line). */
  interactive: boolean;
}
export const TEST_TARGETS = [
  'slack',
  'teams',
  'email',
  'github',
  'jira',
  'testrail',
  'azure',
] as const;
export type TestTarget = (typeof TEST_TARGETS)[number];

/** A question the main process asks the person before doing something visible from outside (push, ticket…). */
export interface ConfirmRequest {
  id: string;
  kind: 'git-pull' | 'git-push' | 'ticket' | 'tracker';
  title: string;
  message: string;
  /** Short lines under the message (files, results…). */
  details: string[];
  /** Text the person may edit before accepting (commit message, ticket payload). */
  editable?: { label: string; value: string; mono?: boolean; rows?: number };
  confirmLabel: string;
  /** A notice with a single « OK » button: nothing is asked (e.g. a conflict the person has to resolve). */
  informational?: boolean;
}
