import {
  ArrowUp,
  Bot,
  Circle,
  ExternalLink,
  FileUp,
  MessageSquarePlus,
  Sparkles,
  Square,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { findNode, type ScenarioNode } from '../../../shared/domain/scenario';
import type { CreationReply } from '../../../shared/ipc';
import { call } from '../../shared/api';
import { useT } from '../../shared/i18n';
import { Button, IconButton, Segmented, Spinner } from '../../shared/ui/controls';
import { ErrorNotice } from '../../shared/ui/notices';
import { useActions, useActiveDevices, useApp } from '../../app/store';
import { useUi } from '../../app/ui';
import { useWorkbench } from '../devices/workbench';
import { ImportDialog } from './ImportDialog';
import { ProposalReview } from './ProposalReview';
import { RecorderPanel } from './RecorderPanel';

/** AI-assisted creation: describe a journey, import cases, or record on the phone; review before anything is saved. */
export function CreationPanel({ detached }: { detached?: boolean }) {
  const t = useT();
  const { project, settings, provider, aiMessage, recorder } = useApp();
  const actions = useActions();
  const ui = useUi();
  const devices = useActiveDevices();
  const { aiPrefill } = useWorkbench();
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<'chat' | 'record'>('chat');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [reply, setReply] = useState<CreationReply | null>(null);
  const [importing, setImporting] = useState(false);
  const [targetId, setTargetId] = useState<string | null | undefined>(undefined);
  const log = useRef<HTMLDivElement>(null);
  const sessionId = project?.activeChatSessionId ?? undefined;
  const messages = (project?.messages ?? []).filter((m) => m.sessionId === sessionId);
  const selected: ScenarioNode | undefined = project?.selectedNodeId
    ? findNode(project.nodes, project.selectedNodeId)
    : undefined;
  // Insertion parent: the selected scenario/navigation, otherwise its parent; the user can clear it.
  const target =
    targetId === null
      ? undefined
      : targetId
        ? findNode(project?.nodes ?? [], targetId)
        : selected && selected.kind !== 'test' && selected.kind !== 'action'
          ? selected
          : undefined;

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [messages.length, busy]);
  useEffect(() => {
    if (recorder.running) setMode('record');
  }, [recorder.running]);
  useEffect(() => {
    if (aiPrefill) {
      setPrompt(aiPrefill.text);
      setTargetId(aiPrefill.nodeId ?? undefined);
      setMode('chat');
    }
  }, [aiPrefill?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setTargetId(undefined);
  }, [project?.selectedNodeId]);
  useEffect(() => {
    const record = () => setMode('record'),
      imp = () => setImporting(true);
    window.addEventListener('cybermonkey:record', record);
    window.addEventListener('cybermonkey:import', imp);
    return () => {
      window.removeEventListener('cybermonkey:record', record);
      window.removeEventListener('cybermonkey:import', imp);
    };
  }, []);

  const deviceIds = Object.values(devices);
  const ready = !!provider?.authenticated;
  const send = async (text = prompt) => {
    if (!project || !text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await call('creation.ask', {
        projectId: project.id,
        prompt: text.trim(),
        sessionId,
        nodeId: target?.id,
        deviceIds,
      });
      setPrompt('');
      await actions.refreshWorkspace();
      setReply(result);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      actions.setAiMessage('');
    }
  };
  // Prompts coming from imports or "complete the other OS" actions run immediately.
  useEffect(() => {
    ui.runAi = (text, nodeId) => {
      setTargetId(nodeId);
      setPrompt(text);
      void send(text);
    };
  });

  const newSession = () => {
    if (!project) return;
    const session = {
      id: crypto.randomUUID(),
      name: `Session ${project.chatSessions.length + 1}`,
      createdAt: new Date().toISOString(),
    };
    void actions.updateProject({
      chatSessions: [...project.chatSessions, session],
      activeChatSessionId: session.id,
    });
  };
  if (!project || !settings) return null;

  return (
    <div className="ai-panel">
      <div className="panel-head" style={{ height: 40 }}>
        <Sparkles size={15} color="var(--accent)" />
        <span className="grow ellipsis">{t('ai.title')}</span>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            {
              value: 'chat',
              label: (
                <>
                  <Bot size={12} /> {t('ai.mode.chat')}
                </>
              ),
            },
            {
              value: 'record',
              label: (
                <>
                  <Circle size={11} /> {t('ai.mode.record')}
                </>
              ),
            },
          ]}
        />
        {!detached && (
          <IconButton label={t('ai.detach')} onClick={() => void call('ai.detach', true)}>
            <ExternalLink size={14} />
          </IconButton>
        )}
      </div>
      {mode === 'record' ? (
        <div className="scroll grow" style={{ padding: 12 }}>
          <RecorderPanel />
        </div>
      ) : (
        <>
          <div className="chat scroll grow" ref={log}>
            {!messages.length && !busy && (
              <div className="empty note">
                <Sparkles size={20} />
                <span>{t('ai.empty')}</span>
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`msg ${m.role}`}>
                {m.content}
              </div>
            ))}
            {busy && (
              <div className="msg assistant working">
                <Spinner /> <span className="grow">{aiMessage || t('ai.working')}</span>
                <Button
                  size="sm"
                  icon={<Square size={11} />}
                  onClick={() => void call('creation.cancel', project.id)}
                >
                  {t('ai.cancel')}
                </Button>
              </div>
            )}
            {error != null && <ErrorNotice error={error} onAskAi={undefined} />}
          </div>
          {!ready && provider && (
            <div className="notice warn" style={{ margin: '0 12px 8px' }}>
              <TriangleAlert size={16} style={{ marginTop: 2 }} />
              <div className="grow">
                <div className="title">{t('ai.notConnected', { name: provider.provider })}</div>
                <div className="hint">{provider.help ?? provider.message}</div>
              </div>
              <Button size="sm" variant="primary" onClick={() => ui.openSettings('ai')}>
                {t('ai.configure')}
              </Button>
            </div>
          )}
          {deviceIds.length === 0 && (
            <div className="note" style={{ padding: '0 14px 6px', color: 'var(--warn)' }}>
              {t('ai.noDevice')}
            </div>
          )}
          <div className="composer-box">
            {target && (
              <div className="row">
                <span className="chip">
                  {t('ai.under', { name: target.name })}
                  <button onClick={() => setTargetId(null)}>
                    <X size={11} />
                  </button>
                </span>
              </div>
            )}
            <textarea
              rows={2}
              value={prompt}
              placeholder={t('ai.placeholder')}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div className="row wrap">
              <button className="chip clickable" onClick={() => ui.openSettings('ai')}>
                <span className={`dot ${ready ? 'ok' : 'err'}`} />{' '}
                {provider?.provider ?? settings.provider}
                {(settings[`${settings.provider}Model` as 'codexModel'] || t('ai.defaultModel')) &&
                  ` · ${settings[`${settings.provider}Model` as 'codexModel'] || t('ai.defaultModel')}`}
              </button>
              <Segmented
                value={settings.explorationMode}
                onChange={(v) => void actions.saveSettings({ explorationMode: v })}
                options={[
                  {
                    value: 'interactive',
                    label: t('ai.interactive'),
                    title: t('ai.interactiveHint'),
                  },
                  { value: 'auto-approve', label: t('ai.auto'), title: t('ai.autoHint') },
                ]}
              />
              <span className="grow" />
              <Button
                size="sm"
                variant="ghost"
                icon={<FileUp size={13} />}
                onClick={() => setImporting(true)}
              >
                {t('ai.import')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<MessageSquarePlus size={13} />}
                onClick={newSession}
              >
                {t('ai.newSession')}
              </Button>
              <select
                style={{ width: 120 }}
                value={sessionId ?? ''}
                onChange={(e) =>
                  void actions.updateProject({ activeChatSessionId: e.target.value })
                }
              >
                {project.chatSessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <Button
                variant="primary"
                size="sm"
                busy={busy}
                disabled={!prompt.trim() || !deviceIds.length || !ready}
                icon={<ArrowUp size={14} />}
                onClick={() => void send()}
              >
                {t('ai.send')}
              </Button>
            </div>
          </div>
        </>
      )}
      {reply && <ProposalReview reply={reply} onClose={() => setReply(null)} />}
      {importing && (
        <ImportDialog
          onClose={() => setImporting(false)}
          onGenerate={(text) => {
            setPrompt(text);
            void send(text);
          }}
        />
      )}
    </div>
  );
}
