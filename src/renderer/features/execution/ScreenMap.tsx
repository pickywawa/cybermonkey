import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildScreenGraph,
  layoutGraph,
  outcomeOf,
  type GraphScreen,
} from '../../../shared/domain/campaign';
import type { CampaignDetail } from '../../../shared/domain/report';
import { OS_LIST } from '../../../shared/domain/scenario';
import { call } from '../../shared/api';
import { useT } from '../../shared/i18n';
import { Check } from '../../shared/ui/controls';
import { Modal } from '../../shared/ui/overlays';
import { PlatformIcon } from '../../shared/ui/icons';
import { useApp } from '../../app/store';

const STATUS_COLOR = {
  passed: 'var(--ok)',
  failed: 'var(--danger)',
  partial: 'var(--warn)',
  untested: 'var(--line)',
} as const;

/** Screens as cards (thumbnail, per-OS results) linked by observed and planned transitions. */
export function ScreenMap({ detail }: { detail: CampaignDetail }) {
  const t = useT();
  const { project, projectOs } = useApp();
  const [unidentified, setUnidentified] = useState(false);
  const [only, setOnly] = useState<'all' | 'failed' | 'untested'>('all');
  const [open, setOpen] = useState<GraphScreen | null>(null);
  const graph = useMemo(
    () => buildScreenGraph(detail, project!, projectOs, { includeUnidentified: unidentified }),
    [detail, project, projectOs, unidentified],
  );
  const screens = graph.screens.filter(
    (s) => only === 'all' || s.status === only || (only === 'failed' && s.status === 'failed'),
  );
  const layout = useMemo(() => layoutGraph(screens, graph.edges), [screens, graph.edges]);
  const total = graph.screens.length,
    tested = graph.screens.filter((s) => s.status !== 'untested').length;
  // Fit the graph to the available width (never enlarge): the whole map stays readable without horizontal scrolling.
  const holder = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  useEffect(() => {
    const node = holder.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setAvailable(node.clientWidth));
    observer.observe(node);
    setAvailable(node.clientWidth);
    return () => observer.disconnect();
  }, [graph.screens.length]);
  const scale =
    available > 0 && layout.width + 32 > available
      ? Math.max(0.45, (available - 32) / layout.width)
      : 1;
  if (!graph.screens.length) return <div className="empty">{t('map.empty')}</div>;
  const { cell } = layout;
  const pos = (id: string) => layout.positions.get(id);
  return (
    <div className="screen-map">
      <div className="row wrap" style={{ padding: '8px 0' }}>
        <span className="note grow">{t('map.summary', { tested, total })}</span>
        <div className="legend">
          {(['passed', 'failed', 'partial', 'untested'] as const).map((k) => (
            <span key={k}>
              <i style={{ background: STATUS_COLOR[k] }} />
              {t(`map.${k}` as never)}
            </span>
          ))}
        </div>
        <select
          style={{ width: 150 }}
          value={only}
          onChange={(e) => setOnly(e.target.value as typeof only)}
        >
          <option value="all">{t('map.all')}</option>
          <option value="failed">{t('map.onlyFailed')}</option>
          <option value="untested">{t('map.onlyUntested')}</option>
        </select>
        <Check checked={unidentified} onChange={setUnidentified}>
          {t('map.unidentified')}
        </Check>
      </div>
      <div className="map-canvas scroll" ref={holder}>
        <div style={{ width: layout.width * scale, height: (layout.height + 10) * scale }}>
          <div
            style={{
              position: 'relative',
              width: layout.width,
              height: layout.height + 10,
              transform: `scale(${scale})`,
              transformOrigin: '0 0',
            }}
          >
            <svg
              width={layout.width}
              height={layout.height}
              style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
            >
              <defs>
                <marker
                  id="arrow"
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto"
                >
                  <path d="M0 0 8 4 0 8z" fill="var(--dim)" />
                </marker>
              </defs>
              {graph.edges.map((e) => {
                const a = pos(e.from),
                  b = pos(e.to);
                if (!a || !b) return null;
                const x1 = a.x + cell.w,
                  y1 = a.y + cell.h / 2,
                  x2 = b.x,
                  y2 = b.y + cell.h / 2;
                const back = x2 <= x1;
                const mx = (x1 + x2) / 2;
                return (
                  <path
                    key={e.from + e.to}
                    d={
                      back
                        ? `M${a.x + cell.w / 2} ${a.y + cell.h} C${a.x + cell.w / 2} ${a.y + cell.h + 30}, ${b.x + cell.w / 2} ${b.y + cell.h + 30}, ${b.x + cell.w / 2} ${b.y + cell.h}`
                        : `M${x1} ${y1} C${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`
                    }
                    fill="none"
                    stroke="var(--dim)"
                    strokeWidth={Math.min(3, 1 + e.count / 3)}
                    strokeDasharray={e.count ? undefined : '4 4'}
                    opacity={e.count ? 0.75 : 0.4}
                    markerEnd="url(#arrow)"
                  />
                );
              })}
            </svg>
            {screens.map((s) => {
              const p = pos(s.id)!;
              return (
                <ScreenCard
                  key={s.id}
                  screen={s}
                  style={{ left: p.x, top: p.y, width: cell.w, height: cell.h }}
                  onClick={() => setOpen(s)}
                />
              );
            })}
          </div>
        </div>
      </div>
      {open && <ScreenDetail screen={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ScreenCard({
  screen,
  style,
  onClick,
}: {
  screen: GraphScreen;
  style: React.CSSProperties;
  onClick: () => void;
}) {
  const { project } = useApp();
  const [image, setImage] = useState<string | null>(null);
  useEffect(() => {
    setImage(null);
    const f = screen.thumbnail;
    if (f && project)
      void call('runs.screenshot', {
        projectId: project.id,
        campaignId: project.activeCampaignId ?? undefined,
        runId: f.runId,
        entryId: f.entry.id,
      })
        .then(setImage)
        .catch(() => {});
  }, [screen.thumbnail?.entry.id, project?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <button
      className={`screen-card st-${screen.status} ${screen.planned && !screen.frames.length ? 'planned' : ''}`}
      style={style}
      onClick={onClick}
    >
      <div className="thumb">
        {image ? (
          <img src={image} alt="" />
        ) : (
          <span className="note">{screen.frames.length ? '…' : '—'}</span>
        )}
      </div>
      <div className="meta">
        <b className="ellipsis" title={screen.name}>
          {screen.name}
        </b>
        <span className="osrow">
          {OS_LIST.filter((o) => screen.stats[o] || screen.planned).map((os) => {
            const st = screen.stats[os];
            return (
              <span key={os} className={`os-stat ${st?.failed ? 'bad' : st?.passed ? 'good' : ''}`}>
                <PlatformIcon os={os} size={11} />
                {st ? `${st.passed}✓${st.failed ? ` ${st.failed}✗` : ''}` : '–'}
              </span>
            );
          })}
        </span>
      </div>
    </button>
  );
}

function ScreenDetail({ screen, onClose }: { screen: GraphScreen; onClose: () => void }) {
  const t = useT();
  const { project } = useApp();
  return (
    <Modal title={screen.name} onClose={onClose}>
      <div className="stack">
        <p className="note">
          {screen.planned ? t('map.planned') : t('map.observedOnly')} · <code>{screen.id}</code>
        </p>
        {!screen.frames.length && <div className="empty note">{t('map.notTested')}</div>}
        {screen.frames.map((f) => (
          <button
            key={f.entry.id}
            className="frame-row"
            onClick={() => {
              void call('replay.select', { projectId: project!.id, frame: f });
              onClose();
            }}
          >
            <PlatformIcon os={f.entry.platform} />
            <span className="grow ellipsis" style={{ textAlign: 'left' }}>
              {f.entry.nodeName}
            </span>
            <span
              className={`badge ${outcomeOf(f.entry) === 'passed' ? 'ok' : outcomeOf(f.entry) === 'failed' ? 'err' : ''}`}
            >
              {t(`st.${outcomeOf(f.entry)}` as never)}
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
