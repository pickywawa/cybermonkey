import {
  ChevronDown,
  ChevronRight,
  Compass,
  Copy,
  Layers,
  MousePointerClick,
  Play,
  Plus,
  ShieldCheck,
  Trash2,
  ArrowUp,
  ArrowDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Search,
  GitBranch,
  Repeat,
  Workflow,
  Loader2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  applicableOs,
  appendChildren,
  cloneWithNewIds,
  flatten,
  insertAfter,
  makeNode,
  moveNode,
  nodePath,
  removeNode,
  type NodeKind,
  type OS,
  type ScenarioNode,
} from '../../../shared/domain/scenario';
import { useT } from '../../shared/i18n';
import { IconButton } from '../../shared/ui/controls';
import { PlatformIcon } from '../../shared/ui/icons';
import { useExec } from '../execution/focus';
import { OsMark } from '../execution/OsMark';
import { Menu } from '../../shared/ui/overlays';
import { useActions, useApp } from '../../app/store';

const KIND_ICON: Record<NodeKind, typeof Layers> = {
  scenario: Layers,
  navigation: Compass,
  action: MousePointerClick,
  test: ShieldCheck,
};

/** Scenario tree: selection, quick add/duplicate/reorder, per-OS coverage; run status in execution mode. */
export function ScenarioTree({
  mode,
  onRun,
}: {
  mode: 'creation' | 'execution';
  onRun?: (nodeId: string) => void;
}) {
  const t = useT();
  const { project, projectOs, settings } = useApp();
  const actions = useActions();
  const exec = useExec();
  const { collapsed } = exec;
  const [query, setQuery] = useState('');
  const [pulse, setPulse] = useState<string | null>(null);
  // Results of every element and the totals of every scenario, from the same source as the results list.
  const rowOf = useMemo(
    () => new Map(exec.results.scenarios.flatMap((s) => s.rows).map((r) => [r.node.id, r])),
    [exec.results],
  );
  const scenarioOf = useMemo(
    () => new Map(exec.results.scenarios.map((s) => [s.scenario.id, s])),
    [exec.results],
  );

  // « Show me this element » coming from the results: unfold the way down to it and scroll to it.
  useEffect(() => {
    const { nodeId, from } = exec.focus;
    if (mode !== 'execution' || !project || !nodeId || from === 'tree') return;
    const ancestors = nodePath(project.nodes, nodeId)
      .slice(0, -1)
      .map((n) => n.id);
    if (ancestors.length) exec.setCollapsed(ancestors, false);
    setPulse(nodeId);
    const timer = setTimeout(() => setPulse(null), 1500);
    const frame = requestAnimationFrame(() =>
      document
        .getElementById('tree-' + nodeId)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
    );
    return () => (clearTimeout(timer), cancelAnimationFrame(frame));
  }, [exec.focus.n]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!project) return null;
  const roots = project.nodes.filter((n) => !n.preparation && !n.handler);
  const prep = project.nodes.filter((n) => n.preparation);
  const handlers = project.nodes.filter((n) => n.handler);
  const q = query.trim().toLowerCase();
  const visible = (n: ScenarioNode): boolean =>
    !q || n.name.toLowerCase().includes(q) || n.children.some(visible);
  const setNodes = (nodes: ScenarioNode[], selectedNodeId?: string | null) =>
    actions.updateProject({ nodes, ...(selectedNodeId !== undefined ? { selectedNodeId } : {}) });
  const add = (parent: ScenarioNode | null, kind: NodeKind) => {
    const node = makeNode(
      kind,
      t(`tree.new.${kind}` as never),
      kind === 'scenario' ? [] : projectOs,
    );
    void setNodes(
      parent ? appendChildren(project.nodes, parent.id, [node]) : [...project.nodes, node],
      node.id,
    );
    if (parent) exec.setCollapsed([parent.id], false);
  };
  const duplicate = (n: ScenarioNode) => {
    const copy = { ...cloneWithNewIds(n), name: n.name + ' ' + t('tree.copy') };
    void setNodes(
      n.kind === 'scenario' ? [...project.nodes, copy] : insertAfter(project.nodes, n.id, copy),
      copy.id,
    );
  };

  const render = (n: ScenarioNode, depth: number, parent: ScenarioNode | null): React.ReactNode => {
    if (!visible(n)) return null;
    const Icon = KIND_ICON[n.kind];
    const open = !collapsed.has(n.id) || !!q;
    const missing =
      n.kind !== 'scenario'
        ? applicableOs(n, project.platforms).filter((os) => !n.variants[os])
        : [];
    const row = rowOf.get(n.id);
    const sc = scenarioOf.get(n.id);
    return (
      <div key={n.id}>
        <div
          id={'tree-' + n.id}
          className={`tree-row ${project.selectedNodeId === n.id ? 'sel' : ''} ${pulse === n.id ? 'pulse' : ''} ${row ? 'st-' + row.status : ''} k-${n.kind}`}
          style={{ paddingLeft: mode === 'execution' ? 8 : 8 + depth * 14 }}
          onClick={() => {
            void actions.updateProject({ selectedNodeId: n.id });
            // In execution mode a click also shows the element's result, whichever tab was open.
            if (mode === 'execution' && (row || sc)) {
              exec.setView('results');
              exec.reveal(n.id, 'tree');
            }
          }}
        >
          {mode === 'execution' && (
            <span className="os-col" style={{ width: project.platforms.length * 21 - 9 }}>
              {row && (
                <span className="os-marks">
                  {row.oses.map((os) => (
                    <OsMark
                      key={os}
                      os={os}
                      state={row.states[os]!}
                      size={11}
                      language={settings?.language}
                    />
                  ))}
                </span>
              )}
            </span>
          )}
          {mode === 'execution' && depth > 0 && (
            <span style={{ width: depth * 14, flex: 'none' }} />
          )}
          {n.children.length ? (
            <button
              className="twisty"
              onClick={(e) => {
                e.stopPropagation();
                exec.toggle(n.id);
              }}
            >
              {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
          ) : (
            <span className="twisty" />
          )}
          {row?.status === 'running' ? (
            <Loader2 size={14} className="spin run-icon" />
          ) : (
            <Icon size={14} className={`kind-${n.kind}`} />
          )}
          <span className="grow ellipsis" title={n.name}>
            {n.name}
          </span>
          {(n.when || n.call || n.dataset) && (
            <span className="logic-marks">
              {n.when && (
                <span title={t('logic.when')}>
                  <GitBranch size={11} />
                </span>
              )}
              {n.call && (
                <span
                  title={t('logic.callTitle', {
                    name: project.nodes.find((r) => r.id === n.call)?.name ?? '?',
                  })}
                >
                  <Workflow size={11} />
                </span>
              )}
              {n.dataset && (
                <span title={t('logic.datasetRows', { n: n.dataset.rows.length })}>
                  <Repeat size={11} />
                </span>
              )}
            </span>
          )}
          {mode === 'creation' && missing.length > 0 && (
            <span className="gap" title={t('tree.missing', { os: missing.join(', ') })}>
              {missing.map((os) => (
                <PlatformIcon key={os} os={os} size={11} />
              ))}
            </span>
          )}
          {mode === 'execution' && sc && sc.rows.length > 0 && (
            <span className={`group-count ${sc.status}`} title={t('exec.scenarioCount')}>
              {sc.totals.passed}/{sc.totals.total}
              {sc.totals.failed > 0 && <em> · {sc.totals.failed} ✗</em>}
            </span>
          )}
          <span className="row-actions" onClick={(e) => e.stopPropagation()}>
            {mode === 'execution' && onRun && (
              <IconButton label={t('tree.run')} onClick={() => onRun(n.id)}>
                <Play size={13} />
              </IconButton>
            )}
            {mode === 'creation' && (
              <Menu
                align="right"
                trigger={(toggle) => (
                  <IconButton label={t('tree.add')} onClick={toggle}>
                    <Plus size={13} />
                  </IconButton>
                )}
              >
                {(close) => (
                  <>
                    {(['action', 'navigation', 'test'] as const).map((k) => (
                      <button
                        key={k}
                        onClick={() => {
                          close();
                          add(n.kind === 'scenario' ? n : (parent ?? n), k);
                        }}
                      >
                        {t(`tree.add.${k}` as never)}
                      </button>
                    ))}
                    <hr />
                    <button
                      onClick={() => {
                        close();
                        duplicate(n);
                      }}
                    >
                      <Copy size={13} /> {t('tree.duplicate')}
                    </button>
                    <button
                      onClick={() => {
                        close();
                        void setNodes(moveNode(project.nodes, n.id, -1));
                      }}
                    >
                      <ArrowUp size={13} /> {t('tree.up')}
                    </button>
                    <button
                      onClick={() => {
                        close();
                        void setNodes(moveNode(project.nodes, n.id, 1));
                      }}
                    >
                      <ArrowDown size={13} /> {t('tree.down')}
                    </button>
                    <button
                      style={{ color: 'var(--danger)' }}
                      onClick={() => {
                        close();
                        if (confirm(t('tree.confirmDelete', { name: n.name })))
                          void setNodes(
                            removeNode(project.nodes, n.id),
                            project.selectedNodeId === n.id ? null : undefined,
                          );
                      }}
                    >
                      <Trash2 size={13} /> {t('tree.delete')}
                    </button>
                  </>
                )}
              </Menu>
            )}
          </span>
        </div>
        {open && n.children.map((c) => render(c, depth + 1, n))}
      </div>
    );
  };
  return (
    <div className="tree">
      <div className="panel-head" style={{ height: 40 }}>
        <Layers size={14} color="var(--dim)" />
        <span className="eyebrow grow">
          {t('tree.title')} · {flatten(roots).filter((n) => n.kind !== 'scenario').length}
        </span>
        {mode === 'creation' && (
          <IconButton label={t('tree.addScenario')} onClick={() => add(null, 'scenario')}>
            <Plus size={15} />
          </IconButton>
        )}
        {mode === 'execution' && (
          <IconButton
            label={exec.passedFolded ? t('exec.expandPassed') : t('exec.collapsePassed')}
            onClick={exec.foldPassed}
          >
            {exec.passedFolded ? <ChevronsUpDown size={15} /> : <ChevronsDownUp size={15} />}
          </IconButton>
        )}
        {mode === 'execution' && onRun && (
          <IconButton label={t('tree.runAll')} onClick={() => onRun('')}>
            <Play size={15} />
          </IconButton>
        )}
      </div>
      {flatten(roots).length > 6 && (
        <div className="tree-search">
          <Search size={13} />
          <input
            placeholder={t('tree.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}
      <div className="scroll grow">
        {roots.length === 0 && (
          <div className="empty">
            <Layers size={22} />
            <span>{t('tree.empty')}</span>
          </div>
        )}
        {roots.map((n) => render(n, 0, null))}
        {handlers.length > 0 && (
          <>
            <div className="eyebrow" style={{ padding: '12px 12px 4px' }}>
              {t('tree.handlers')}
            </div>
            {handlers.map((n) => render(n, 0, null))}
          </>
        )}
        {prep.length > 0 && (
          <>
            <div className="eyebrow" style={{ padding: '12px 12px 4px' }}>
              {t('tree.preparation')}
            </div>
            {prep.map((n) => render(n, 0, null))}
          </>
        )}
      </div>
    </div>
  );
}
