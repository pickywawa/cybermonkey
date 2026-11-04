import {
  Check,
  CheckCircle2,
  MousePointerClick,
  Type,
  X,
  EyeOff,
  TextCursorInput,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { deriveScreenDefinition, identifyScreen } from '../../../shared/domain/screens';
import {
  appendChildren,
  findNode,
  insertAfter,
  makeNode,
  makeVariant,
  updateNode,
  type OS,
  type ScenarioNode,
  type Variant,
  isSupportScenario,
} from '../../../shared/domain/scenario';
import { call } from '../../shared/api';
import { useT } from '../../shared/i18n';
import { Button, Check as CheckBox, Spinner } from '../../shared/ui/controls';
import { PlatformIcon, osName } from '../../shared/ui/icons';
import { ErrorNotice } from '../../shared/ui/notices';
import { useToast } from '../../shared/ui/overlays';
import { useActions, useApp } from '../../app/store';
import { useWorkbench } from '../devices/workbench';

/**
 * Manual creation from a phone: pick a component on the mirror, choose what to do with it.
 * The step is created for that OS, optionally executed on the device so the app moves along,
 * and a step added on one OS can be completed by picking the same component on the other OS.
 */
export function StepComposer() {
  const t = useT();
  const toast = useToast();
  const { project } = useApp();
  const actions = useActions();
  const { picked, pick } = useWorkbench();
  const [execute, setExecute] = useState(true);
  const [changesScreen, setChangesScreen] = useState(false);
  const [text, setText] = useState('');
  const [expected, setExpected] = useState('');
  const [mode, setMode] = useState<'type' | 'text' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [last, setLast] = useState<{ id: string; os: OS } | null>(null);
  useEffect(() => {
    setMode(null);
    setError(null);
  }, [picked?.component.id]);
  if (!project || !picked) return null;
  const { component, os, deviceId, screen } = picked;
  const label = component.label || component.text || component.type;
  const selected = project.selectedNodeId
    ? findNode(project.nodes, project.selectedNodeId)
    : undefined;
  const lastNode = last ? findNode(project.nodes, last.id) : undefined;
  const completeLast = !!lastNode && !lastNode.variants[os] && last!.os !== os;

  const insert = (nodes: ScenarioNode[], node: ScenarioNode): ScenarioNode[] | null => {
    if (selected?.kind === 'scenario') return appendChildren(nodes, selected.id, [node]);
    if (selected) return insertAfter(nodes, selected.id, node);
    const scenario = nodes.filter((n) => !isSupportScenario(n)).at(-1);
    return scenario ? appendChildren(nodes, scenario.id, [node]) : null;
  };
  const create = async (kind: 'action' | 'test', variant: Variant) => {
    setBusy(true);
    setError(null);
    try {
      const node = makeNode(kind, name(kind, variant), []);
      node.variants[os] = variant;
      if (execute && kind === 'action') {
        await call('devices.perform', { deviceId, projectId: project.id, variant, kind: 'action' });
        if (changesScreen) {
          await new Promise((r) => setTimeout(r, 900));
          const after = await call('devices.inspect', deviceId);
          const known = identifyScreen(after, os, project.nodes);
          const def = known.identified
            ? undefined
            : deriveScreenDefinition(after, os, t('comp.screenName', { name: label }));
          if (def || known.identified) {
            node.kind = 'navigation';
            node.screen =
              def ??
              project.nodes
                .flatMap(function all(n): ScenarioNode[] {
                  return [n, ...n.children.flatMap(all)];
                })
                .find((n) => n.screen?.id === known.id)?.screen;
          }
        }
      }
      const nodes = insert(project.nodes, node);
      if (!nodes) throw new Error(t('comp.needScenario'));
      await actions.updateProject({ nodes, selectedNodeId: node.id });
      setLast({ id: node.id, os });
      pick(null);
      setMode(null);
      setText('');
      setExpected('');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const name = (kind: 'action' | 'test', v: Variant) =>
    kind === 'test'
      ? t('comp.check', { name: label })
      : v.operation === 'type'
        ? t('comp.typeIn', { name: label })
        : t('comp.tapOn', { name: label });
  const base = makeVariant({ locator: component.locator, hint: label });
  const assertion = (a: Variant['assertion'], expectedText = '') =>
    create('test', { ...base, operation: 'assert', assertion: a, expected: expectedText });

  return (
    <div className="composer">
      <div className="row">
        <PlatformIcon os={os} />
        <b className="grow ellipsis">{label}</b>
        <span className="note">{component.type.replace(/^XCUIElementType/, '')}</span>
        <Button size="sm" variant="ghost" onClick={() => pick(null)}>
          <X size={13} />
        </Button>
      </div>
      {error != null && <ErrorNotice error={error} />}
      {completeLast ? (
        <div className="notice">
          <div className="grow">
            {t('comp.completeLast', { os: osName(os), name: lastNode!.name })}
          </div>
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              void actions.updateProject({
                nodes: updateNode(project.nodes, last!.id, (n) => ({
                  ...n,
                  variants: {
                    ...n.variants,
                    [os]: {
                      ...(n.variants[last!.os] ?? base),
                      ...base,
                      operation: n.variants[last!.os]?.operation ?? 'tap',
                      value: n.variants[last!.os]?.value ?? '',
                    },
                  },
                })),
              });
              toast(t('comp.completed'), 'ok');
              setLast(null);
              pick(null);
            }}
          >
            {t('comp.bind')}
          </Button>
        </div>
      ) : null}
      {mode === null ? (
        <div className="row wrap">
          <Button
            size="sm"
            busy={busy}
            icon={<MousePointerClick size={13} />}
            onClick={() => create('action', { ...base, operation: 'tap' })}
          >
            {t('op.tap')}
          </Button>
          <Button size="sm" icon={<TextCursorInput size={13} />} onClick={() => setMode('type')}>
            {t('op.type')}…
          </Button>
          <Button
            size="sm"
            busy={busy}
            icon={<CheckCircle2 size={13} />}
            onClick={() => assertion('visible')}
          >
            {t('as.visible')}
          </Button>
          <Button
            size="sm"
            icon={<Type size={13} />}
            onClick={() => {
              setMode('text');
              setExpected(component.text || component.label);
            }}
          >
            {t('as.text')}…
          </Button>
          <Button
            size="sm"
            busy={busy}
            icon={<EyeOff size={13} />}
            onClick={() => assertion('absent')}
          >
            {t('as.absent')}
          </Button>
        </div>
      ) : mode === 'type' ? (
        <div className="row">
          <input
            autoFocus
            className="mono"
            placeholder={'${VARIABLE} ' + t('comp.orText')}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Button
            size="sm"
            variant="primary"
            busy={busy}
            icon={<Check size={13} />}
            onClick={() => create('action', { ...base, operation: 'type', value: text })}
          >
            OK
          </Button>
        </div>
      ) : (
        <div className="row">
          <input autoFocus value={expected} onChange={(e) => setExpected(e.target.value)} />
          <Button
            size="sm"
            variant="primary"
            busy={busy}
            icon={<Check size={13} />}
            onClick={() => assertion('text', expected)}
          >
            OK
          </Button>
        </div>
      )}
      <div className="row wrap">
        <CheckBox checked={execute} onChange={setExecute}>
          {t('comp.execute')}
        </CheckBox>
        <CheckBox checked={changesScreen} disabled={!execute} onChange={setChangesScreen}>
          {t('comp.changesScreen')}
        </CheckBox>
        {busy && <Spinner />}
      </div>
      <span className="note">
        {screen.components.length} {t('comp.count')} ·{' '}
        {selected ? t('comp.after', { name: selected.name }) : t('comp.atEnd')}
      </span>
    </div>
  );
}
