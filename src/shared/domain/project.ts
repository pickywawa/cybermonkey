import { z } from 'zod';
import {
  nodeSchema,
  osSchema,
  OS_LIST,
  validateTree,
  type OS,
  type ScenarioNode,
} from './scenario.js';
import { variablesSchema } from './variables.js';

const appId = (re: RegExp) => z.string().trim().max(255).regex(re).default('');
export const applicationsSchema = z.object({
  android: appId(/^[A-Za-z0-9_.]*$/),
  ios: appId(/^[A-Za-z0-9_.-]*$/),
});
const iconSchema = z
  .string()
  .max(1000000)
  .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/)
  .optional();
const detailSchema = z
  .object({ id: z.string().max(255), name: z.string().max(180), icon: iconSchema })
  .optional();
export const applicationDetailsSchema = z.object({ android: detailSchema, ios: detailSchema });
export type Applications = z.infer<typeof applicationsSchema>;
export type ApplicationDetails = z.infer<typeof applicationDetailsSchema>;

export const projectNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine(
    (v) =>
      !/[<>:"/\\|?*\x00-\x1f]/.test(v) &&
      v !== '.' &&
      v !== '..' &&
      !/[. ]$/.test(v) &&
      !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(v),
    'Invalid folder name',
  );
export const projectInput = z.object({
  name: projectNameSchema,
  platforms: z.array(osSchema).min(1).max(2),
  applications: applicationsSchema.optional(),
  applicationDetails: applicationDetailsSchema.optional(),
});
export type ProjectInput = z.infer<typeof projectInput>;

export const chatSessionSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(100),
  createdAt: z.string(),
});
export type ChatSession = z.infer<typeof chatSessionSchema>;
export const messageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  sessionId: z.string().optional(),
  content: z.string(),
  at: z.string(),
});
export type Message = z.infer<typeof messageSchema>;

/** Which OS the user currently works on: both, or one at a time. */
export const focusSchema = z.enum(['all', 'android', 'ios']);
export type Focus = z.infer<typeof focusSchema>;

export const PROJECT_TABS = ['creation', 'execution'] as const;
export const projectSchema = z.object({
  id: z.string(),
  name: projectNameSchema,
  directory: z.string(),
  platforms: z.array(osSchema).min(1).max(2),
  focus: focusSchema.default('all'),
  tab: z.enum(PROJECT_TABS).default('creation'),
  applicationDetails: applicationDetailsSchema.default({}),
  applications: applicationsSchema.default({ android: '', ios: '' }),
  variables: variablesSchema.default({}),
  chatSessions: z.array(chatSessionSchema).default([]),
  activeChatSessionId: z.string().nullable().default(null),
  activeCampaignId: z.string().uuid().nullable().default(null),
  nodes: z.array(nodeSchema).default([]),
  selectedNodeId: z.string().nullable().default(null),
  tags: z.array(z.string()).default([]),
  revision: z.number().int().default(0),
  deviceIds: z.object({ android: z.string().optional(), ios: z.string().optional() }).default({}),
  messages: z.array(messageSchema).default([]),
  createdAt: z.string(),
});
export type Project = z.infer<typeof projectSchema> & { nodes: ScenarioNode[] };

/** Operating systems the user is currently working on. */
export function activeOs(p: Pick<Project, 'platforms' | 'focus'>): OS[] {
  return p.focus !== 'all' && p.platforms.includes(p.focus) ? [p.focus] : [...p.platforms];
}

/** Accepts Cyberfox (legacy) and current project files. Flutter targets become Android + iOS. */
export function migrateProject(raw: any): Project {
  const legacyPlatforms: string[] = Array.isArray(raw.platforms) ? raw.platforms : OS_LIST.slice();
  const platforms = [
    ...new Set(legacyPlatforms.flatMap((p) => (p === 'flutter' ? ['android', 'ios'] : [p]))),
  ].filter((p): p is OS => p === 'android' || p === 'ios');
  const convert = (nodes: any[], root: boolean): any[] =>
    nodes.map((n) => ({
      ...n,
      kind: root
        ? 'scenario'
        : n.kind === 'folder'
          ? 'navigation'
          : n.kind === 'assertion'
            ? 'test'
            : n.kind,
      children: convert(n.children ?? [], false),
    }));
  const sessions: ChatSession[] = raw.chatSessions?.length
    ? raw.chatSessions
    : [
        {
          id: 'legacy-session',
          name: 'Session 1',
          createdAt: raw.createdAt ?? new Date().toISOString(),
        },
      ];
  const project = projectSchema.parse({
    ...raw,
    platforms: platforms.length ? platforms : OS_LIST.slice(),
    tab: raw.tab === 'execution' ? 'execution' : 'creation',
    chatSessions: sessions,
    activeChatSessionId: sessions.some((s) => s.id === raw.activeChatSessionId)
      ? raw.activeChatSessionId
      : sessions[0].id,
    messages: (raw.messages ?? []).map((m: Message) => ({
      ...m,
      sessionId: m.sessionId ?? sessions[0].id,
    })),
    nodes: convert(raw.nodes ?? [], true),
  });
  validateTree(project.nodes);
  return project as Project;
}

export interface ProjectUpdate {
  id: string;
  name?: string;
  platforms?: OS[];
  focus?: Focus;
  tab?: (typeof PROJECT_TABS)[number];
  applications?: Applications;
  applicationDetails?: ApplicationDetails;
  variables?: Record<string, string>;
  chatSessions?: ChatSession[];
  activeChatSessionId?: string | null;
  activeCampaignId?: string | null;
  nodes?: ScenarioNode[];
  tags?: string[];
  deviceIds?: Partial<Record<OS, string>>;
  selectedNodeId?: string | null;
  expectedRevision?: number;
}
export interface AppInfo {
  id: string;
  name: string;
  icon?: string;
}
