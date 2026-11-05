import type { ProviderStatus } from '../../../shared/domain/settings';
import { useT } from '../../shared/i18n';
import { useApp } from '../../app/store';

/** 1 234 → « 1,2 k », 3 400 000 → « 3,4 M ». */
export function formatTokens(n: number, language?: string): string {
  const fmt = (v: number, unit: string) =>
    v.toLocaleString(language, { maximumFractionDigits: v < 10 ? 1 : 0 }) + ' ' + unit;
  if (n >= 1_000_000) return fmt(n / 1_000_000, 'M');
  if (n >= 1000) return fmt(n / 1000, 'k');
  return String(n);
}

/**
 * What the AI has used: how much of each plan window is gone (5 hours, 7 days…) and how many tokens Cybermonkey sent,
 * today, this week and in all. Windows come from the provider; token counts are ours.
 */
export function UsageMeter({ status }: { status: ProviderStatus | null | undefined }) {
  const t = useT();
  const { settings } = useApp();
  if (!status) return null;
  const language = settings?.language;
  const { limits, usage } = status;
  if (!limits?.length && !usage) return null;
  const sum = (c: { input: number; output: number }) => formatTokens(c.input + c.output, language);
  return (
    <div className="usage-meter">
      {limits?.map((l) => (
        <div
          key={l.id}
          className="usage-row"
          title={l.resetsAt ? resetText(l.resetsAt, t, language) : ''}
        >
          <span className="usage-label">{l.label}</span>
          <div className="usage-bar">
            <i
              className={l.usedPercent >= 90 ? 'bad' : l.usedPercent >= 70 ? 'warn' : ''}
              style={{ width: `${l.usedPercent}%` }}
            />
          </div>
          <span className="usage-pct">{Math.round(l.usedPercent)} %</span>
          <span className="note usage-left">
            {t('ai.usage.left', { n: Math.max(0, Math.round(100 - l.usedPercent)) })}
          </span>
        </div>
      ))}
      {usage && (
        <div className="note usage-tokens">
          {t('ai.usage.tokens', {
            today: sum(usage.today),
            week: sum(usage.week),
            total: sum(usage.total),
          })}
        </div>
      )}
    </div>
  );
}

function resetText(iso: string, t: ReturnType<typeof useT>, language?: string) {
  const at = new Date(iso);
  return t('ai.usage.reset', {
    at: at.toLocaleString(language, { weekday: 'short', hour: '2-digit', minute: '2-digit' }),
  });
}
