import { outcomeOf } from '../../shared/domain/campaign.js';
import type { RunEntry, RunReport } from '../../shared/domain/report.js';
import { EXIT } from './args.js';

/** Entries that are results of the tests themselves (not preconditions, scenario headers or interruption handlers). */
export const countable = (e: RunEntry) =>
  !e.precondition && !e.interruption && e.kind !== 'scenario';

export interface Verdict {
  code: number;
  reason: string;
  passed: number;
  failed: number;
  flaky: number;
  notRun: number;
}

/**
 * One number a pipeline can act on. The point is to keep « the app is broken » (1) apart from « the machine is
 * broken » (2): a missing device or an engine error must never be reported as a regression.
 */
export function verdictOf(report: RunReport, cancelled: boolean): Verdict {
  const entries = report.entries.filter(countable);
  const engine = report.entries.find((e) => e.nodeId === 'engine' && e.status === 'failed');
  const missing = report.entries.filter((e) => e.deviceId.startsWith('missing:'));
  const failed = entries.filter((e) => outcomeOf(e) === 'failed' && e.nodeId !== 'engine').length;
  const passed = entries.filter((e) => outcomeOf(e) === 'passed').length;
  const flaky = entries.filter((e) => outcomeOf(e) === 'passed' && e.flaky).length;
  const notRun = entries.filter((e) =>
    ['skipped', 'blocked', 'cancelled'].includes(outcomeOf(e)),
  ).length;
  const base = { passed, failed, flaky, notRun };

  if (cancelled || report.status === 'cancelled')
    return { code: EXIT.CANCELLED, reason: 'Exécution interrompue ou délai dépassé.', ...base };
  if (engine)
    return {
      code: EXIT.USAGE_OR_INFRA,
      reason: `Erreur du moteur : ${engine.message}`,
      ...base,
    };
  if (missing.length)
    return {
      code: EXIT.USAGE_OR_INFRA,
      reason: missing.map((e) => e.message).join(' ; '),
      ...base,
    };
  if (failed > 0)
    return { code: EXIT.TESTS_FAILED, reason: `${failed} étape(s) en échec.`, ...base };
  if (passed === 0)
    return {
      code: EXIT.USAGE_OR_INFRA,
      reason: 'Aucun test n’a réussi ni échoué : rien n’a pu s’exécuter.',
      ...base,
    };
  // Blocked steps with no failure means something prevented a part of the run: do not call it green.
  if (report.status === 'failed')
    return { code: EXIT.TESTS_FAILED, reason: 'L’exécution est en échec.', ...base };
  return { code: EXIT.OK, reason: 'Tous les tests ont réussi.', ...base };
}
