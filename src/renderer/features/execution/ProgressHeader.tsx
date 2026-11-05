import type { CampaignResults } from '../../../shared/domain/campaign';
import { useT } from '../../shared/i18n';
import { Progress } from '../../shared/ui/controls';
import { PlatformIcon, osName } from '../../shared/ui/icons';
import { useApp } from '../../app/store';

/**
 * Where the campaign stands, in elements, by the LAST result of each: how many work, how many fail, how many were
 * never looked at. Per OS of the project, whatever OS is ticked in the title bar.
 */
export function ProgressHeader({ results }: { results: CampaignResults }) {
  const t = useT();
  const { project } = useApp();
  const { totals, byOs } = results;
  return (
    <section className="progress-head" aria-label={t('exec.progress')}>
      <div className="ph-main">
        <div className="ph-rate" title={t('exec.rateHint')}>
          <b>{totals.rate}</b>
          <span>%</span>
          <small>{t('exec.rate')}</small>
        </div>
        <div className="ph-bar">
          <Progress passed={totals.passed} failed={totals.failed} total={totals.total} />
          <div className="ph-counts">
            <span className="ok">
              <i /> {t('exec.passed', { n: totals.passed })}
            </span>
            <span className="bad">
              <i /> {t('exec.failed', { n: totals.failed })}
            </span>
            <span>
              <i /> {t('exec.remaining', { n: totals.remaining })}
            </span>
            <span className="note">· {t('exec.elements', { n: totals.total })}</span>
          </div>
        </div>
      </div>
      <div className="ph-os">
        {project?.platforms.map((os) => {
          const p = byOs[os];
          if (!p) return null;
          return (
            <div key={os} className="ph-os-item" title={t('exec.osHint', { os: osName(os) })}>
              <PlatformIcon os={os} size={14} plain />
              <b>{osName(os)}</b>
              <div className="grow">
                <Progress passed={p.passed} failed={p.failed} total={p.total} />
              </div>
              <span className="rate">{p.rate} %</span>
              <span className="note">
                {p.passed}/{p.total}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
