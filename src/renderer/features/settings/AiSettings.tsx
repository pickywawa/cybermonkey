import { CircleCheck, CircleX, LogIn, LogOut, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  PROVIDERS,
  type Provider,
  type ProviderStatus,
  type Settings,
} from '../../../shared/domain/settings';
import { call } from '../../shared/api';
import { useT } from '../../shared/i18n';
import { Button, Field, Spinner } from '../../shared/ui/controls';
import { ErrorNotice } from '../../shared/ui/notices';
import { useActions, useApp } from '../../app/store';

const NAMES: Record<Provider, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  copilot: 'GitHub Copilot',
};
const MODEL_KEY = { claude: 'claudeModel', codex: 'codexModel', copilot: 'copilotModel' } as const;

/** One card per AI provider: status, login, model and effort; the selected provider drives every AI feature. */
export function AiSettings({
  draft,
  set,
}: {
  draft: Settings;
  set: (p: Partial<Settings>) => void;
}) {
  const t = useT();
  const { login } = useApp();
  const actions = useActions();
  const [status, setStatus] = useState<Partial<Record<Provider, ProviderStatus | 'loading'>>>({});
  const [error, setError] = useState<unknown>(null);
  const refresh = async (p: Provider) => {
    setStatus((s) => ({ ...s, [p]: 'loading' }));
    const next = await actions.refreshProvider(p);
    setStatus((s) => ({ ...s, [p]: next ?? undefined }));
  };
  useEffect(() => {
    for (const p of PROVIDERS) void refresh(p);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (login && !login.running) void refresh(login.provider);
  }, [login?.running]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (fn: () => Promise<unknown>, p: Provider) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e);
    }
    void refresh(p);
  };
  return (
    <div className="stack">
      <p className="note">{t('set.ai.intro')}</p>
      {error != null && <ErrorNotice error={error} />}
      {PROVIDERS.map((p) => {
        const s = status[p];
        const info = s && s !== 'loading' ? s : null;
        const selected = draft.provider === p;
        const model = draft[MODEL_KEY[p]];
        return (
          <section key={p} className={`provider-card ${selected ? 'selected' : ''}`}>
            <div className="row">
              <input type="radio" checked={selected} onChange={() => set({ provider: p })} />
              <b className="grow">{NAMES[p]}</b>
              {s === 'loading' ? (
                <Spinner />
              ) : info?.authenticated ? (
                <span className="badge ok">
                  <CircleCheck size={11} /> {t('set.ai.connected')}
                </span>
              ) : (
                <span className="badge err">
                  <CircleX size={11} />{' '}
                  {info && !info.installed ? t('set.ai.missing') : t('set.ai.disconnected')}
                </span>
              )}
              <Button
                size="sm"
                variant="ghost"
                icon={<RefreshCw size={12} />}
                onClick={() => void refresh(p)}
              />
            </div>
            {info && (
              <p className="note" style={{ margin: '6px 0' }}>
                {info.message}
                {info.account && !info.message.includes(info.account) ? ` · ${info.account}` : ''}
              </p>
            )}
            {info?.help && !info.authenticated && <div className="notice warn">{info.help}</div>}
            {info?.quota && (
              <div className="note">
                {info.quota.label} · {t('set.ai.quota', { n: Math.round(info.quota.usedPercent) })}
              </div>
            )}
            {info?.lastUsage && (
              <div className="note">
                {t('set.ai.usage', {
                  input: info.lastUsage.input.toLocaleString(),
                  output: info.lastUsage.output.toLocaleString(),
                })}
              </div>
            )}
            <div className="row wrap" style={{ marginTop: 8 }}>
              {info?.authenticated ? (
                <Button
                  size="sm"
                  icon={<LogOut size={12} />}
                  onClick={() => void act(() => call('ai.logout', p), p)}
                >
                  {t('set.ai.logout')}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="primary"
                  icon={<LogIn size={12} />}
                  disabled={login?.running}
                  onClick={() => void act(() => call('ai.login', p), p)}
                >
                  {t('set.ai.login')}
                </Button>
              )}
            </div>
            {login?.provider === p && login.output && (
              <pre style={{ maxHeight: 130 }}>{login.output}</pre>
            )}
            {selected && (
              <div className="grid2" style={{ marginTop: 8 }}>
                <Field label={t('set.ai.model')} hint={t('set.ai.modelHint')}>
                  <input
                    list={`models-${p}`}
                    value={model}
                    placeholder={t('ai.defaultModel')}
                    onChange={(e) => set({ [MODEL_KEY[p]]: e.target.value } as Partial<Settings>)}
                  />
                  <datalist id={`models-${p}`}>
                    {info?.models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </datalist>
                </Field>
                <Field label={t('set.ai.effort')}>
                  <select
                    value={draft.reasoningEffort}
                    onChange={(e) =>
                      set({ reasoningEffort: e.target.value as Settings['reasoningEffort'] })
                    }
                  >
                    {(['default', 'low', 'medium', 'high'] as const).map((x) => (
                      <option key={x} value={x}>
                        {t(`set.effort.${x}` as never)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
