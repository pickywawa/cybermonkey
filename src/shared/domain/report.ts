import type { Locator, OS, ScenarioNode, Variant } from './scenario.js';
import { z } from 'zod';

export type RunStatus =
  'running' | 'passed' | 'failed' | 'skipped' | 'blocked' | 'cancelled' | 'na';
export interface ScreenReference {
  id: string;
  name: string;
  platform: OS;
  identified: boolean;
}
export interface HealingRecord {
  from?: Locator;
  to: Locator;
  reason: string;
  /** Set when the user applied the healed locator to the scenario. */
  applied?: boolean;
}
export interface AnalysisData {
  verdict: 'regression' | 'environment' | 'obsolete-selector' | 'unknown';
  summary: string;
  evidence: string[];
  fix?: string;
}
export interface RunEntry {
  id: string;
  nodeId: string;
  nodeName: string;
  kind?: ScenarioNode['kind'];
  deviceId: string;
  platform: OS;
  status: RunStatus;
  outcome?: RunStatus;
  message: string;
  operationMessage?: string;
  startedAt: string;
  finishedAt?: string;
  completedAt?: string;
  sequence?: number;
  screenBefore?: ScreenReference;
  screenAfter?: ScreenReference;
  screenshot?: string;
  screenshotError?: string;
  analysis?: string;
  analysisData?: AnalysisData;
  analysisState?: 'pending' | 'running' | 'done' | 'off';
  healing?: HealingRecord;
  precondition?: boolean;
  preparation?: boolean;
}
export interface RunReport {
  id: string;
  projectId: string;
  campaignId?: string;
  platforms?: OS[];
  startedAt: string;
  finishedAt?: string;
  status: RunStatus;
  entries: RunEntry[];
  snapshot: ScenarioNode[];
  persistenceError?: string;
}
export const campaignSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string(),
  label: z.string().trim().min(1).max(180),
  createdAt: z.string(),
  updatedAt: z.string(),
  status: z.enum(['open', 'completed']).default('open'),
});
export type Campaign = z.infer<typeof campaignSchema>;
export interface CampaignDetail {
  campaign: Campaign;
  reports: RunReport[];
}
export interface ReplayFrame {
  runId: string;
  entry: RunEntry;
}
export const isTerminal = (s: RunStatus) => s !== 'running';
export type { Variant };
