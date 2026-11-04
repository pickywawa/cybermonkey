import { compactScreen, type Screen } from '../../../shared/domain/devices.js';
import { analysisJsonSchema, analysisSchema } from '../../../shared/ai/protocol.js';
import type { AnalysisData, RunEntry, RunReport } from '../../../shared/domain/report.js';
import { flatten } from '../../../shared/domain/scenario.js';
import type { Settings } from '../../../shared/domain/settings.js';
import type { AiHub } from '../../infra/ai/hub.js';
import { askStructured } from '../../infra/ai/provider.js';
import { ANALYSIS_SYSTEM } from '../prompts.js';

export const formatAnalysis = (a: AnalysisData) =>
  `[${a.verdict}] ${a.summary}${a.evidence.length ? '\n- ' + a.evidence.join('\n- ') : ''}${a.fix ? '\nFix: ' + a.fix : ''}`;

export class Analyzer {
  /** Compact screens captured at failure time (live runs only; never persisted). */
  failureScreens = new Map<string, Screen>();
  constructor(
    private hub: AiHub,
    private settings: () => Settings,
  ) {}

  async analyze(entry: RunEntry, report: RunReport): Promise<AnalysisData> {
    const node = flatten(report.snapshot).find((n) => n.id === entry.nodeId);
    const screen = this.failureScreens.get(entry.id);
    const prompt = JSON.stringify({
      language: this.settings().language,
      node: node && {
        name: node.name,
        description: node.description,
        kind: node.kind,
        variant: node.variants[entry.platform],
      },
      platform: entry.platform,
      error: entry.message,
      healingAttempt: entry.healing,
      // What the device itself reported just before the failure, and any sign of network trouble.
      deviceLog: entry.deviceLog,
      networkHints: entry.networkHints,
      previousSteps: report.entries
        .filter((e) => e.deviceId === entry.deviceId)
        .slice(-8)
        .map(({ nodeName, status, message }) => ({ nodeName, status, message })),
      screenAtFailure: screen && compactScreen(screen, 80),
    });
    return this.hub.converse(ANALYSIS_SYSTEM, AbortSignal.timeout(150000), (c) =>
      askStructured(c, prompt, analysisSchema, analysisJsonSchema, { timeoutMs: 120000 }).then(
        (a) => ({ ...a, fix: a.fix ?? undefined }),
      ),
    );
  }
}
