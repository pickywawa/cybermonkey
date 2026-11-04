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
export interface InterruptionEvent {
  kind: 'handler' | 'system-alert' | 'app-gone' | 'ai-dismiss' | 'return';
  /** Handler name, alert text, popup description… */
  name: string;
  detail?: string;
  ok: boolean;
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
  /** Screen recording of the scenario this step failed in (kept only for failures), and where the step starts in it (s). */
  video?: string;
  videoAt?: number;
  /** What the device log said around the failure (the app's own lines and system errors), oldest first. */
  deviceLog?: string;
  /** Signs of network trouble found in the log, in plain words. */
  networkHints?: string[];
  /** The step passed only on its second attempt: it works, but not reliably. */
  flaky?: boolean;
  /** The step was attempted twice (it may still have failed). */
  retried?: boolean;
  /** The step was disturbed (popup, expired session, crash…) and what was done about it. */
  interruptions?: InterruptionEvent[];
  /** This entry belongs to the interruption handler of that name, not to the scenario being tested. */
  interruption?: string;
  /** Time spent doing the step itself (locating the component, the gesture, waiting for it), in ms. */
  performMs?: number;
  /** Time spent gathering evidence after the step (inspection, capture), in ms: the cost of the framework, not of the app. */
  proofMs?: number;
  /** Set when the scenario is played once per dataset row: which row this entry belongs to. */
  iteration?: { index: number; total: number; label: string };
}
export interface RunReport {
  id: string;
  projectId: string;
  campaignId?: string;
  /** Environment the run used (its variables were layered over the common ones). */
  environment?: string;
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
