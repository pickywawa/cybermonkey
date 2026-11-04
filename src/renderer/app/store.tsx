import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { autoSelectDevices, type DeviceScan } from '../../shared/domain/devices';
import { activeOs, type Project, type ProjectUpdate } from '../../shared/domain/project';
import type { Campaign, CampaignDetail, ReplayFrame, RunReport } from '../../shared/domain/report';
import type { LoginProgress, ProviderStatus, Settings } from '../../shared/domain/settings';
import type { OS } from '../../shared/domain/scenario';
import type { RecordedStep } from '../../shared/domain/recording';
import type { MenuAction, Workspace } from '../../shared/ipc';
import type { UpdateStatus } from '../../shared/update';
import { call, onEvent } from '../shared/api';
import { LanguageProvider, translate, type TFn } from '../shared/i18n';
import { ToastProvider } from '../shared/ui/overlays';

export interface AiQuestion {
  questionId: string;
  question: string;
  variableName?: string;
}
export interface AppState {
  workspace: Workspace | null;
  settings: Settings | null;
  project: Project | null;
  projectOs: OS[];
  t: TFn;
  devices: DeviceScan;
  unreachable: Set<string>;
  provider: ProviderStatus | null;
  login: LoginProgress | null;
  update: UpdateStatus | null;
  campaigns: Campaign[];
  detail: CampaignDetail | null;
  run: RunReport | null;
  replay: ReplayFrame | null;
  aiMessage: string;
  question: AiQuestion | null;
  recorder: { running: boolean; steps: RecordedStep[] };
  menu: { action: MenuAction; n: number } | null;
  loading: boolean;
}
export interface AppActions {
  updateProject(patch: Omit<ProjectUpdate, 'id'>): Promise<Project>;
  saveSettings(patch: Partial<Settings>): Promise<Settings>;
  selectProject(id: string): Promise<void>;
  refreshWorkspace(): Promise<void>;
  refreshDevices(): Promise<void>;
  refreshProvider(provider?: Settings['provider']): Promise<ProviderStatus | null>;
  refreshCampaigns(): Promise<void>;
  setQuestion(q: AiQuestion | null): void;
  setAiMessage(m: string): void;
  setRun(r: RunReport | null): void;
}
const StateContext = createContext<AppState | null>(null);
const ActionContext = createContext<AppActions | null>(null);
export const useApp = () => useContext(StateContext)!;
export const useActions = () => useContext(ActionContext)!;
/** Devices of the currently active OS set that are ready, keyed by OS. */
export function useActiveDevices() {
  const { project, projectOs, devices } = useApp();
  return useMemo(() => {
    const ids: Partial<Record<OS, string>> = {};
    if (project)
      for (const os of projectOs) {
        const id = project.deviceIds[os];
        if (id && devices.devices.some((d) => d.id === id && d.status === 'ready')) ids[os] = id;
      }
    return ids;
  }, [project, projectOs, devices]);
}

const resolveTheme = (theme: Settings['theme']) =>
  theme === 'system'
    ? matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
    : theme;

export function AppProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [devices, setDevices] = useState<DeviceScan>({ devices: [], diagnostics: [] });
  const [unreachable, setUnreachable] = useState<Set<string>>(new Set());
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [login, setLogin] = useState<LoginProgress | null>(null);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [run, setRun] = useState<RunReport | null>(null);
  const [replay, setReplay] = useState<ReplayFrame | null>(null);
  const [aiMessage, setAiMessage] = useState('');
  const [question, setQuestion] = useState<AiQuestion | null>(null);
  const [recorder, setRecorder] = useState<AppState['recorder']>({ running: false, steps: [] });
  const [menu, setMenu] = useState<AppState['menu']>(null);

  const settings = workspace?.settings ?? null;
  const project = workspace?.projects.find((p) => p.id === workspace.activeProjectId) ?? null;
  const projectId = project?.id;
  const campaignId = project?.activeCampaignId ?? null;
  const language = settings?.language ?? 'fr';
  const t = useMemo(() => translate(language), [language]);
  const projectOs = useMemo(() => (project ? activeOs(project) : []), [project]);

  const refreshWorkspace = useCallback(async () => setWorkspace(await call('workspace.load')), []);
  const refreshDevices = useCallback(async () => setDevices(await call('devices.scan')), []);
  const refreshCampaigns = useCallback(async () => {
    if (!projectId) return setCampaigns([]);
    setCampaigns(await call('campaigns.list', projectId).catch(() => []));
  }, [projectId]);
  const refreshProvider = useCallback(
    async (p?: Settings['provider']) => {
      const which = p ?? settings?.provider;
      if (!which) return null;
      const status = await call('ai.status', which).catch(() => null);
      if (!p || p === settings?.provider) setProvider(status);
      return status;
    },
    [settings?.provider],
  );

  /* initial load + live events */
  useEffect(() => {
    void refreshWorkspace();
    void refreshDevices();
    void call('updates.status')
      .then(setUpdate)
      .catch(() => {});
  }, [refreshWorkspace, refreshDevices]);
  const ref = useRef({ projectId, campaignId });
  ref.current = { projectId, campaignId };
  useEffect(
    () =>
      onEvent((e) => {
        if (e.type === 'workspace') void refreshWorkspace();
        else if (e.type === 'update') setUpdate(e.status);
        else if (e.type === 'devices') setDevices(e.scan);
        else if (e.type === 'device')
          setUnreachable((s) => {
            const n = new Set(s);
            e.ready ? n.delete(e.deviceId) : n.add(e.deviceId);
            return n;
          });
        else if (e.type === 'run') {
          setRun(e.report);
          setDetail((d) =>
            d && d.campaign.id === e.report.campaignId
              ? {
                  ...d,
                  reports: d.reports.some((r) => r.id === e.report.id)
                    ? d.reports.map((r) => (r.id === e.report.id ? e.report : r))
                    : [...d.reports, e.report],
                }
              : d,
          );
        } else if (e.type === 'ai') {
          if (e.projectId === ref.current.projectId) setAiMessage(e.message);
        } else if (e.type === 'ai-question') {
          if (e.projectId === ref.current.projectId)
            setQuestion({
              questionId: e.questionId,
              question: e.question,
              variableName: e.variableName,
            });
        } else if (e.type === 'login') setLogin(e.progress);
        else if (e.type === 'replay') {
          if (e.projectId === ref.current.projectId) setReplay(e.frame);
        } else if (e.type === 'recorder') {
          if (e.projectId === ref.current.projectId)
            setRecorder({ running: e.running, steps: e.steps });
        } else if (e.type === 'menu') setMenu((m) => ({ action: e.action, n: (m?.n ?? 0) + 1 }));
      }),
    [refreshWorkspace],
  );

  /* theme + language */
  useEffect(() => {
    if (!settings) return;
    const apply = () => (document.documentElement.dataset.theme = resolveTheme(settings.theme));
    apply();
    document.documentElement.lang = settings.language;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [settings?.theme, settings?.language]); // eslint-disable-line react-hooks/exhaustive-deps

  /* provider status follows the selected provider */
  useEffect(() => {
    if (settings?.provider) void refreshProvider();
  }, [settings?.provider, refreshProvider]);

  /* campaigns & replay follow the project */
  useEffect(() => {
    void refreshCampaigns();
    setReplay(null);
    setRun(null);
    setQuestion(null);
    setRecorder({ running: false, steps: [] });
  }, [projectId, refreshCampaigns]);
  useEffect(() => {
    if (!projectId) return setDetail(null);
    if (!campaignId) return setDetail(null);
    let cancelled = false;
    void call('campaigns.load', { projectId, campaignId })
      .then((d) => !cancelled && setDetail(d))
      .catch(() => !cancelled && setDetail(null));
    void call('replay.current', projectId)
      .then((f) => !cancelled && setReplay(f))
      .catch(() => {});
    void call('runs.current', projectId)
      .then((r) => !cancelled && setRun(r))
      .catch(() => {});
    void call('recorder.status', projectId)
      .then((s) => !cancelled && setRecorder(s))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId, campaignId]);
  useEffect(() => {
    if (run?.status !== 'running') void refreshCampaigns();
  }, [run?.status, refreshCampaigns]);

  /* automatically pair freshly detected USB devices with the project */
  useEffect(() => {
    if (!project) return;
    const next = autoSelectDevices(project.deviceIds, devices.devices, project.platforms);
    if (JSON.stringify(next) !== JSON.stringify(project.deviceIds))
      void call('projects.update', { id: project.id, deviceIds: next });
  }, [devices, project?.id, project?.platforms.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const actions = useMemo<AppActions>(
    () => ({
      async updateProject(patch) {
        const id = ref.current.projectId;
        if (!id) throw new Error('No project');
        const next = await call('projects.update', { id, ...patch });
        setWorkspace((w) =>
          w ? { ...w, projects: w.projects.map((p) => (p.id === next.id ? next : p)) } : w,
        );
        return next;
      },
      async saveSettings(patch) {
        const current = (await call('workspace.load')).settings;
        const next = await call('settings.save', { ...current, ...patch });
        setWorkspace((w) => (w ? { ...w, settings: next } : w));
        return next;
      },
      async selectProject(id) {
        await call('projects.select', id);
        await refreshWorkspace();
      },
      refreshWorkspace,
      refreshDevices,
      refreshProvider,
      refreshCampaigns,
      setQuestion,
      setAiMessage,
      setRun,
    }),
    [refreshWorkspace, refreshDevices, refreshProvider, refreshCampaigns],
  );

  const state: AppState = {
    workspace,
    settings,
    project,
    projectOs,
    t,
    devices,
    unreachable,
    provider,
    login,
    update,
    campaigns,
    detail,
    run,
    replay,
    aiMessage,
    question,
    recorder,
    menu,
    loading: !workspace,
  };
  return (
    <LanguageProvider language={language}>
      <ToastProvider>
        <StateContext.Provider value={state}>
          <ActionContext.Provider value={actions}>{children}</ActionContext.Provider>
        </StateContext.Provider>
      </ToastProvider>
    </LanguageProvider>
  );
}
