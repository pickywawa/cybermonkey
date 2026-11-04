import { campaignProgress, type Progress as P } from '../../../shared/domain/campaign';
import type { CampaignDetail } from '../../../shared/domain/report';
import { useMemo } from 'react';
import { useT } from '../../shared/i18n';
import { Progress } from '../../shared/ui/controls';
import { PlatformIcon } from '../../shared/ui/icons';
import { useApp } from '../../app/store';
import { useActions } from '../../app/store';

const Bar = ({ p }: { p: P }) => (
  <div className="grow">
    <Progress passed={p.passed} failed={p.failed} total={p.total} />
  </div>
);

/** Where the campaign stands: per OS and per scenario (latest result of each step, retries never inflate it). */
export function ProgressView({ detail }: { detail: CampaignDetail | null }) {
  const t = useT();
  const { project, projectOs } = useApp();
  const actions = useActions();
  const progress = useMemo(
    () => campaignProgress(detail, project!, projectOs),
    [detail, project, projectOs],
  );
  return (
    <div className="progress-view">
      <div className="os-progress">
        {projectOs.map((os) => {
          const p = progress.byOs[os];
          return (
            <div key={os} className="os-card">
              <div className="row">
                <PlatformIcon os={os} size={16} />
                <b className="grow">{os === 'ios' ? 'iOS' : 'Android'}</b>
                <span className="big">{p?.percent ?? 0}%</span>
              </div>
              {p ? <Bar p={p} /> : null}
              <div className="note">
                {t('prog.line', {
                  passed: p?.passed ?? 0,
                  failed: p?.failed ?? 0,
                  pending: p?.pending ?? 0,
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="eyebrow" style={{ margin: '14px 0 6px' }}>
        {t('prog.byScenario')}
      </div>
      {progress.byScenario.map((s) => (
        <button
          key={s.id}
          className="scn-row"
          onClick={() => void actions.updateProject({ selectedNodeId: s.id })}
        >
          <span className="ellipsis" style={{ width: 200, textAlign: 'left' }}>
            {s.name}
          </span>
          <span className="grow" style={{ display: 'grid', gap: 3 }}>
            {projectOs.map((os) =>
              s.byOs[os] ? (
                <span key={os} className="row" style={{ gap: 6 }}>
                  <PlatformIcon os={os} size={10} />
                  <Bar p={s.byOs[os]!} />
                  <span className="note" style={{ width: 54, textAlign: 'right' }}>
                    {s.byOs[os]!.passed + s.byOs[os]!.failed}/{s.byOs[os]!.total}
                  </span>
                </span>
              ) : null,
            )}
          </span>
        </button>
      ))}
      {!progress.byScenario.length && <div className="empty note">{t('prog.none')}</div>}
    </div>
  );
}
