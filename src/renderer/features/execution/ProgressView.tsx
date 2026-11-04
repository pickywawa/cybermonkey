import { campaignProgress, type Progress as P } from '../../../shared/domain/campaign';
import { durationProfile } from '../../../shared/domain/profile';
import { pendingRepairs } from '../../../shared/domain/repairs';
import { stabilityOf, unstableSteps } from '../../../shared/domain/stability';
import { call } from '../../shared/api';
import { Button } from '../../shared/ui/controls';
import { Wand2 } from 'lucide-react';
import { useState } from 'react';
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
  const profile = useMemo(() => durationProfile(detail, 8), [detail]);
  const stability = useMemo(() => stabilityOf([detail]), [detail]);
  const unstable = useMemo(() => unstableSteps(stability).slice(0, 8), [stability]);
  const regressed = useMemo(
    () => stability.filter((s) => s.verdict === 'regression' || s.verdict === 'always-failing'),
    [stability],
  );
  const repairs = useMemo(
    () => (project ? pendingRepairs(detail, project) : []),
    [detail, project],
  );
  const [applying, setApplying] = useState(false);
  const applyAll = async () => {
    if (!project || !detail) return;
    setApplying(true);
    try {
      for (const r of repairs)
        await call('runs.applyHealing', {
          projectId: project.id,
          campaignId: detail.campaign.id,
          runId: r.runId,
          entryId: r.entry.id,
        }).catch(() => undefined);
      await actions.refreshWorkspace();
      await actions.refreshCampaigns();
    } finally {
      setApplying(false);
    }
  };
  const fmt = (ms: number) => (ms >= 1000 ? (ms / 1000).toFixed(1) + ' s' : ms + ' ms');
  const slowest = profile.slowest[0]?.avgMs ?? 1;
  return (
    <div className="progress-view">
      {repairs.length > 0 && (
        <div className="notice" style={{ marginBottom: 10 }}>
          <Wand2 size={15} />
          <div className="grow">
            <div className="title">{t('prog.repairs', { n: repairs.length })}</div>
            <div className="note">{t('prog.repairsHint')}</div>
          </div>
          <Button size="sm" busy={applying} onClick={() => void applyAll()}>
            {t('prog.repairsApply')}
          </Button>
        </div>
      )}
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
      {(unstable.length > 0 || regressed.length > 0) && (
        <>
          <div className="eyebrow" style={{ margin: '14px 0 6px' }}>
            {t('prog.stability')}
          </div>
          {[...regressed, ...unstable].map((s) => (
            <button
              key={s.os + s.nodeId}
              className="scn-row"
              onClick={() => void actions.updateProject({ selectedNodeId: s.nodeId })}
              title={s.text}
            >
              <PlatformIcon os={s.os} size={11} />
              <span className="ellipsis" style={{ width: 220, textAlign: 'left' }}>
                {s.name}
              </span>
              <span className="grow note" style={{ textAlign: 'left' }}>
                {s.recent.map((r) => (r === 'passed' ? '●' : '○')).join(' ')}
              </span>
              <span className="note" style={{ width: 120, textAlign: 'right' }}>
                {t(`prog.v.${s.verdict}` as never)} · {s.passed}/{s.runs}
              </span>
            </button>
          ))}
        </>
      )}
      {profile.slowest.length > 0 && (
        <>
          <div className="eyebrow" style={{ margin: '14px 0 6px' }}>
            {t('prog.slowest')}
          </div>
          <div className="note" style={{ marginBottom: 6 }}>
            {t('prog.slowestLine', {
              steps: profile.steps,
              total: fmt(profile.totalMs),
              share:
                profile.proofShare !== undefined
                  ? Math.round(profile.proofShare * 100) + ' %'
                  : '–',
            })}
          </div>
          {profile.slowest.map((s) => (
            <button
              key={s.os + s.nodeId}
              className="scn-row"
              onClick={() => void actions.updateProject({ selectedNodeId: s.nodeId })}
              title={
                s.performMs !== undefined
                  ? t('prog.slowestSplit', { act: fmt(s.performMs), proof: fmt(s.proofMs ?? 0) })
                  : undefined
              }
            >
              <PlatformIcon os={s.os} size={11} />
              <span className="ellipsis" style={{ width: 220, textAlign: 'left' }}>
                {s.name}
              </span>
              <span className="grow">
                <span
                  className="dur-bar"
                  style={{ width: Math.max(2, Math.round((s.avgMs / slowest) * 100)) + '%' }}
                />
              </span>
              <span className="note" style={{ width: 70, textAlign: 'right' }}>
                {fmt(s.avgMs)}
              </span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}
