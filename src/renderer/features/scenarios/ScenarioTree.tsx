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
  Search,
  GitBranch,
  Repeat,
  Workflow,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { latestOutcomes } from '../../../shared/domain/campaign';
import {
  applicableOs,
  appendChildren,
  cloneWithNewIds,
  flatten,
  insertAfter,
  makeNode,
  moveNode,
  removeNode,
  type NodeKind,
  type OS,
  type ScenarioNode,
} from '../../../shared/domain/scenario';
import { useT } from '../../shared/i18n';
import { IconButton } from '../../shared/ui/controls';
import { PlatformIcon } from '../../shared/ui/icons';
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
  const { project, projectOs, detail } = useApp();
  const actions = useActions();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const outcomes = useMemo(() => latestOutcomes(detail), [detail]);
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
    if (parent)
      setCollapsed((s) => {
        const n = new Set(s);
        n.delete(parent.id);
        return n;
      });
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
    const status = (os: OS) => (n.kind === 'scenario' ? undefined : outcomes.get(os + ':' + n.id));
    return (
      <div key={n.id}>
        <div
          className={`tree-row ${project.selectedNodeId === n.id ? 'sel' : ''} k-${n.kind}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => void actions.updateProject({ selectedNodeId: n.id })}
        >
          {n.children.length ? (
            <button
              className="twisty"
              onClick={(e) => {
                e.stopPropagation();
                setCollapsed((s) => {
                  const c = new Set(s);
                  c.has(n.id) ? c.delete(n.id) : c.add(n.id);
                  return c;
                });
              }}
            >
              {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
          ) : (
            <span className="twisty" />
          )}
          <Icon size={14} className={`kind-${n.kind}`} />
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
          {mode === 'execution' && n.kind !== 'scenario' && (
            <span className="results">
              {projectOs.map((os) =>
                n.platforms && !n.platforms.includes(os) ? null : (
                  <span
                    key={os}
                    className={`rs ${status(os) ?? ''}`}
                    title={`${os}: ${status(os) ?? t('tree.notRun')}`}
                  >
                    <PlatformIcon os={os} size={10} />
                  </span>
                ),
              )}
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
