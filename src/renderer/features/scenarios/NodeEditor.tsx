import {
  Compass,
  Layers,
  MousePointerClick,
  ShieldCheck,
  Sparkles,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useState } from 'react';
import {
  OS_LIST,
  callersOf,
  coverage,
  flatten,
  nodePath,
  removeNode,
  updateNode,
  type NodeKind,
  type OS,
  type ScenarioNode,
} from '../../../shared/domain/scenario';
import { useT } from '../../shared/i18n';
import { Badge, Button, Check, Field } from '../../shared/ui/controls';
import { PlatformIcon, osName } from '../../shared/ui/icons';
import { useActions, useApp } from '../../app/store';
import { useWorkbench } from '../devices/workbench';
import { ScreenIdentityEditor } from './ScreenIdentityEditor';
import { CallEditor, ConditionEditor, DatasetEditor, HandlerEditor } from './LogicEditor';
import { VariantEditor } from './VariantEditor';

const ICON: Record<NodeKind, typeof Layers> = {
  scenario: Layers,
  navigation: Compass,
  action: MousePointerClick,
  test: ShieldCheck,
};

export function NodeEditor({ node }: { node: ScenarioNode }) {
  const t = useT();
  const { project, projectOs } = useApp();
  const actions = useActions();
  const { prefillAi } = useWorkbench();
  const [tag, setTag] = useState('');
  if (!project) return null;
  const path = nodePath(project.nodes, node.id);
  const parent = path.at(-2);
  const siblings = parent ? parent.children : project.nodes;
  const index = siblings.findIndex((n) => n.id === node.id);
  const previous = index > 0 ? siblings[index - 1] : undefined;
  const patch = (p: Partial<ScenarioNode>) =>
    void actions.updateProject({ nodes: updateNode(project.nodes, node.id, p) });
  const isStep = node.kind !== 'scenario';
  const cov = coverage(node, project.platforms);
  const Icon = ICON[node.kind];
  const applies = node.platforms ?? [...project.platforms];

  const setApplies = (os: OS, on: boolean) => {
    const next = on ? [...new Set([...applies, os])] : applies.filter((o) => o !== os);
    if (!next.length) return;
    patch({ platforms: next.length === project.platforms.length ? undefined : next });
  };

  return (
    <div className="node-editor">
      <div className="row spread">
        <Badge tone="accent">
          <Icon size={12} /> {t(`kind.${node.kind}` as never)}
        </Badge>
        {node.source && (
          <Badge title={node.source.title}>
            {node.source.tool}:{node.source.id}
          </Badge>
        )}
        {node.preparation && <Badge>{t('ed.preparation')}</Badge>}
        <span className="grow" />
        <Button
          variant="danger"
          size="sm"
          icon={<Trash2 size={13} />}
          onClick={() => {
            const callers = callersOf(project.nodes, node.id);
            if (callers.length)
              return void alert(
                t('logic.cannotDelete', { names: callers.map((c) => c.name).join(', ') }),
              );
            if (confirm(t('tree.confirmDelete', { name: node.name })))
              void actions.updateProject({
                nodes: removeNode(project.nodes, node.id),
                selectedNodeId: null,
              });
          }}
        >
          {t('tree.delete')}
        </Button>
      </div>
      <Field label={t('ed.name')}>
        <input
          value={node.name}
          maxLength={180}
          onChange={(e) => patch({ name: e.target.value })}
        />
      </Field>
      {!isStep && (
        <Field label={t('node.module')} hint={t('node.moduleHint')}>
          <input
            list="known-modules"
            value={node.module ?? ''}
            placeholder={t('node.modulePlaceholder')}
            maxLength={80}
            onChange={(e) => patch({ module: e.target.value.trim() ? e.target.value : undefined })}
          />
          <datalist id="known-modules">
            {[...new Set(project.nodes.map((n) => n.module).filter((m): m is string => !!m))].map(
              (m) => (
                <option key={m} value={m} />
              ),
            )}
          </datalist>
        </Field>
      )}
      <Field label={t('ed.description')}>
        <textarea
          rows={2}
          value={node.description}
          onChange={(e) => patch({ description: e.target.value })}
        />
      </Field>
      <Field label={t('ed.tags')}>
        <div className="row wrap">
          {node.tags.map((x) => (
            <Badge key={x}>
              {x}
              <button
                className="icon-btn"
                style={{ width: 14, height: 14 }}
                onClick={() => patch({ tags: node.tags.filter((y) => y !== x) })}
              >
                <X size={10} />
              </button>
            </Badge>
          ))}
          <input
            style={{ width: 140 }}
            list="tag-catalogue"
            placeholder={t('ed.newTag')}
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && tag.trim()) {
                patch({ tags: [...new Set([...node.tags, tag.trim()])] });
                setTag('');
              }
            }}
          />
          <datalist id="tag-catalogue">
            {project.tags.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
        </div>
      </Field>

      {isStep && (
        <div className="grid2">
          <Field label={t('ed.precondition')} hint={t('ed.preconditionHint')}>
            <select
              value={node.preconditionId ?? ''}
              onChange={(e) => patch({ preconditionId: e.target.value || null })}
            >
              <option value="">{t('ed.none')}</option>
              {previous?.kind === 'test' && <option value={previous.id}>{previous.name}</option>}
            </select>
          </Field>
          <div className="stack" style={{ gap: 6, justifyContent: 'flex-end' }}>
            <Check
              checked={node.childrenOnPreconditionFailure}
              onChange={(v) => patch({ childrenOnPreconditionFailure: v })}
            >
              {t('ed.childrenOnFailure')}
            </Check>
          </div>
        </div>
      )}
      <Check checked={node.blocking} onChange={(v) => patch({ blocking: v })}>
        {t('ed.blocking')}
      </Check>

      {project.platforms.length > 1 && (
        <Field label={t('ed.appliesTo')} hint={t('ed.appliesToHint')}>
          <div className="row">
            {OS_LIST.filter((o) => project.platforms.includes(o)).map((os) => (
              <Check key={os} checked={applies.includes(os)} onChange={(v) => setApplies(os, v)}>
                <span className="row" style={{ gap: 4 }}>
                  <PlatformIcon os={os} /> {osName(os)}
                </span>
              </Check>
            ))}
          </div>
        </Field>
      )}

      <ConditionEditor node={node} oses={project.platforms} onChange={(when) => patch({ when })} />
      {node.kind === 'action' && (
        <CallEditor
          node={node}
          scenarios={project.nodes.filter((n) => !n.preparation && n.id !== path[0]?.id)}
          onChange={(call) => patch({ call, variants: call ? {} : node.variants })}
        />
      )}
      {node.kind === 'scenario' && (
        <DatasetEditor node={node} onChange={(dataset) => patch({ dataset })} />
      )}
      {node.kind === 'scenario' && (
        <HandlerEditor
          node={node}
          oses={project.platforms}
          onChange={(handler) => patch({ handler })}
        />
      )}

      {isStep && !node.call && cov.missing.length > 0 && (
        <div className="notice warn">
          <TriangleAlert size={16} style={{ marginTop: 2 }} />
          <div className="grow">
            <div className="title">{t('ed.gap', { os: cov.missing.map(osName).join(', ') })}</div>
            <div className="hint">{t('ed.gapHint')}</div>
          </div>
          <Button
            size="sm"
            icon={<Sparkles size={13} />}
            onClick={() =>
              prefillAi(
                t('ed.gapPrompt', { name: node.name, os: cov.missing.map(osName).join(', ') }),
                parent?.id ?? node.id,
              )
            }
          >
            {t('ed.gapAi')}
          </Button>
        </div>
      )}

      {isStep && !node.call && (
        <div className="stack">
          {OS_LIST.filter((o) => projectOs.includes(o) || node.variants[o])
            .filter((o) => applies.includes(o))
            .map((os) => (
              <VariantEditor
                key={os}
                os={os}
                kind={node.kind}
                variant={node.variants[os]}
                onChange={(v) => patch({ variants: { ...node.variants, [os]: v } })}
              />
            ))}
        </div>
      )}
      {node.kind === 'navigation' && (
        <ScreenIdentityEditor
          title={t('ed.destination')}
          value={node.screen}
          oses={project.platforms}
          onChange={(v) => patch({ screen: v })}
        />
      )}
      {node.kind === 'scenario' && (
        <ScreenIdentityEditor
          title={t('ed.startScreen')}
          value={node.startScreen}
          oses={project.platforms}
          onChange={(v) => patch({ startScreen: v })}
        />
      )}
      {node.kind === 'scenario' && (
        <p className="note">{t('ed.scenarioStats', { n: flatten(node.children).length })}</p>
      )}
    </div>
  );
}
