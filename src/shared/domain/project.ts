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

export const environmentSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(60),
  /** Overrides the project's common variables of the same name while this environment is selected. */
  variables: variablesSchema.default({}),
});
export type Environment = z.infer<typeof environmentSchema>;

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
  /** Named sets of variables (staging, pre-production…): one can be selected for everything the project does. */
  environments: z.array(environmentSchema).max(20).default([]),
  activeEnvironmentId: z.string().nullable().default(null),
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

/** Reads a project file. Only the current format is understood: older files are refused, not converted. */
export function parseProject(raw: any): Project {
  const sessions: ChatSession[] = raw.chatSessions?.length
    ? raw.chatSessions
    : [
        {
          id: 'session-1',
          name: 'Session 1',
          createdAt: raw.createdAt ?? new Date().toISOString(),
        },
      ];
  const project = projectSchema.parse({
    ...raw,
    chatSessions: sessions,
    activeChatSessionId: sessions.some((s) => s.id === raw.activeChatSessionId)
      ? raw.activeChatSessionId
      : sessions[0].id,
    messages: (raw.messages ?? []).map((m: Message) => ({
      ...m,
      sessionId: m.sessionId ?? sessions[0].id,
    })),
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
  environments?: Environment[];
  activeEnvironmentId?: string | null;
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

/** The environment currently selected for the project, if any. */
export const activeEnvironment = (
  project: Pick<Project, 'environments' | 'activeEnvironmentId'>,
): Environment | undefined =>
  project.environments?.find((e) => e.id === project.activeEnvironmentId);
/**
 * The variables a run, a creation session or a manual try actually uses: the project's common variables, overridden by
 * those of the selected environment.
 */
export const effectiveVariables = (
  project: Pick<Project, 'variables' | 'environments' | 'activeEnvironmentId'>,
): Record<string, string> => ({
  ...(project.variables ?? {}),
  ...(activeEnvironment(project)?.variables ?? {}),
});
/** Environments must have distinct names and the selected one must exist. */
export function normalizeEnvironments<
  T extends { environments: Environment[]; activeEnvironmentId: string | null },
>(project: T): T {
  const names = new Set<string>();
  for (const e of project.environments) {
    const key = e.name.trim().toLowerCase();
    if (names.has(key)) throw new Error(`Deux environnements portent le nom « ${e.name} ».`);
    names.add(key);
  }
  return {
    ...project,
    activeEnvironmentId: project.environments.some((e) => e.id === project.activeEnvironmentId)
      ? project.activeEnvironmentId
      : null,
  };
}
