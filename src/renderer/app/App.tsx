import { Settings2, Smartphone, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { call, appVersion, isDesktop } from '../shared/api';
import { Button, IconButton, Segmented } from '../shared/ui/controls';
import { Logo } from '../shared/ui/icons';
import { CreationPanel } from '../features/creation/CreationPanel';
import { QuestionDialog } from '../features/creation/QuestionDialog';
import { IntegrationConfirm } from '../features/settings/IntegrationConfirm';
import { DevicePanel } from '../features/devices/DevicePanel';
import { WorkbenchProvider } from '../features/devices/workbench';
import { ExecutionView } from '../features/execution/ExecutionView';
import { ExecProvider } from '../features/execution/focus';
import { useRun } from '../features/execution/useRun';
import { ProjectDialog } from '../features/projects/ProjectDialog';
import { ProjectSwitcher } from '../features/projects/ProjectSwitcher';
import { NodeEditor } from '../features/scenarios/NodeEditor';
import { ScenarioTree } from '../features/scenarios/ScenarioTree';
import { StepComposer } from '../features/scenarios/StepComposer';
import { SettingsDialog } from '../features/settings/SettingsDialog';
import { EnvironmentBar, VariablesDialog } from '../features/settings/VariablesDialog';
import { findNode, makeNode } from '../../shared/domain/scenario';
import { AppProvider, useActions, useApp } from './store';
import { UiContext, type SettingsTab, type Ui } from './ui';
import { useT } from '../shared/i18n';
import { CreationHome } from './CreationHome';
import { useSplitter } from './useSplitter';

export function App() {
  const view = new URLSearchParams(location.search).get('view');
  return (
    <AppProvider>
      <WorkbenchProvider>
        {view === 'devices' || view === 'ai' ? <DetachedShell kind={view} /> : <Shell />}
      </WorkbenchProvider>
    </AppProvider>
  );
}

/* ---------- detached windows ---------- */
function DetachedShell({ kind }: { kind: 'devices' | 'ai' }) {
  const t = useT();
  const { project, loading } = useApp();
  const ui = useRef<Ui>({
    openSettings() {},
    openProject() {},
    openVariables() {},
    openImport() {},
    runAi() {},
  }).current;
  if (loading) return null;
  return (
    <UiContext.Provider value={ui}>
      <div className="shell aux">
        <div className="titlebar">
          <Logo size={22} />
          <b>{kind === 'devices' ? t('dev.title') : t('ai.title')}</b>
          <span className="title-center">{project?.name}</span>
          <Button
            size="sm"
            onClick={() => void call(kind === 'devices' ? 'devices.detach' : 'ai.detach', false)}
          >
            {t('common.reattach')}
          </Button>
        </div>
        <div className="workspace" style={{ flexDirection: 'column' }}>
          {kind === 'devices' ? (
            <>
              <DevicePanel mode={project?.tab ?? 'creation'} detached />
              <div style={{ padding: 10 }}>
                <StepComposer />
              </div>
            </>
          ) : (
            <CreationPanel detached />
          )}
        </div>
        <QuestionDialog />
      </div>
    </UiContext.Provider>
  );
}

/* ---------- main window ---------- */
function Shell() {
  const t = useT();
  const { project, settings, provider, update, menu, aiMessage, devices, loading } = useApp();
  const actions = useActions();
  const [dialog, setDialog] = useState<
    | { type: 'settings'; tab?: SettingsTab }
    | { type: 'project'; mode: 'new' | 'edit' }
    | { type: 'variables' }
    | null
  >(null);
  const run = useRun();
  const ui = useRef<Ui>({
    openSettings() {},
    openProject() {},
    openVariables() {},
    openImport() {},
    runAi() {},
  }).current;
  ui.openSettings = (tab) => setDialog({ type: 'settings', tab });
  ui.openProject = (mode) => setDialog({ type: 'project', mode });
  ui.openVariables = () => setDialog({ type: 'variables' });
  ui.openImport = () => window.dispatchEvent(new CustomEvent('cybermonkey:import'));

  useEffect(() => {
    if (!menu) return;
    if (menu.action === 'new-project') setDialog({ type: 'project', mode: 'new' });
    else if (menu.action === 'edit-project' && project)
      setDialog({ type: 'project', mode: 'edit' });
    else if (menu.action === 'open-settings') setDialog({ type: 'settings' });
  }, [menu?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  const left = useSplitter('leftWidth', 1, 180, 520);
  const right = useSplitter('rightWidth', -1, 300, 1100);
  const chat = useSplitter('chatHeight', -1, 150, 700, 'y');
  if (loading || !settings) return null;
  const tab = project?.tab ?? 'creation';
  const readyDevices = devices.devices.filter((d) => d.status === 'ready').length;
  const nodesCount = project ? project.nodes.length : 0;

  return (
    <UiContext.Provider value={ui}>
      <ExecProvider>
        <div className="shell">
          <div className="titlebar">
            <div className="brand">
              <Logo />{' '}
              <span>
                cyber<b>monkey</b>
              </span>
              <span className="version">{appVersion}</span>
            </div>
            <ProjectSwitcher />
            {project && (
              <div className="main-tabs">
                <button
                  className={tab === 'creation' ? 'on' : ''}
                  onClick={() => void actions.updateProject({ tab: 'creation' })}
                >
                  <Sparkles size={14} style={{ marginRight: 6 }} />
                  {t('tab.creation')}
                </button>
                <button
                  className={tab === 'execution' ? 'on' : ''}
                  onClick={() => void actions.updateProject({ tab: 'execution' })}
                >
                  ▶ {t('tab.execution')}
                </button>
              </div>
            )}
            <span className="grow" />
            {project && project.platforms.length > 1 && (
              <Segmented
                value={project.focus}
                label={t('focus.label')}
                onChange={(focus) => void actions.updateProject({ focus })}
                options={[
                  { value: 'all', label: 'Android + iOS', title: t('focus.all') },
                  { value: 'android', label: 'Android', title: t('focus.one') },
                  { value: 'ios', label: 'iOS', title: t('focus.one') },
                ]}
              />
            )}
            {project && <EnvironmentBar onManage={() => ui.openVariables()} />}
            <button
              className="ai-chip"
              onClick={() => ui.openSettings('ai')}
              title={provider?.message}
            >
              <span className={`dot ${provider?.authenticated ? 'ok' : 'err'}`} />
              {provider?.authenticated
                ? provider.provider === 'claude'
                  ? 'Claude Code'
                  : provider.provider
                : t('ai.off')}
            </button>
            {update &&
              update.state !== 'idle' &&
              update.state !== 'current' &&
              update.state !== 'checking' &&
              update.state !== 'error' && (
                <button className="update-pill" onClick={() => ui.openSettings('updates')}>
                  {t('upd.pill')}
                </button>
              )}
            {settings.devicesDetached && (
              <IconButton
                label={t('common.reattach')}
                onClick={() => void call('devices.detach', false)}
              >
                <Smartphone size={16} />
              </IconButton>
            )}
            <IconButton label={t('set.title')} onClick={() => ui.openSettings()}>
              <Settings2 size={17} />
            </IconButton>
          </div>
          {!isDesktop && <div className="preview-banner">{t('app.preview')}</div>}
          {!project ? (
            <Welcome />
          ) : (
            <div className="workspace">
              <aside className="sidebar" style={{ width: left.size ?? settings.leftWidth }}>
                <ScenarioTree
                  mode={tab}
                  onRun={
                    tab === 'execution'
                      ? (id) => void run.start({ nodeId: id || undefined })
                      : undefined
                  }
                />
              </aside>
              <div {...left.props} />
              <main className="center">
                {tab === 'creation' ? (
                  <CreationCenter
                    chatHeight={chat.size ?? settings.chatHeight}
                    chatSplit={chat.props}
                  />
                ) : (
                  <ExecutionView run={run} />
                )}
              </main>
              {!settings.devicesDetached && (
                <>
                  <div {...right.props} />
                  <aside className="right" style={{ width: right.size ?? settings.rightWidth }}>
                    <DevicePanel mode={tab} />
                  </aside>
                </>
              )}
            </div>
          )}
          <div className="statusbar">
            <span>
              <span className="dot ok" /> {t('status.local')} ·{' '}
              {t('status.items', { n: nodesCount })}
            </span>
            {aiMessage && (
              <span className="ellipsis" style={{ color: 'var(--accent)' }}>
                {aiMessage}
              </span>
            )}
            <span className="grow" />
            <span>{t('status.devices', { n: readyDevices })}</span>
          </div>
          <QuestionDialog />
          <IntegrationConfirm />
          {dialog?.type === 'settings' && (
            <SettingsDialog initialTab={dialog.tab} onClose={() => setDialog(null)} />
          )}
          {dialog?.type === 'project' && (
            <ProjectDialog mode={dialog.mode} onClose={() => setDialog(null)} />
          )}
          {dialog?.type === 'variables' && <VariablesDialog onClose={() => setDialog(null)} />}
        </div>
      </ExecProvider>
    </UiContext.Provider>
  );
}
function Welcome() {
  const t = useT();
  const actions = useActions();
  const { workspace } = useApp();
  const [open, setOpen] = useState(false);
  return (
    <div className="welcome">
      <Logo size={96} />
      <h1>
        cyber<b>monkey</b>
      </h1>
      <p className="muted">{t('welcome.tagline')}</p>
      <div className="row">
        <Button variant="primary" onClick={() => setOpen(true)}>
          {t('proj.new')}
        </Button>
      </div>
      {!!workspace?.projects.length && <div className="note">{t('welcome.pick')}</div>}
      {open && <ProjectDialog mode="new" onClose={() => setOpen(false)} />}
    </div>
  );
}

function CreationCenter({
  chatHeight,
  chatSplit,
}: {
  chatHeight: number;
  chatSplit: React.HTMLAttributes<HTMLDivElement>;
}) {
  const { project, settings } = useApp();
  const actions = useActions();
  const t = useT();
  const node = useMemo(
    () => (project?.selectedNodeId ? findNode(project.nodes, project.selectedNodeId) : undefined),
    [project],
  );
  if (!project || !settings) return null;
  const crumbs = node ? pathNames(project.nodes, node.id) : [];
  return (
    <>
      <div className="breadcrumb">
        {project.name}
        {crumbs.map((c) => (
          <span key={c}> › {c}</span>
        ))}
      </div>
      <div className="scroll grow editor-area">
        {node ? (
          <NodeEditor key={node.id} node={node} />
        ) : (
          <CreationHome
            onNew={() => {
              const n = makeNode('scenario', t('tree.new.scenario'), []);
              void actions.updateProject({ nodes: [...project.nodes, n], selectedNodeId: n.id });
            }}
          />
        )}
      </div>
      <div className="composer-dock">
        <StepComposer />
      </div>
      {!settings.aiDetached && (
        <>
          <div {...chatSplit} />
          <div style={{ height: chatHeight, flexShrink: 0 }} className="ai-dock">
            <CreationPanel />
          </div>
        </>
      )}
    </>
  );
}
function pathNames(
  nodes: import('../../shared/domain/scenario').ScenarioNode[],
  id: string,
): string[] {
  for (const n of nodes) {
    if (n.id === id) return [n.name];
    const rest = pathNames(n.children, id);
    if (rest.length) return [n.name, ...rest];
  }
  return [];
}
