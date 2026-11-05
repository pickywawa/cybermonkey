import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Compass,
  Loader2,
  Timer,
  MousePointerClick,
  Search,
  ShieldCheck,
  Wand2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ResultRow } from '../../../shared/domain/campaign';
import type { CampaignDetail } from '../../../shared/domain/report';
import { pendingRepairs } from '../../../shared/domain/repairs';
import { stabilityOf } from '../../../shared/domain/stability';
import { call } from '../../shared/api';
import { PlatformIcon, osName } from '../../shared/ui/icons';
import { useT } from '../../shared/i18n';
import { Badge, Button, IconButton } from '../../shared/ui/controls';
import { useActions, useApp } from '../../app/store';
import { FilterMenu } from './FilterMenu';
import { useExec } from './focus';
import { OsMark } from './OsMark';
import { ResultDetail } from './ResultDetail';

const KIND_ICON = { navigation: Compass, action: MousePointerClick, test: ShieldCheck } as const;
const FILTERS = ['passed', 'failed', 'pending', 'other', 'flaky', 'healed', 'slow'] as const;
type Filter = (typeof FILTERS)[number];

const seconds = (ms: number) =>
  (ms / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 }) + ' s';
const entriesOf = (row: ResultRow) => Object.values(row.results).map((r) => r!.entry);
const matches = (row: ResultRow, f: Filter): boolean =>
  f === 'slow'
    ? Object.keys(row.slow).length > 0
    : f === 'flaky'
      ? entriesOf(row).some((e) => e.flaky)
      : f === 'healed'
        ? entriesOf(row).some((e) => e.healing)
        : f === 'pending'
          ? row.status === 'pending' || row.status === 'running'
          : row.status === f;

/** The result a click on this row shows on the device panel: the failure if there is one, else the first one. */
const pickResult = (row: ResultRow) =>
  Object.values(row.results).find((r) => r!.outcome === 'failed') ?? Object.values(row.results)[0];

/**
 * One row per ELEMENT of the scenarios, in the scenarios' own order, each with the result of its last run.
 * Scenarios are separators, screen changes are lighter ones; the tree on the left folds and selects the same things.
 */
export function ResultsList({ detail }: { detail: CampaignDetail | null }) {
  const t = useT();
  const { project, settings } = useApp();
  const actions = useActions();
  const exec = useExec();
  const { results, collapsed, open, focus } = exec;
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Set<string>>(new Set());
  const [pulse, setPulse] = useState<string | null>(null);
  const stability = useMemo(
    () => new Map(stabilityOf([detail]).map((s) => [s.os + ':' + s.nodeId, s])),
    [detail],
  );
  const repairs = useMemo(
    () => (project && detail ? pendingRepairs(detail, project) : []),
    [detail, project],
  );
  const [applying, setApplying] = useState(false);
  const scrubbing = useRef(false);
  const last = useRef<string | null>(null);

  const all = results.scenarios.flatMap((s) => s.rows);
  const q = query.trim().toLowerCase();
  const shown = (row: ResultRow) =>
    (!filters.size || [...filters].some((f) => matches(row, f as Filter))) &&
    (!q ||
      row.node.name.toLowerCase().includes(q) ||
      (row.screen?.name ?? '').toLowerCase().includes(q) ||
      entriesOf(row).some((e) => e.message.toLowerCase().includes(q)));
  const filtering = filters.size > 0 || !!q;
  const groups = results.scenarios
    .map((sc) => ({ sc, rows: sc.rows.filter(shown) }))
    .filter((g) => g.rows.length || (!filtering && g.sc.rows.length === 0));
  const shownCount = groups.reduce((n, g) => n + g.rows.length, 0);

  // « Show me this element » coming from the tree: unfold its scenario, open it, scroll to it.
  useEffect(() => {
    if (!focus.nodeId || focus.from === 'results') return;
    const owner = results.scenarios.find(
      (s) => s.scenario.id === focus.nodeId || s.rows.some((r) => r.node.id === focus.nodeId),
    );
    if (!owner) return;
    exec.setCollapsed([owner.scenario.id], false);
    setPulse(focus.nodeId);
    const timer = setTimeout(() => setPulse(null), 1500);
    const frame = requestAnimationFrame(() =>
      document
        .getElementById('res-' + focus.nodeId)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
    );
    return () => (clearTimeout(timer), cancelAnimationFrame(frame));
  }, [focus.n]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!project) return null;
  const choose = (row: ResultRow) => {
    const isOpen = open.has(row.node.id);
    exec.reveal(row.node.id, 'results');
    exec.setOpen(row.node.id, !isOpen);
    void actions.updateProject({ selectedNodeId: row.node.id });
    const r = pickResult(row);
    if (r && !isOpen)
      void call('replay.select', {
        projectId: project.id,
        frame: { runId: r.runId, entry: r.entry },
      });
  };
  const applyAll = async () => {
    if (!detail) return;
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
  const countOf = (f: Filter) => all.filter((r) => matches(r, f)).length;

  /** Scrubbing the rail: show that step's capture on the device panel and bring the row into view. */
  const scrub = (row: ResultRow) => {
    exec.setCollapsed([row.scenarioId], false);
    exec.reveal(row.node.id, 'results');
    void actions.updateProject({ selectedNodeId: row.node.id });
    const r = pickResult(row);
    if (r)
      void call('replay.select', {
        projectId: project.id,
        frame: { runId: r.runId, entry: r.entry },
      });
    document.getElementById('res-' + row.node.id)?.scrollIntoView({ block: 'nearest' });
  };

  const press = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!(e.target as HTMLElement).closest('.rail-seg')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubbing.current = true;
    last.current = null;
    scrubAt(e.clientY);
  };
  const scrubAt = (y: number) => {
    const items = [...document.querySelectorAll<HTMLElement>('.res-item')];
    let best: HTMLElement | undefined;
    let gap = Infinity;
    for (const el of items) {
      const b = el.getBoundingClientRect();
      const d = y < b.top ? b.top - y : y > b.bottom ? y - b.bottom : 0;
      if (d < gap) ((gap = d), (best = el));
    }
    const row = best && all.find((r) => r.node.id === best!.dataset.id);
    if (!row || last.current === row.node.id) return;
    last.current = row.node.id;
    scrub(row);
  };

  return (
    <div
      className="results-list"
      onPointerDown={press}
      onPointerMove={(e) => scrubbing.current && scrubAt(e.clientY)}
      onPointerUp={() => (scrubbing.current = false)}
      onPointerCancel={() => (scrubbing.current = false)}
    >
      <div className="results-main">
        <div className="list-tools">
          <div className="search grow">
            <Search size={13} />
            <input
              placeholder={t('exec.search')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <FilterMenu
            selected={filters}
            onChange={setFilters}
            options={FILTERS.map((f) => ({
              value: f,
              label: t(`exec.f.${f}` as never),
              count: countOf(f),
            }))}
          />
          <IconButton
            label={exec.passedFolded ? t('exec.expandPassed') : t('exec.collapsePassed')}
            onClick={exec.foldPassed}
          >
            {exec.passedFolded ? <ChevronsUpDown size={15} /> : <ChevronsDownUp size={15} />}
          </IconButton>
          <span className="note">
            {shownCount} / {all.length}
          </span>
        </div>
        {repairs.length > 0 && (
          <div className="notice" style={{ margin: '0 0 10px' }}>
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
        {!all.length && <div className="empty note">{t('prog.none')}</div>}
        {groups.map(({ sc, rows }) => {
          const folded = collapsed.has(sc.scenario.id);
          let previousScreen: string | undefined;
          return (
            <section
              key={sc.scenario.id}
              className={`res-group st-${sc.status} ${sc.rows.some((r) => r.status === 'running') ? 'is-running' : ''}`}
            >
              <header
                id={'res-' + sc.scenario.id}
                className={`res-scenario ${project.selectedNodeId === sc.scenario.id ? 'sel' : ''} ${pulse === sc.scenario.id ? 'pulse' : ''}`}
                onClick={() => exec.toggle(sc.scenario.id)}
              >
                {folded ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                <b className="ellipsis grow">{sc.scenario.name}</b>
                {sc.module && <span className="module-tag">{sc.module}</span>}
                {sc.slow && (
                  <span
                    className="slow-tag"
                    title={t('slow.scenarioHint', {
                      now: seconds(sc.slow.ms),
                      usual: seconds(sc.slow.baselineMs),
                    })}
                  >
                    <Timer size={11} /> {t('slow.tag', { x: sc.slow.ratio })}
                  </span>
                )}
                <span className={`group-count ${sc.status}`}>
                  {sc.totals.passed}/{sc.totals.total}
                  {sc.totals.failed > 0 && <em> · {sc.totals.failed} ✗</em>}
                </span>
              </header>
              {!folded &&
                rows.map((row) => {
                  const Icon = KIND_ICON[row.node.kind as keyof typeof KIND_ICON] ?? ShieldCheck;
                  const screenChanged = row.screen?.id !== previousScreen;
                  previousScreen = row.screen?.id;
                  const isOpen = open.has(row.node.id);
                  const done = Object.values(row.results).map((r) => r!.entry);
                  const secs = done
                    .filter((e) => e.finishedAt)
                    .reduce(
                      (n, e) => n + (Date.parse(e.finishedAt!) - Date.parse(e.startedAt)) / 1000,
                      0,
                    );
                  return (
                    <div key={row.node.id} className="res-item" data-id={row.node.id}>
                      <div className="rail-seg" title={row.node.name}>
                        {project.platforms.map((os) => (
                          <i
                            key={os}
                            className={`${row.oses.includes(os) ? (row.states[os] ?? '') : 'na'}${row.slow[os] ? ' slow' : ''}`}
                          />
                        ))}
                      </div>
                      {screenChanged && row.screen && (
                        <div className="screen-sep">
                          <span>{row.screen.name}</span>
                        </div>
                      )}
                      <div
                        id={'res-' + row.node.id}
                        className={`res-row st-${row.status} ${Object.keys(row.slow).length ? 'is-slow' : ''} ${project.selectedNodeId === row.node.id ? 'sel' : ''} ${pulse === row.node.id ? 'pulse' : ''}`}
                        style={{ paddingLeft: 12 + row.depth * 14 }}
                        onClick={() => choose(row)}
                      >
                        {row.status === 'running' ? (
                          <Loader2 size={13} className="spin run-icon" />
                        ) : (
                          <Icon size={13} className={`kind-${row.node.kind}`} />
                        )}
                        <span className="name ellipsis" title={row.node.name}>
                          {row.node.name}
                        </span>
                        {!isOpen &&
                          row.oses
                            .filter((os) => row.states[os] === 'running')
                            .map((os) => {
                              const e = row.results[os]!.entry;
                              const text = e.operationMessage ?? e.message;
                              return text ? (
                                <span key={os} className="run-text ellipsis" title={text}>
                                  {row.oses.length > 1 && <PlatformIcon os={os} size={10} plain />}
                                  {text}
                                </span>
                              ) : null;
                            })}
                        <span className="grow" />
                        {Object.values(row.slow).length > 0 && (
                          <span
                            title={Object.entries(row.slow)
                              .map(([os, v]) =>
                                t('slow.detail', {
                                  os: osName(os as never),
                                  now: seconds(v.ms),
                                  usual: seconds(v.baselineMs),
                                  x: v.ratio,
                                }),
                              )
                              .join('\n')}
                          >
                            <Timer size={12} color="var(--warn)" />
                          </span>
                        )}
                        {done.some((e) => e.healing) && (
                          <span title={t('res.healed')}>
                            <Wand2 size={12} color="var(--accent)" />
                          </span>
                        )}
                        {done.some((e) => e.flaky) && <Badge tone="warn">{t('res.flaky')}</Badge>}
                        <span className="os-marks">
                          {row.oses.map((os) => (
                            <OsMark
                              key={os}
                              os={os}
                              state={row.states[os]!}
                              slow={!!row.slow[os]}
                              language={settings?.language}
                            />
                          ))}
                        </span>
                        <span className={`note dur ${Object.keys(row.slow).length ? 'slow' : ''}`}>
                          {secs ? secs.toFixed(1) + ' s' : ''}
                        </span>
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </div>
                      {isOpen && (
                        <div className="res-detail">
                          <ResultDetail row={row} stability={stability} />
                        </div>
                      )}
                    </div>
                  );
                })}
            </section>
          );
        })}
        {!!all.length && !shownCount && <div className="empty note">{t('res.none')}</div>}
      </div>
    </div>
  );
}
