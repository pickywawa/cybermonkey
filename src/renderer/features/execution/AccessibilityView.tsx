import { Accessibility, CircleAlert, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { accessibilityOf, type ScreenAudit } from '../../../shared/domain/accessibility';
import type { AccessibilityIssue, CampaignDetail } from '../../../shared/domain/report';
import { useT } from '../../shared/i18n';
import { Badge } from '../../shared/ui/controls';
import { PlatformIcon, osName } from '../../shared/ui/icons';
import { useApp } from '../../app/store';
import { FilterMenu } from './FilterMenu';
import { useExec } from './focus';

const FILTERS = ['error', 'warning', 'clean'] as const;

/**
 * Accessibility problems found on the screens the campaign went through: what a screen reader could not name, what is
 * too small to touch. One entry per screen and OS, from the last run that looked at it.
 */
export function AccessibilityView({ detail }: { detail: CampaignDetail | null }) {
  const t = useT();
  const { settings } = useApp();
  const summary = useMemo(() => accessibilityOf(detail), [detail]);
  const [filters, setFilters] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const exec = useExec();
  const shown = summary.screens.filter(
    (s) =>
      !filters.size ||
      (filters.has('error') && s.errors > 0) ||
      (filters.has('warning') && s.warnings > 0) ||
      (filters.has('clean') && !s.issues.length),
  );
  const key = (s: ScreenAudit) => s.os + ':' + s.screenId;

  if (!summary.screens.length)
    return (
      <div className="empty a11y-empty">
        <Accessibility size={26} />
        <b>{t('a11y.none')}</b>
        <span className="note">
          {settings?.accessibilityAudit === false ? t('a11y.off') : t('a11y.noneHint')}
        </span>
      </div>
    );
  return (
    <div className="a11y">
      <div className="list-tools">
        <div className="a11y-totals">
          <Badge tone={summary.errors ? 'err' : 'ok'}>
            <CircleAlert size={11} /> {t('a11y.errors', { n: summary.errors })}
          </Badge>
          <Badge tone={summary.warnings ? 'warn' : undefined}>
            <TriangleAlert size={11} /> {t('a11y.warnings', { n: summary.warnings })}
          </Badge>
          <span className="note">
            {t('a11y.screens', { n: summary.screens.length, clean: summary.clean })}
          </span>
        </div>
        <span className="grow" />
        <FilterMenu
          selected={filters}
          onChange={setFilters}
          options={FILTERS.map((f) => ({
            value: f,
            label: t(`a11y.f.${f}` as never),
            count:
              f === 'error'
                ? summary.screens.filter((s) => s.errors).length
                : f === 'warning'
                  ? summary.screens.filter((s) => s.warnings).length
                  : summary.clean,
          }))}
        />
      </div>
      <p className="note a11y-scope">{t('a11y.scope')}</p>
      {shown.map((s) => {
        const isOpen =
          open.has(key(s)) || (s.issues.length > 0 && open.size === 0 && shown.length <= 4);
        return (
          <section
            key={key(s)}
            className={`a11y-screen ${s.errors ? 'bad' : s.warnings ? 'warn' : 'ok'}`}
          >
            <header
              onClick={() =>
                setOpen((o) => {
                  const n = new Set(o);
                  n.has(key(s)) ? n.delete(key(s)) : n.add(key(s));
                  return n;
                })
              }
            >
              <PlatformIcon os={s.os} size={13} plain />
              <b className="ellipsis">{s.screenName}</b>
              <span className="grow" />
              {s.issues.length === 0 ? (
                <Badge tone="ok">
                  <ShieldCheck size={11} /> {t('a11y.clean')}
                </Badge>
              ) : (
                <>
                  {s.errors > 0 && <Badge tone="err">{s.errors}</Badge>}
                  {s.warnings > 0 && <Badge tone="warn">{s.warnings}</Badge>}
                </>
              )}
            </header>
            {isOpen && s.issues.length > 0 && (
              <ul className="a11y-issues">
                {s.issues.map((i, n) => (
                  <li key={n} className={i.severity}>
                    {i.severity === 'error' ? (
                      <CircleAlert size={14} />
                    ) : (
                      <TriangleAlert size={14} />
                    )}
                    <div className="grow">
                      <div>{ruleText(i, t)}</div>
                      <div className="note">
                        {i.component}
                        {i.label ? ` « ${i.label} »` : ''}
                        {i.size
                          ? ` · ${i.size.width}×${i.size.height} ${s.os === 'ios' ? 'pt' : 'dp'}`
                          : ''}
                        {s.nodeName ? ` · ${t('a11y.during', { step: s.nodeName })}` : ''}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {isOpen && s.issues.length > 0 && (
              <div className="note a11y-foot">
                {osName(s.os)} · {new Date(s.at).toLocaleString(settings?.language)}
                {s.nodeId && (
                  <button
                    className="link"
                    onClick={() => {
                      exec.setView('results');
                      exec.reveal(s.nodeId!, 'results');
                    }}
                  >
                    {t('a11y.showStep')}
                  </button>
                )}
              </div>
            )}
          </section>
        );
      })}
      {!shown.length && <div className="empty note">{t('res.none')}</div>}
    </div>
  );
}

function ruleText(i: AccessibilityIssue, t: ReturnType<typeof useT>) {
  return t(`a11y.rule.${i.rule}` as never);
}
