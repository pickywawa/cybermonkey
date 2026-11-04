import {
  AlertTriangle,
  CircleCheck,
  CircleX,
  Compass,
  Layers,
  MousePointerClick,
  ShieldCheck,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  OS_LIST,
  appendChildren,
  findNode,
  flatten,
  type NodeKind,
  type ScenarioNode,
} from '../../../shared/domain/scenario';
import type { CreationReply } from '../../../shared/ipc';
import { useT } from '../../shared/i18n';
import { Badge, Button } from '../../shared/ui/controls';
import { PlatformIcon, osName } from '../../shared/ui/icons';
import { ErrorNotice } from '../../shared/ui/notices';
import { Modal } from '../../shared/ui/overlays';
import { useActions, useApp } from '../../app/store';

const ICON: Record<NodeKind, typeof Layers> = {
  scenario: Layers,
  navigation: Compass,
  action: MousePointerClick,
  test: ShieldCheck,
};
const TONE = { passed: 'ok', failed: 'err', blocked: 'warn', skipped: undefined } as const;

/** The AI's synthesis, shown BEFORE anything is saved: pick what to keep, rename, see replay results and gaps. */
export function ProposalReview({ reply, onClose }: { reply: CreationReply; onClose: () => void }) {
  const t = useT();
  const { project } = useApp();
  const actions = useActions();
  const [nodes, setNodes] = useState<ScenarioNode[]>(reply.proposal ?? []);
  const all = useMemo(() => flatten(nodes), [nodes]);
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(flatten(reply.proposal ?? []).map((n) => n.id)),
  );
  const [showWarnings, setShowWarnings] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (!project) return null;
  const failed = reply.replay.some((r) => r.status === 'failed');

  const toggle = (n: ScenarioNode, on: boolean) =>
    setChecked((s) => {
      const next = new Set(s);
      for (const x of flatten([n])) on ? next.add(x.id) : next.delete(x.id);
      if (on) {
        // a step needs its scenario
        const root = nodes.find((r) => flatten([r]).some((x) => x.id === n.id));
        if (root) next.add(root.id);
      }
      return next;
    });
  const rename = (id: string, name: string) => {
    const walk = (list: ScenarioNode[]): ScenarioNode[] =>
      list.map((n) => ({ ...n, name: n.id === id ? name : n.name, children: walk(n.children) }));
    setNodes(walk);
  };
  /** Keep only checked nodes; a precondition whose test was dropped is cleared. */
  const selection = (): ScenarioNode[] => {
    const keep = (list: ScenarioNode[]): ScenarioNode[] => {
      const kept = list
        .filter((n) => checked.has(n.id))
        .map((n) => ({ ...n, children: keep(n.children) }));
      return kept.map((n, i) =>
        n.preconditionId && kept[i - 1]?.id !== n.preconditionId
          ? { ...n, preconditionId: null }
          : n,
      );
    };
    return keep(nodes).filter((n) => n.kind !== 'scenario' || n.children.length > 0);
  };
  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const chosen = selection();
      if (reply.parentId && !findNode(project.nodes, reply.parentId))
        throw new Error(t('prop.parentGone'));
      await actions.updateProject({
        nodes: appendChildren(project.nodes, reply.parentId, chosen),
        selectedNodeId: chosen[0]?.id ?? null,
      });
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const render = (n: ScenarioNode, depth: number): React.ReactNode => {
    const Icon = ICON[n.kind];
    return (
      <div key={n.id}>
        <div
          className={`prop-row ${checked.has(n.id) ? '' : 'off'}`}
          style={{ paddingLeft: 6 + depth * 18 }}
        >
          <input
            type="checkbox"
            checked={checked.has(n.id)}
            onChange={(e) => toggle(n, e.target.checked)}
          />
          <Icon size={14} className={`kind-${n.kind}`} />
          <input className="inline" value={n.name} onChange={(e) => rename(n.id, e.target.value)} />
          {n.kind !== 'scenario' && (
            <span className="oses">
              {OS_LIST.map((os) => (
                <span
                  key={os}
                  className={n.variants[os] ? '' : 'miss'}
                  title={n.variants[os] ? osName(os) : t('prop.missing', { os: osName(os) })}
                >
                  <PlatformIcon os={os} size={11} />
                </span>
              ))}
            </span>
          )}
          {n.blocking && <Badge tone="warn">{t('prop.blocking')}</Badge>}
          {n.platforms && <Badge>{n.platforms.map(osName).join(' + ')}</Badge>}
        </div>
        {n.children.map((c) => render(c, depth + 1))}
      </div>
    );
  };
  const count = all.filter((n) => n.kind !== 'scenario' && checked.has(n.id)).length;
  return (
    <Modal
      size="wide"
      title={t('prop.title')}
      icon={<Sparkles size={16} color="var(--accent)" />}
      onClose={onClose}
      footer={
        <>
          <span className="note grow">{t('prop.pending')}</span>
          <Button onClick={onClose}>{t('prop.reject')}</Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={!count || !reply.proposal}
            icon={<CircleCheck size={14} />}
            onClick={accept}
          >
            {t('prop.accept', { n: count })}
          </Button>
        </>
      }
    >
      <div className="stack">
        {error != null && <ErrorNotice error={error} />}
        <div className="row wrap">
          <Badge
            tone={
              reply.quality === 'validated'
                ? 'ok'
                : reply.quality === 'repaired'
                  ? 'accent'
                  : 'warn'
            }
          >
            {reply.quality === 'draft' ? <Wand2 size={11} /> : <CircleCheck size={11} />}{' '}
            {t(`prop.quality.${reply.quality}` as never)}
          </Badge>
          {reply.coverage.map((c) => (
            <Badge key={c.os} tone={c.status === 'explored' ? 'ok' : 'warn'} title={c.note}>
              <PlatformIcon os={c.os} size={11} />{' '}
              {c.status === 'explored' ? t('prop.explored') : t('prop.notExplored')}
            </Badge>
          ))}
          {reply.replay.map((r) => (
            <Badge key={r.platform} tone={TONE[r.status]} title={r.message}>
              <PlatformIcon os={r.platform} size={11} />{' '}
              {r.status === 'passed' ? (
                <CircleCheck size={11} />
              ) : r.status === 'failed' ? (
                <CircleX size={11} />
              ) : null}{' '}
              {t(`prop.replay.${r.status}` as never)}
            </Badge>
          ))}
        </div>
        <div className="prop-summary">{reply.text}</div>
        {failed && (
          <div className="notice warn">
            <AlertTriangle size={16} />
            <div>
              {t('prop.replayFailed')}
              {reply.replay
                .filter((r) => r.status === 'failed')
                .map((r) => (
                  <pre key={r.platform}>
                    {osName(r.platform)} — {r.message}
                  </pre>
                ))}
            </div>
          </div>
        )}
        {reply.quality === 'draft' && (
          <div className="notice warn">
            <Wand2 size={16} />
            <div>{t('prop.draftHint')}</div>
          </div>
        )}
        {reply.warnings.length > 0 && (
          <div className="notice">
            <div className="grow">
              <button className="btn ghost sm" onClick={() => setShowWarnings((v) => !v)}>
                {t('prop.warnings', { n: reply.warnings.length })}
              </button>
              {showWarnings && (
                <ul className="note" style={{ margin: '6px 0 0 18px' }}>
                  {reply.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
        {nodes.length ? (
          <div className="prop-tree">
            <div className="row spread" style={{ padding: '6px 6px 8px' }}>
              <span className="eyebrow">
                {t('prop.steps', { n: all.filter((n) => n.kind !== 'scenario').length })}
              </span>
              <span className="row">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setChecked(new Set(all.map((n) => n.id)))}
                >
                  {t('prop.all')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setChecked(new Set())}>
                  {t('prop.none')}
                </Button>
              </span>
            </div>
            {nodes.map((n) => render(n, 0))}
          </div>
        ) : (
          <div className="empty">{t('prop.none.proposed')}</div>
        )}
      </div>
    </Modal>
  );
}
