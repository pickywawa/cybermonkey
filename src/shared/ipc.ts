import type { Device, DeviceHealth, DeviceScan, Screen } from './domain/devices.js';
import type { AppInfo, Project, ProjectInput, ProjectUpdate } from './domain/project.js';
import type { Campaign, CampaignDetail, ReplayFrame, RunReport } from './domain/report.js';
import type { LoginProgress, Provider, ProviderStatus, Settings } from './domain/settings.js';
import type { Variant, ScenarioNode, OS, NodeKind } from './domain/scenario.js';
import type { ExportFormat } from './domain/campaign-export.js';
import type { RecordedStep } from './domain/recording.js';
import type { UpdateStatus } from './update.js';

export interface Workspace {
  settings: Settings;
  projects: Project[];
  activeProjectId: string | null;
}
export interface ReplayResult {
  platform: OS;
  status: 'passed' | 'failed' | 'blocked' | 'skipped';
  message: string;
}
/** What the AI creation agent hands back for human review before anything is saved. */
export interface CreationReply {
  text: string;
  proposal?: ScenarioNode[];
  parentId?: string;
  baseRevision: number;
  replay: ReplayResult[];
  /** Automatic corrections and dropped steps, shown in the review dialog. */
  warnings: string[];
  /** Per-OS exploration coverage. */
  coverage: { os: OS; status: 'explored' | 'missing'; note: string }[];
  /** 'draft' = rebuilt from the executed trace because the AI could not produce a valid proposal. */
  quality: 'validated' | 'repaired' | 'draft';
}
export type RunRequest = {
  projectId: string;
  campaignId?: string;
  /** Operating systems to run; defaults to the project's active focus. */
  platforms?: OS[];
  nodeId?: string;
  deviceIds: string[];
  resetCampaign?: boolean;
};

/** channel → [input, output]. Add a line here + one handler in main/ipc to expose a feature. */
export interface Contract {
  'workspace.load': [void, Workspace];
  'settings.save': [Settings, Settings];

  'projects.create': [ProjectInput, Project];
  'projects.update': [ProjectUpdate, Project];
  'projects.select': [string, void];
  'projects.remove': [string, void];
  'projects.reveal': [string, void];
  'projects.chooseDirectory': [void, string | null];
  'projects.importLegacy': [void, Project | null];
  'projects.applicationInfo': [
    { projectId?: string; deviceId?: string; platform: OS; application: string },
    AppInfo,
  ];
  'projects.applications': [
    { projectId?: string; deviceId?: string; platform: OS; mode: 'current' | 'list' | 'all' },
    AppInfo[],
  ];

  'devices.scan': [void, DeviceScan];
  'devices.health': [string, DeviceHealth];
  'devices.reconnect': [string, void];
  'devices.screenshot': [string, string];
  'devices.inspect': [string, Screen];
  'devices.perform': [
    { deviceId: string; projectId?: string; variant: Variant; kind: NodeKind },
    void,
  ];
  'devices.openWda': [string, void];
  'devices.openDoc': [
    'provisioning' | 'windows' | 'tunnels' | 'preinstalled' | 'adb' | 'xcode',
    void,
  ];
  'devices.detach': [boolean, void];
  'devices.aiDiagnose': [string, string];

  'ai.status': [Provider, ProviderStatus];
  'ai.login': [Provider, void];
  'ai.logout': [Provider, void];
  'ai.detach': [boolean, void];

  'creation.ask': [
    { projectId: string; prompt: string; sessionId?: string; nodeId?: string; deviceIds: string[] },
    CreationReply,
  ];
  'creation.answer': [{ projectId: string; questionId: string; answer: string }, void];
  'creation.cancel': [string, void];

  'campaigns.list': [string, Campaign[]];
  'campaigns.create': [{ projectId: string; label?: string }, Campaign];
  'campaigns.load': [{ projectId: string; campaignId: string }, CampaignDetail];
  'campaigns.update': [
    { projectId: string; campaignId: string; label?: string; status?: Campaign['status'] },
    Campaign,
  ];
  'campaigns.clean': [{ projectId: string; campaignId?: string }, void];
  'campaigns.export': [{ projectId: string; campaignId: string; format: ExportFormat }, string];

  'runs.start': [RunRequest, RunReport];
  'runs.cancel': [void, void];
  'runs.current': [string, RunReport | null];
  'runs.analyze': [{ runId: string; entryId: string }, void];
  'runs.screenshot': [
    { projectId: string; campaignId?: string; runId: string; entryId: string },
    string | null,
  ];
  'runs.applyHealing': [
    { projectId: string; campaignId: string; runId: string; entryId: string },
    Project,
  ];
  'replay.current': [string, ReplayFrame | null];
  'replay.select': [{ projectId: string; frame: ReplayFrame | null }, void];

  'workbench.pick': [unknown, void];

  'recorder.start': [{ projectId: string; deviceId: string; withAssertions: boolean }, void];
  'recorder.stop': [string, RecordedStep[]];
  'recorder.status': [string, { running: boolean; steps: RecordedStep[] }];
  'recorder.discard': [{ projectId: string; stepId: string }, void];

  'imports.pickFile': [void, { name: string; content: string } | null];

  'updates.status': [void, UpdateStatus];
  'updates.check': [void, UpdateStatus];
  'updates.download': [void, UpdateStatus];
  'updates.install': [void, void];
  'updates.release': [void, void];
}
export type Channel = keyof Contract;
export type Input<C extends Channel> = Contract[C][0];
export type Output<C extends Channel> = Contract[C][1];

export type MenuAction = 'new-project' | 'edit-project' | 'import-legacy' | 'open-settings';
export type LiveEvent =
  | { type: 'update'; status: UpdateStatus }
  | { type: 'device'; deviceId: string; ready: boolean }
  | { type: 'devices'; scan: DeviceScan }
  | { type: 'run'; report: RunReport }
  | { type: 'pointer'; deviceId: string; x: number; y: number; width: number; height: number }
  | { type: 'ai'; projectId: string; message: string }
  | {
      type: 'ai-question';
      projectId: string;
      questionId: string;
      question: string;
      variableName?: string;
    }
  | { type: 'login'; progress: LoginProgress }
  | { type: 'replay'; projectId: string; frame: ReplayFrame | null }
  | { type: 'recorder'; projectId: string; steps: RecordedStep[]; running: boolean }
  | { type: 'menu'; action: MenuAction }
  | { type: 'pick'; picked: unknown }
  | { type: 'workspace' };

export interface Bridge {
  call<C extends Channel>(channel: C, input: Input<C>): Promise<Output<C>>;
  onEvent(callback: (event: LiveEvent) => void): () => void;
}
declare global {
  interface Window {
    cybermonkey?: Bridge;
  }
}
export type { Device };
