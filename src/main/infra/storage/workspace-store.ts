import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  activeOs,
  migrateProject,
  normalizeEnvironments,
  projectInput,
  projectSchema,
  type Message,
  type Project,
  type ProjectUpdate,
} from '../../../shared/domain/project.js';
import { defaultSettings, settingsSchema, type Settings } from '../../../shared/domain/settings.js';
import { validateTree, flatten } from '../../../shared/domain/scenario.js';
import { validateScreenDefinitions } from '../../../shared/domain/screens.js';
import type { Workspace } from '../../../shared/ipc.js';
import { Queue, readJson, writeJson } from './atomic.js';

const PROJECT_FILE = 'cybermonkey.project.json';
const LEGACY_FILE = 'cyberfox.project.json';
export type ProjectPatch = ProjectUpdate & { messages?: Message[] };

/** Settings + project index (workspace.json) and one JSON file per project directory. */
export class WorkspaceStore {
  state!: Workspace;
  private queue = new Queue();
  constructor(
    private configDirectory: string,
    private documents: string,
  ) {}

  async load() {
    await fs.mkdir(this.configDirectory, { recursive: true });
    const defaults = defaultSettings(path.join(this.documents, 'Cybermonkey', 'Projects'));
    try {
      const raw = await readJson<any>(path.join(this.configDirectory, 'workspace.json'));
      this.state = {
        settings: settingsSchema.parse({ ...defaults, ...raw.settings }),
        projects: [],
        activeProjectId: raw.activeProjectId ?? null,
      };
      for (const entry of raw.projects ?? []) {
        try {
          const file = path.join(entry.directory, PROJECT_FILE);
          const project = migrateProject(await readJson(file));
          this.state.projects.push({ ...project, directory: entry.directory });
        } catch (error) {
          console.warn('Project unavailable:', entry.directory, String(error));
        }
      }
      if (!this.state.projects.some((p) => p.id === this.state.activeProjectId))
        this.state.activeProjectId = null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error(`Impossible de lire la configuration : ${String(error)}`);
      this.state = { settings: defaults, projects: [], activeProjectId: null };
    }
    await this.ensureMcpToken();
    return this.state;
  }
  /** The MCP server is on by default: it must never run with an empty or guessable token. */
  private async ensureMcpToken() {
    if (this.state.settings.mcpToken) return;
    this.state.settings = { ...this.state.settings, mcpToken: randomBytes(24).toString('hex') };
    await this.persist();
  }
  async regenerateMcpToken() {
    return this.patchSettings({ mcpToken: randomBytes(24).toString('hex') });
  }
  private persist() {
    return writeJson(path.join(this.configDirectory, 'workspace.json'), {
      ...this.state,
      projects: this.state.projects.map(({ id, name, directory }) => ({ id, name, directory })),
    });
  }
  get(id: string): Project {
    const p = this.state.projects.find((p) => p.id === id);
    if (!p) throw new Error('Projet introuvable');
    return p;
  }
  /** OS the active project currently targets, honoring its "one OS at a time" focus. */
  activeProject() {
    return this.state.projects.find((p) => p.id === this.state.activeProjectId);
  }
  activeOs(projectId: string) {
    return activeOs(this.get(projectId));
  }

  saveSettings(input: unknown) {
    return this.queue.run(async () => {
      const settings = settingsSchema.parse(input);
      if (!path.isAbsolute(settings.projectsDirectory))
        throw new Error('Le répertoire doit être un chemin absolu');
      const previous = this.state.settings;
      this.state.settings = settings;
      try {
        await this.persist();
      } catch (e) {
        this.state.settings = previous;
        throw e;
      }
      return settings;
    });
  }
  patchSettings(patch: Partial<Settings>) {
    return this.saveSettings({ ...this.state.settings, ...patch });
  }

  create(input: unknown) {
    return this.queue.run(async () => {
      const data = projectInput.parse(input);
      const directory = path.join(this.state.settings.projectsDirectory, data.name);
      await fs.mkdir(this.state.settings.projectsDirectory, { recursive: true });
      await fs.mkdir(directory); // never overwrite an existing folder
      const session = { id: randomUUID(), name: 'Session 1', createdAt: new Date().toISOString() };
      const project = projectSchema.parse({
        ...data,
        id: randomUUID(),
        directory,
        chatSessions: [session],
        activeChatSessionId: session.id,
        createdAt: new Date().toISOString(),
      }) as Project;
      return this.register(project);
    });
  }
  private async register(project: Project) {
    const previous = this.state.activeProjectId;
    try {
      await writeJson(path.join(project.directory, PROJECT_FILE), project);
      this.state.projects.push(project);
      this.state.activeProjectId = project.id;
      await this.persist();
    } catch (e) {
      this.state.projects = this.state.projects.filter((p) => p.id !== project.id);
      this.state.activeProjectId = previous;
      await fs.rm(path.join(project.directory, PROJECT_FILE), { force: true });
      await fs.rmdir(project.directory).catch(() => {});
      throw e;
    }
    return project;
  }
  /** Import a Cyberfox project directory (flutter becomes android + ios). */
  importLegacy(directory: string) {
    return this.queue.run(async () => {
      let raw: any;
      for (const file of [PROJECT_FILE, LEGACY_FILE])
        try {
          raw = await readJson(path.join(directory, file));
          break;
        } catch {
          /* try next */
        }
      if (!raw) throw new Error('Aucun fichier projet Cyberfox / Cybermonkey dans ce dossier.');
      const project = migrateProject(raw);
      if (this.state.projects.some((p) => p.id === project.id))
        throw new Error('Ce projet est déjà dans l’espace de travail.');
      // Keep the original folder: scenarios, campaigns and captures stay where they are.
      project.directory = directory;
      return this.register(project);
    });
  }
  remove(id: string) {
    return this.queue.run(async () => {
      this.get(id);
      this.state.projects = this.state.projects.filter((p) => p.id !== id);
      if (this.state.activeProjectId === id)
        this.state.activeProjectId = this.state.projects[0]?.id ?? null;
      await this.persist();
    });
  }
  select(id: string) {
    return this.queue.run(async () => {
      this.get(id);
      const previous = this.state.activeProjectId;
      this.state.activeProjectId = id;
      try {
        await this.persist();
      } catch (e) {
        this.state.activeProjectId = previous;
        throw e;
      }
    });
  }

  update(input: ProjectPatch) {
    return this.queue.run(async () => {
      const current = this.get(input.id);
      if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision)
        throw new Error('Le projet a changé. Rechargez la proposition.');
      const { expectedRevision: _ignored, ...patch } = input;
      const platforms = patch.platforms ?? current.platforms;
      const parsed = projectSchema.parse({
        ...current,
        ...patch,
        focus:
          patch.focus ??
          (patch.platforms && current.focus !== 'all' && !platforms.includes(current.focus)
            ? 'all'
            : current.focus),
        deviceIds: { ...current.deviceIds, ...patch.deviceIds },
        revision:
          current.revision +
          (patch.nodes || patch.tags || patch.platforms || patch.applications ? 1 : 0),
      }) as Project;
      const next = normalizeEnvironments(parsed) as Project;
      if (
        next.activeChatSessionId &&
        !next.chatSessions.some((s) => s.id === next.activeChatSessionId)
      )
        throw new Error('Session IA introuvable');
      validateTree(next.nodes);
      validateScreenDefinitions(next.nodes);
      next.tags = [...new Set([...next.tags, ...flatten(next.nodes).flatMap((n) => n.tags)])];
      await writeJson(path.join(current.directory, PROJECT_FILE), next);
      const index = this.state.projects.indexOf(current);
      this.state.projects[index] = next;
      try {
        if (patch.name !== undefined) await this.persist();
      } catch (error) {
        this.state.projects[index] = current;
        await writeJson(path.join(current.directory, PROJECT_FILE), current);
        throw error;
      }
      return next;
    });
  }
}
