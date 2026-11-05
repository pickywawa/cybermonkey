import {
  ChevronDown,
  ChevronRight,
  Compass,
  ImageOff,
  MousePointerClick,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  screenInventory,
  type ElementResult,
  type ResultRow,
  type ScreenItem,
  type ScreenStatus2,
} from '../../../shared/domain/campaign';
import type { CampaignDetail } from '../../../shared/domain/report';
import { call } from '../../shared/api';
import { useT } from '../../shared/i18n';
import { osName } from '../../shared/ui/icons';
import { useActions, useApp } from '../../app/store';
import { FilterMenu } from './FilterMenu';
import { useExec } from './focus';
import { OsMark, type MarkState } from './OsMark';

const FILTERS: ScreenStatus2[] = ['passed', 'failed', 'partial', 'untested', 'none'];
const MARK: Record<ScreenStatus2, MarkState> = {
  passed: 'passed',
  failed: 'failed',
  partial: 'partial',
  untested: 'pending',
  none: 'none',
};
const KIND_ICON = { navigation: Compass, action: MousePointerClick, test: ShieldCheck } as const;

/**
 * The screens of the application: their name, whether the tests linked to them pass, and what they looked like.
 * Grouped by the module the scenarios declare (filled by the AI when it creates them).
 */
export function ScreensView({ detail }: { detail: CampaignDetail | null }) {
  const t = useT();
  const { project, settings } = useApp();
  const exec = useExec();
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Set<string>>(new Set());
  const [openScreen, setOpenScreen] = useState<string | null>(null);
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const items = useMemo(
    () => (project ? screenInventory(exec.results.scenarios, project.platforms) : []),
    [exec.results, project],
  );
  if (!project) return null;
  const q = query.trim().toLowerCase();
  const shown = items.filter(
    (s) =>
      (!filters.size || filters.has(s.status)) &&
      (!q || s.name.toLowerCase().includes(q) || s.module.toLowerCase().includes(q)),
  );
  const modules = new Map<string, ScreenItem[]>();
  for (const s of shown) modules.set(s.module, [...(modules.get(s.module) ?? []), s]);
  // « No module » goes last, the others keep the order of the scenarios.
  const ordered = [...modules].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : 0));

  return (
    <div className="screens-view">
      <div className="list-tools">
        <div className="search grow">
          <Search size={13} />
          <input
            placeholder={t('scr.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <FilterMenu
          selected={filters}
          onChange={setFilters}
          options={FILTERS.map((f) => ({
            value: f,
            label: t(`scr.f.${f}` as never),
            count: items.filter((s) => s.status === f).length,
          }))}
        />
        <span className="note">
          {shown.length} / {items.length}
        </span>
      </div>
      {!items.length && <div className="empty note">{t('scr.empty')}</div>}
      {ordered.map(([module, screens]) => {
        const isFolded = folded.has(module);
        const passed = screens.filter((s) => s.status === 'passed').length;
        const failed = screens.filter((s) => s.status === 'failed').length;
        return (
          <section key={module || '∅'} className="res-group">
            <header
              className="res-scenario"
              onClick={() =>
                setFolded((s) => {
                  const n = new Set(s);
                  n.has(module) ? n.delete(module) : n.add(module);
                  return n;
                })
              }
            >
              {isFolded ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
              <b className="ellipsis grow">{module || t('scr.noModule')}</b>
              <span
                className={`group-count ${failed ? 'failed' : passed === screens.length ? 'passed' : ''}`}
              >
                {passed}/{screens.length}
                {failed > 0 && <em> · {failed} ✗</em>}
              </span>
            </header>
            {!isFolded &&
              screens.map((s) => {
                const isOpen = openScreen === s.id;
                const done = s.tests.filter((r) => r.status === 'passed').length;
                return (
                  <div key={s.id}>
                    <div
                      className={`res-row scr-row st-${s.status === 'passed' ? 'passed' : s.status === 'failed' ? 'failed' : 'pending'}`}
                      onClick={() => setOpenScreen(isOpen ? null : s.id)}
                    >
                      <span className="grow ellipsis" title={s.name}>
                        {s.name}
                      </span>
                      <span className="note">
                        {s.tests.length
                          ? t('scr.tests', { passed: done, total: s.tests.length })
                          : t('scr.noTests')}
                      </span>
                      <span className="os-marks">
                        {project.platforms.map((os) => (
                          <OsMark
                            key={os}
                            os={os}
                            state={MARK[s.byOs[os] ?? 'none']}
                            language={settings?.language}
                          />
                        ))}
                      </span>
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </div>
                    {isOpen && <ScreenDetail item={s} detail={detail} />}
                  </div>
                );
              })}
          </section>
        );
      })}
      {!!items.length && !shown.length && <div className="empty note">{t('scr.noMatch')}</div>}
    </div>
  );
}

function ScreenDetail({ item, detail }: { item: ScreenItem; detail: CampaignDetail | null }) {
  const t = useT();
  const { project, settings } = useApp();
  const actions = useActions();
  const exec = useExec();
  if (!project) return null;
  const goto = (row: ResultRow) => {
    exec.setView('results');
    exec.reveal(row.node.id, 'map');
    void actions.updateProject({ selectedNodeId: row.node.id });
  };
  return (
    <div className="res-detail">
      <div className="scr-detail">
        <div className="scr-shots">
          {project.platforms.map((os) => (
            <figure key={os}>
              <Capture result={item.captures[os]} campaignId={detail?.campaign.id} />
              <figcaption className="note">
                <OsMark
                  os={os}
                  state={MARK[item.byOs[os] ?? 'none']}
                  language={settings?.language}
                />{' '}
                {osName(os)}
              </figcaption>
            </figure>
          ))}
        </div>
        <div className="stack" style={{ gap: 2, minWidth: 0 }}>
          <b className="eyebrow">{t('scr.checks')}</b>
          {!item.tests.length && <span className="note">{t('scr.noTests')}</span>}
          {item.tests.map((row) => (
            <TestLine key={row.node.id} row={row} onClick={() => goto(row)} />
          ))}
          {item.elements.length > item.tests.length && (
            <span className="note" style={{ marginTop: 6 }}>
              {t('scr.others', { n: item.elements.length - item.tests.length })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function TestLine({ row, onClick }: { row: ResultRow; onClick(): void }) {
  const { settings } = useApp();
  const Icon = KIND_ICON[row.node.kind as keyof typeof KIND_ICON] ?? ShieldCheck;
  return (
    <div className={`res-row compact st-${row.status}`} onClick={onClick}>
      <Icon size={12} className={`kind-${row.node.kind}`} />
      <span className="grow ellipsis" title={row.node.name}>
        {row.node.name}
      </span>
      <span className="os-marks">
        {row.oses.map((os) => (
          <OsMark key={os} os={os} state={row.states[os]!} language={settings?.language} />
        ))}
      </span>
    </div>
  );
}

/** The capture is read from disk only when its screen is opened. */
function Capture({
  result,
  campaignId,
}: {
  result: ElementResult | undefined;
  campaignId: string | undefined;
}) {
  const t = useT();
  const { project } = useApp();
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    setSrc(undefined);
    if (!result || !project) return;
    let alive = true;
    void call('runs.screenshot', {
      projectId: project.id,
      campaignId,
      runId: result.runId,
      entryId: result.entry.id,
    })
      .then((s) => alive && setSrc(s))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [result?.entry.id, project?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (src) return <img className="scr-img" src={src} alt="" />;
  return (
    <div className="scr-img empty-shot">
      <ImageOff size={18} />
      <span className="note">
        {!result || src === null ? t('scr.noCapture') : t('scr.loading')}
      </span>
    </div>
  );
}
