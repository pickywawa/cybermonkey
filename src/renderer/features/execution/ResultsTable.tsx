import {
  Check,
  ChevronDown,
  ChevronRight,
  Film,
  ShieldAlert,
  ImageIcon,
  Sparkles,
  TriangleAlert,
  Wand2,
  Search,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { outcomeOf } from '../../../shared/domain/campaign';
import type { ReplayFrame, RunEntry, RunReport, RunStatus } from '../../../shared/domain/report';
import type { VisualComparison } from '../../../shared/ipc';
import { call } from '../../shared/api';
import { useT } from '../../shared/i18n';
import { Badge, Button } from '../../shared/ui/controls';
import { PlatformIcon } from '../../shared/ui/icons';
import { useToast } from '../../shared/ui/overlays';
import { useActions, useApp } from '../../app/store';

const TONE: Partial<Record<RunStatus, 'ok' | 'err' | 'warn'>> = {
  passed: 'ok',
  failed: 'err',
  blocked: 'warn',
};
const FILTERS = ['all', 'failed', 'passed', 'skipped', 'healed', 'flaky'] as const;

export function ResultsTable({ report }: { report: RunReport }) {
  const t = useT();
  const toast = useToast();
  const { project, replay, settings } = useApp();
  const actions = useActions();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const rows = useMemo(
    () =>
      report.entries.filter(
        (e) =>
          (e.kind !== 'scenario' && !e.precondition && e.nodeId !== 'engine') ||
          e.nodeId === 'engine',
      ),
    [report],
  );
  const shown = rows.filter((e) => {
    const o = outcomeOf(e);
    if (filter === 'failed' && o !== 'failed' && o !== 'blocked') return false;
    if (filter === 'passed' && o !== 'passed') return false;
    if (filter === 'skipped' && o !== 'skipped' && o !== 'na') return false;
    if (filter === 'healed' && !e.healing) return false;
    if (filter === 'flaky' && !e.flaky) return false;
    const q = query.trim().toLowerCase();
    return (
      !q ||
      e.nodeName.toLowerCase().includes(q) ||
      (e.screenAfter?.name ?? '').toLowerCase().includes(q) ||
      e.message.toLowerCase().includes(q)
    );
  });
  const select = (e: RunEntry) => {
    if (project && e.completedAt)
      void call('replay.select', {
        projectId: project.id,
        frame: { runId: report.id, entry: e } as ReplayFrame,
      });
  };
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const apply = async (e: RunEntry) => {
    if (!project?.activeCampaignId) return;
    try {
      await call('runs.applyHealing', {
        projectId: project.id,
        campaignId: project.activeCampaignId,
        runId: report.id,
        entryId: e.id,
      });
      await actions.refreshWorkspace();
      toast(t('res.applied'), 'ok');
    } catch (err) {
      toast(String((err as Error).message), 'err');
    }
  };
  return (
    <div className="results">
      <div className="row wrap" style={{ padding: '8px 0' }}>
        <div className="search grow">
          <Search size={13} />
          <input
            placeholder={t('res.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          style={{ width: 170 }}
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
        >
          {FILTERS.map((f) => (
            <option key={f} value={f}>
              {t(`res.f.${f}` as never)}
            </option>
          ))}
        </select>
        <span className="note">
          {shown.length} / {rows.length}
        </span>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th style={{ width: 36 }}>OS</th>
            <th>{t('res.step')}</th>
            <th>{t('res.screen')}</th>
            <th style={{ width: 100 }}>{t('res.result')}</th>
            <th style={{ width: 60 }}>{t('res.duration')}</th>
            <th style={{ width: 62 }} />
          </tr>
        </thead>
        <tbody>
          {shown.map((e) => {
            const o = outcomeOf(e);
            const isOpen = open.has(e.id);
            return (
              <FragmentRows key={e.id}>
                <tr
                  className={`res-row ${replay?.entry.id === e.id ? 'sel' : ''}`}
                  onClick={() => select(e)}
                >
                  <td>
                    <PlatformIcon os={e.platform} />
                  </td>
                  <td>
                    <div className="ellipsis" style={{ maxWidth: 320 }} title={e.nodeName}>
                      {e.nodeName}
                    </div>
                    <div className="note">
                      {e.interruption && (
                        <Badge tone="warn">{t('res.handlerTag', { name: e.interruption })}</Badge>
                      )}{' '}
                      {e.startedAt && new Date(e.startedAt).toLocaleTimeString(settings?.language)}
                    </div>
                  </td>
                  <td className="ellipsis" style={{ maxWidth: 160 }}>
                    {e.screenAfter?.name ?? e.screenBefore?.name ?? ''}
                  </td>
                  <td>
                    <Badge tone={TONE[o]}>{t(`st.${o}` as never)}</Badge>
                    {e.healing && (
                      <span title={t('res.healed')}>
                        {' '}
                        <Wand2 size={12} color="var(--accent)" />
                      </span>
                    )}
                    {e.flaky && (
                      <span title={t('res.flakyHint')}>
                        {' '}
                        <Badge tone="warn">{t('res.flaky')}</Badge>
                      </span>
                    )}
                  </td>
                  <td className="note">
                    {e.finishedAt
                      ? ((Date.parse(e.finishedAt) - Date.parse(e.startedAt)) / 1000).toFixed(1) +
                        ' s'
                      : ''}
                  </td>
                  <td onClick={(ev) => ev.stopPropagation()} className="row" style={{ gap: 0 }}>
                    {e.screenshot && (
                      <span title={t('res.hasCapture')}>
                        <ImageIcon size={14} color="var(--dim)" />
                      </span>
                    )}
                    <button className="icon-btn" onClick={() => toggle(e.id)}>
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                  </td>
                </tr>
                {isOpen && (
                  <tr className="detail">
                    <td colSpan={6}>
                      <div className="stack" style={{ gap: 6 }}>
                        <div style={{ whiteSpace: 'pre-wrap' }}>
                          {e.operationMessage ?? e.message}
                        </div>
                        {e.screenshotError && <div className="note">{t('res.noCapture')}</div>}
                        {e.interruptions && e.interruptions.length > 0 && (
                          <div className="notice">
                            <ShieldAlert size={15} />
                            <div className="grow">
                              <div className="title">{t('res.interrupted')}</div>
                              <ul className="note" style={{ margin: '4px 0 0 16px' }}>
                                {e.interruptions.map((i, k) => (
                                  <li key={k}>
                                    {i.ok ? '✓' : '✗'} {t(`res.int.${i.kind}` as never)} — {i.name}
                                    {i.detail ? ` (${i.detail})` : ''}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        )}
                        {e.video && <VideoPlayer entry={e} runId={report.id} />}
                        {e.networkHints && e.networkHints.length > 0 && (
                          <div className="notice warn">
                            <TriangleAlert size={15} />
                            <div className="grow">
                              <div className="title">{t('res.network')}</div>
                              <div className="note">{e.networkHints.join(' · ')}</div>
                            </div>
                          </div>
                        )}
                        {e.deviceLog && (
                          <details>
                            <summary className="note" style={{ cursor: 'pointer' }}>
                              {t('res.deviceLog')}
                            </summary>
                            <pre style={{ maxHeight: 220, overflow: 'auto', fontSize: 11 }}>
                              {e.deviceLog}
                            </pre>
                          </details>
                        )}
                        {e.status === 'failed' && e.screenshot && (
                          <VisualCompare entry={e} runId={report.id} />
                        )}
                        {e.healing && (
                          <div className="notice">
                            <Wand2 size={15} />
                            <div className="grow">
                              <div className="title">{t('res.healed')}</div>
                              <div className="note mono">
                                {e.healing.from?.value ?? '?'} → {e.healing.to.value}
                              </div>
                              <div className="note">{e.healing.reason}</div>
                            </div>
                            {e.healing.applied ? (
                              <Badge tone="ok">
                                <Check size={11} /> {t('res.appliedBadge')}
                              </Badge>
                            ) : (
                              <Button size="sm" onClick={() => void apply(e)}>
                                {t('res.apply')}
                              </Button>
                            )}
                          </div>
                        )}
                        {e.status === 'failed' &&
                          (e.analysisData ? (
                            <div className="notice">
                              <Sparkles size={15} />
                              <div className="grow">
                                <div className="title">
                                  <Badge
                                    tone={
                                      e.analysisData.verdict === 'regression'
                                        ? 'err'
                                        : e.analysisData.verdict === 'unknown'
                                          ? undefined
                                          : 'warn'
                                    }
                                  >
                                    {t(`res.v.${e.analysisData.verdict}` as never)}
                                  </Badge>{' '}
                                  {e.analysisData.summary}
                                </div>
                                {e.analysisData.evidence.length > 0 && (
                                  <ul className="note" style={{ margin: '4px 0 0 16px' }}>
                                    {e.analysisData.evidence.map((x, i) => (
                                      <li key={i}>{x}</li>
                                    ))}
                                  </ul>
                                )}
                                {e.analysisData.fix && (
                                  <div className="note" style={{ marginTop: 4 }}>
                                    <b>{t('res.fix')}</b> {e.analysisData.fix}
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : e.analysis ? (
                            <pre>{e.analysis}</pre>
                          ) : (
                            <div>
                              <Button
                                size="sm"
                                icon={<Sparkles size={12} />}
                                busy={e.analysisState === 'running'}
                                disabled={e.analysisState === 'off'}
                                onClick={() =>
                                  void call('runs.analyze', { runId: report.id, entryId: e.id })
                                }
                              >
                                {t('res.analyze')}
                              </Button>
                            </div>
                          ))}
                      </div>
                    </td>
                  </tr>
                )}
              </FragmentRows>
            );
          })}
        </tbody>
      </table>
      {!shown.length && <div className="empty note">{t('res.none')}</div>}
    </div>
  );
}
const FragmentRows = ({ children }: { children: React.ReactNode }) => <>{children}</>;

/** Last passing capture of this step next to the failing one, with what changed outlined. */
function VisualCompare({ entry, runId }: { entry: RunEntry; runId: string }) {
  const t = useT();
  const { project } = useApp();
  const [state, setState] = useState<'idle' | 'busy' | 'none' | VisualComparison>('idle');
  if (!project) return null;
  const run = async () => {
    setState('busy');
    try {
      const r = await call('runs.compare', { projectId: project.id, runId, entryId: entry.id });
      setState(r ?? 'none');
    } catch {
      setState('none');
    }
  };
  if (state === 'idle' || state === 'busy')
    return (
      <div>
        <Button
          size="sm"
          icon={<ImageIcon size={12} />}
          busy={state === 'busy'}
          onClick={() => void run()}
        >
          {t('res.compare')}
        </Button>
      </div>
    );
  if (state === 'none') return <div className="note">{t('res.compareNone')}</div>;
  if (!state.comparable) return <div className="note">{state.reason}</div>;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="note">
        {t('res.compareLine', {
          pct: state.changedPercent,
          at: new Date(state.baselineAt).toLocaleString(),
        })}
        {state.regions.length > 0 &&
          ' · ' +
            state.regions
              .slice(0, 4)
              .map((r) => r.where)
              .join(', ')}
      </div>
      <div className="compare-grid">
        <figure>
          <img src={state.baseline} alt="" />
          <figcaption className="note">{t('res.compareBefore')}</figcaption>
        </figure>
        <figure>
          <img src={state.diff ?? state.current} alt="" />
          <figcaption className="note">{t('res.compareNow')}</figcaption>
        </figure>
      </div>
    </div>
  );
}

/** The screen recording of the scenario this step failed in, opened a few seconds before the step. */
function VideoPlayer({ entry, runId }: { entry: RunEntry; runId: string }) {
  const t = useT();
  const { project } = useApp();
  const [src, setSrc] = useState<string | null | 'busy'>(null);
  if (!project) return null;
  const load = async () => {
    setSrc('busy');
    try {
      setSrc(
        (await call('runs.video', { projectId: project.id, runId, entryId: entry.id })) ?? null,
      );
    } catch {
      setSrc(null);
    }
  };
  if (src === null || src === 'busy')
    return (
      <div className="row" style={{ gap: 8 }}>
        <Button
          size="sm"
          busy={src === 'busy'}
          icon={<Film size={12} />}
          onClick={() => void load()}
        >
          {t('res.video')}
        </Button>
        {src === null && (
          <span className="note">{t('res.videoHint', { s: entry.videoAt ?? 0 })}</span>
        )}
      </div>
    );
  return (
    <video
      src={src}
      controls
      style={{ maxWidth: 260, borderRadius: 8, border: '1px solid var(--line)' }}
      onLoadedMetadata={(ev) => {
        ev.currentTarget.currentTime = Math.max(0, (entry.videoAt ?? 0) - 3);
      }}
    />
  );
}
