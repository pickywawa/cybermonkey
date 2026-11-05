import type { AccessibilityIssue, AuditedScreen, CampaignDetail } from './report.js';

export interface ScreenAudit extends AuditedScreen {
  errors: number;
  warnings: number;
}
export interface AccessibilitySummary {
  /** Screens audited, worst first (most errors, then warnings, then name). */
  screens: ScreenAudit[];
  errors: number;
  warnings: number;
  /** Screens audited and found without a single problem. */
  clean: number;
}
export const RULES = ['missing-label', 'technical-label', 'small-target'] as const;

const count = (issues: AccessibilityIssue[], severity: AccessibilityIssue['severity']) =>
  issues.filter((i) => i.severity === severity).length;

/**
 * What the campaign knows about accessibility: for every screen and OS, the audit of the LAST run that looked at it
 * (an old problem that was fixed disappears with the next run, like every other result).
 */
export function accessibilityOf(detail: CampaignDetail | null): AccessibilitySummary {
  const latest = new Map<string, AuditedScreen>();
  for (const report of [...(detail?.reports ?? [])].sort((a, b) =>
    a.startedAt.localeCompare(b.startedAt),
  ))
    for (const audit of report.accessibility ?? [])
      latest.set(audit.os + ':' + audit.screenId, audit);
  const screens = [...latest.values()]
    .map((a) => ({ ...a, errors: count(a.issues, 'error'), warnings: count(a.issues, 'warning') }))
    .sort(
      (a, b) =>
        b.errors - a.errors ||
        b.warnings - a.warnings ||
        a.screenName.localeCompare(b.screenName) ||
        a.os.localeCompare(b.os),
    );
  return {
    screens,
    errors: screens.reduce((n, s) => n + s.errors, 0),
    warnings: screens.reduce((n, s) => n + s.warnings, 0),
    clean: screens.filter((s) => !s.issues.length).length,
  };
}
