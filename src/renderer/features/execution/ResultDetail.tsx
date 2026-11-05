import {
  Check,
  Film,
  Timer,
  ImageIcon,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
  Wand2,
} from 'lucide-react';
import { useState } from 'react';
import type { ResultRow } from '../../../shared/domain/campaign';
import type { RunEntry } from '../../../shared/domain/report';
import type { StepStability } from '../../../shared/domain/stability';
import type { VisualComparison } from '../../../shared/ipc';
import { call } from '../../shared/api';
import { useT } from '../../shared/i18n';
import { Badge, Button } from '../../shared/ui/controls';
import { osName } from '../../shared/ui/icons';
import { useToast } from '../../shared/ui/overlays';
import { useActions, useApp } from '../../app/store';
import { OsMark } from './OsMark';

const TONE = { passed: 'ok', failed: 'err', blocked: 'warn' } as const;

/**
 * Everything known about the LAST result of an element, per OS: what happened, what the device said, what the AI made
 * of it, and what can be done about it.
 */
export function ResultDetail({
  row,
  stability,
}: {
  row: ResultRow;
  stability: Map<string, StepStability>;
}) {
  const t = useT();
  const { settings } = useApp();
  return (
    <div className="rd">
      {row.oses.map((os) => {
        const r = row.results[os];
        return (
          <section key={os} className="rd-os">
            <header>
              <OsMark os={os} state={row.states[os]!} size={14} language={settings?.language} />
              <b>{osName(os)}</b>
              {r ? (
                <>
                  <Badge tone={TONE[r.outcome as keyof typeof TONE]}>
                    {t(`st.${r.outcome}` as never)}
                  </Badge>
                  {r.entry.flaky && (
                    <span title={t('res.flakyHint')}>
                      <Badge tone="warn">{t('res.flaky')}</Badge>
                    </span>
                  )}
                  <span className="note">{timing(r.entry, settings?.language, t)}</span>
                  <StabilityChip s={stability.get(os + ':' + row.node.id)} />
                  {row.slow[os] && (
                    <Badge tone="warn">
                      <Timer size={11} />{' '}
                      {t('slow.detail', {
                        os: osName(os),
                        now: (row.slow[os]!.ms / 1000).toFixed(1) + ' s',
                        usual: (row.slow[os]!.baselineMs / 1000).toFixed(1) + ' s',
                        x: row.slow[os]!.ratio,
                      })}
                    </Badge>
                  )}
                </>
              ) : (
                <span className="note">{t('exec.notRunOs', { os: osName(os) })}</span>
              )}
            </header>
            {r && <EntryDetail entry={r.entry} runId={r.runId} />}
          </section>
        );
      })}
    </div>
  );
}

function timing(e: RunEntry, language: string | undefined, t: ReturnType<typeof useT>) {
  const at = e.startedAt ? new Date(e.startedAt).toLocaleString(language) : '';
  if (!e.finishedAt) return at;
  const total = ((Date.parse(e.finishedAt) - Date.parse(e.startedAt)) / 1000).toFixed(1);
  const split =
    e.performMs !== undefined && e.proofMs !== undefined
      ? ' ' +
        t('exec.split', {
          act: (e.performMs / 1000).toFixed(1),
          proof: (e.proofMs / 1000).toFixed(1),
        })
      : '';
  return `${at} · ${total} s${split}`;
}

function StabilityChip({ s }: { s: StepStability | undefined }) {
  const t = useT();
  if (!s || s.runs < 2) return null;
  return (
    <span className="note" title={s.text}>
      · {t('exec.stability', { passed: s.passed, runs: s.runs })}{' '}
      {s.verdict !== 'stable' && s.verdict !== 'new' && (
        <Badge tone={s.verdict === 'regression' || s.verdict === 'always-failing' ? 'err' : 'warn'}>
          {t(`prog.v.${s.verdict}` as never)}
        </Badge>
      )}
    </span>
  );
}

function EntryDetail({ entry: e, runId }: { entry: RunEntry; runId: string }) {
  const t = useT();
  const toast = useToast();
  const { project } = useApp();
  const actions = useActions();
  const apply = async () => {
    if (!project?.activeCampaignId) return;
    try {
      await call('runs.applyHealing', {
        projectId: project.id,
        campaignId: project.activeCampaignId,
        runId,
        entryId: e.id,
      });
      await actions.refreshWorkspace();
      toast(t('res.applied'), 'ok');
    } catch (err) {
      toast(String((err as Error).message), 'err');
    }
  };
  return (
    <div className="stack" style={{ gap: 6 }}>
      {(e.operationMessage ?? e.message) && (
        <div style={{ whiteSpace: 'pre-wrap' }}>{e.operationMessage ?? e.message}</div>
      )}
      <div className="row note" style={{ gap: 10 }}>
        {e.screenshot ? (
          <span title={t('res.hasCapture')}>
            <ImageIcon size={13} /> {t('exec.shownOnDevice')}
          </span>
        ) : (
          e.screenshotError && <span>{t('res.noCapture')}</span>
        )}
        {e.interruption && (
          <Badge tone="warn">{t('res.handlerTag', { name: e.interruption })}</Badge>
        )}
      </div>
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
      {e.video && <VideoPlayer entry={e} runId={runId} />}
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
          <pre style={{ maxHeight: 220, overflow: 'auto', fontSize: 11 }}>{e.deviceLog}</pre>
        </details>
      )}
      {e.status === 'failed' && e.screenshot && <VisualCompare entry={e} runId={runId} />}
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
            <Button size="sm" onClick={() => void apply()}>
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
              onClick={() => void call('runs.analyze', { runId, entryId: e.id })}
            >
              {t('res.analyze')}
            </Button>
          </div>
        ))}
    </div>
  );
}

/** Last passing capture of this step next to the failing one, with what changed outlined. */
function VisualCompare({ entry, runId }: { entry: RunEntry; runId: string }) {
  const t = useT();
  const { project } = useApp();
  const [state, setState] = useState<'idle' | 'busy' | 'none' | VisualComparison>('idle');
  if (!project) return null;
  const run = async () => {
    setState('busy');
    try {
      setState(
        (await call('runs.compare', { projectId: project.id, runId, entryId: entry.id })) ?? 'none',
      );
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
