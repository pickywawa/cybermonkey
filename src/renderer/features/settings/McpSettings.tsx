import { Copy, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Settings } from '../../../shared/domain/settings';
import { MCP_GROUPS, MCP_TOOLS, type McpStatus } from '../../../shared/mcp';
import { call } from '../../shared/api';
import { useT } from '../../shared/i18n';
import { Button, Check, Field } from '../../shared/ui/controls';
import { useApp } from '../../app/store';

const num = (v: string, fallback: number) =>
  Number.isFinite(Number(v)) && v !== ''
    ? Math.max(1024, Math.min(65535, Math.round(Number(v))))
    : fallback;

function Copyable({ text, label }: { text: string; label: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row">
        <b className="grow">{label}</b>
        <Button
          size="sm"
          icon={<Copy size={12} />}
          onClick={() => {
            void navigator.clipboard?.writeText(text);
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          }}
        >
          {done ? t('mcp.copied') : t('mcp.copy')}
        </Button>
      </div>
      <pre className="mono mcp-code">{text}</pre>
    </div>
  );
}

/** Built-in MCP server: on/off, port, token, connection snippets and per-tool switches grouped by purpose. */
export function McpSettings({
  draft,
  set,
}: {
  draft: Settings;
  set: (p: Partial<Settings>) => void;
}) {
  const t = useT();
  const { settings } = useApp();
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const poll = () =>
      void call('mcp.status')
        .then((s) => alive && setStatus(s))
        .catch(() => {});
    poll();
    const timer = setInterval(poll, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const token = settings?.mcpToken ?? draft.mcpToken;
  const url = status?.url ?? `http://127.0.0.1:${draft.mcpPort}/mcp`;
  const disabled = new Set(draft.mcpDisabledTools);
  const toggle = (names: string[], on: boolean) => {
    const next = new Set(disabled);
    for (const n of names) on ? next.delete(n) : next.add(n);
    set({ mcpDisabledTools: [...next] });
  };
  const fr = draft.language === 'fr';
  const cli = `claude mcp add --transport http cybermonkey ${url} --header "Authorization: Bearer ${token}"`;
  const json = JSON.stringify(
    {
      mcpServers: {
        cybermonkey: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } },
      },
    },
    null,
    2,
  );
  return (
    <div className="stack">
      <Check checked={draft.mcpEnabled} onChange={(v) => set({ mcpEnabled: v })}>
        {t('mcp.enable')}
      </Check>
      <span className="note">{t('mcp.enableHint')}</span>
      <div className="row">
        {status?.running ? (
          <span className="badge ok">{t('mcp.running', { port: status.port })}</span>
        ) : status?.error ? (
          <span className="badge err">{status.error}</span>
        ) : (
          <span className="badge">{t('mcp.stopped')}</span>
        )}
        {status && status.running && (
          <span className="note">
            {t('mcp.stats', { tools: status.tools, calls: status.calls })}
            {status.last ? ` · ${status.last.tool}${status.last.ok ? '' : ' ✗'}` : ''}
          </span>
        )}
      </div>
      <div className="grid2">
        <Field label={t('mcp.port')} hint={t('mcp.portHint')}>
          <input
            type="number"
            min={1024}
            max={65535}
            value={draft.mcpPort}
            onChange={(e) => set({ mcpPort: num(e.target.value, draft.mcpPort) })}
          />
        </Field>
        <Field label={t('mcp.token')} hint={t('mcp.tokenHint')}>
          <div className="row">
            <input
              className="grow mono"
              readOnly
              value={token}
              onFocus={(e) => e.target.select()}
            />
            <Button
              size="sm"
              icon={<RefreshCw size={12} />}
              busy={busy}
              onClick={async () => {
                if (!confirm(t('mcp.regenerateConfirm'))) return;
                setBusy(true);
                try {
                  await call('mcp.regenerateToken');
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t('mcp.regenerate')}
            </Button>
          </div>
        </Field>
      </div>
      <span className="note">{t('mcp.applyHint')}</span>

      <b>{t('mcp.connect')}</b>
      <Copyable label="Claude Code" text={cli} />
      <Copyable label="JSON (Claude Desktop, Cursor, …)" text={json} />

      <b>{t('mcp.tools')}</b>
      <span className="note">{t('mcp.toolsHint')}</span>
      {MCP_GROUPS.map((group) => {
        const tools = MCP_TOOLS.filter((x) => x.group === group);
        const names = tools.map((x) => x.name);
        const on = names.filter((n) => !disabled.has(n)).length;
        return (
          <div key={group} className="mcp-group">
            <Check checked={on === names.length} onChange={(v) => toggle(names, v)}>
              <b>{t(`mcp.group.${group}` as never)}</b>{' '}
              <span className="note">
                {on}/{names.length}
              </span>
            </Check>
            <div className="mcp-tools">
              {tools.map((x) => (
                <Check
                  key={x.name}
                  checked={!disabled.has(x.name)}
                  onChange={(v) => toggle([x.name], v)}
                >
                  <span className="mono">{x.name}</span>
                  <span className="note"> — {fr ? x.fr : x.en}</span>
                </Check>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
