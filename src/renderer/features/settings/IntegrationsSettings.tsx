import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  PROGRESS_STEPS,
  type GitInfo,
  type IntegrationSettings,
  type IntegrationStatus,
  type SecretKey,
  type TestTarget,
} from '../../../shared/domain/integrations';
import type { Settings } from '../../../shared/domain/settings';
import { call } from '../../shared/api';
import { useT, type TFn } from '../../shared/i18n';
import { Badge, Button, Check, Field, Segmented } from '../../shared/ui/controls';

const envName = (key: SecretKey) => 'CYBERMONKEY_' + key.replace(/([A-Z])/g, '_$1').toUpperCase();
const num = (v: string, min: number, max: number, fallback: number) =>
  Number.isFinite(Number(v)) && v !== ''
    ? Math.max(min, Math.min(max, Math.round(Number(v))))
    : fallback;

export function Card({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="int-card">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

/** A token / webhook: saved on its own (never part of the settings), shown only as set / not set. */
export function SecretField({
  name,
  label,
  status,
  onChange,
  hint,
}: {
  name: SecretKey;
  label: string;
  status: IntegrationStatus | null;
  onChange: (s: IntegrationStatus) => void;
  hint?: string;
}) {
  const t = useT();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const isSet = !!status?.secrets[name];
  const save = async (v: string | null) => {
    setBusy(true);
    try {
      onChange(await call('integrations.setSecret', { key: name, value: v }));
      setValue('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Field
      label={
        <>
          {label}{' '}
          <Badge tone={isSet ? 'ok' : undefined}>
            {t(isSet ? 'int.secret.set' : 'int.secret.unset')}
          </Badge>
        </>
      }
      hint={[hint, t('int.secret.note', { env: envName(name) })].filter(Boolean).join(' ')}
    >
      <div className="row">
        <input
          className="grow mono"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={isSet ? '••••••••' : ''}
          onChange={(e) => setValue(e.target.value)}
        />
        <Button size="sm" busy={busy} disabled={!value.trim()} onClick={() => save(value)}>
          {isSet ? t('int.secret.replace') : t('int.secret.save')}
        </Button>
        {isSet && (
          <Button size="sm" variant="ghost" busy={busy} onClick={() => save(null)}>
            {t('int.secret.clear')}
          </Button>
        )}
      </div>
    </Field>
  );
}

function TestButton({ target, config }: { target: TestTarget; config: IntegrationSettings }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <div className="row">
      <Button
        size="sm"
        busy={busy}
        onClick={async () => {
          setBusy(true);
          setResult(null);
          try {
            setResult(await call('integrations.test', { target, config }));
          } catch (e) {
            setResult({ ok: false, message: String((e as Error).message ?? e) });
          } finally {
            setBusy(false);
          }
        }}
      >
        {t('int.test')}
      </Button>
      {result && (
        <span className={`note ${result.ok ? 'int-ok' : 'int-bad'}`}>
          {result.ok ? '✔ ' : '✘ '}
          {result.message}
        </span>
      )}
    </div>
  );
}

const ModePicker = ({
  value,
  onChange,
  t,
}: {
  value: 'off' | 'ask' | 'auto';
  onChange: (v: 'off' | 'ask' | 'auto') => void;
  t: TFn;
}) => (
  <Field label={t('int.mode')} hint={t('int.mode.askHint')}>
    <Segmented
      value={value}
      onChange={onChange}
      options={[
        { value: 'off', label: t('int.mode.off') },
        { value: 'ask', label: t('int.mode.ask') },
        { value: 'auto', label: t('int.mode.auto') },
      ]}
    />
  </Field>
);

function GitSection({
  draft,
  setGit,
  path,
}: {
  draft: IntegrationSettings['git'];
  setGit: (p: Partial<IntegrationSettings['git']>) => void;
  path: string;
}) {
  const t = useT();
  const [info, setInfo] = useState<GitInfo | null>(null);
  const [note, setNote] = useState('');
  useEffect(() => {
    setInfo(null);
    const timer = setTimeout(() => {
      void call('integrations.gitInfo', { path })
        .then(setInfo)
        .catch(() => setInfo({ isRepo: false }));
    }, 400);
    return () => clearTimeout(timer);
  }, [path]);
  const usable = !!info?.isRepo;
  return (
    <Card title={t('int.git')}>
      <span className="note">{t('int.git.intro')}</span>
      {!info && <span className="note">{t('int.git.checking')}</span>}
      {info && !info.isRepo && (
        <span className="note int-warn">{info.error ?? t('int.git.notRepo')}</span>
      )}
      {info?.isRepo && (
        <div className="stack" style={{ gap: 2 }}>
          <span>
            <Badge tone="ok">{t('int.git.repo')}</Badge> <span className="mono">{info.root}</span>
          </span>
          <span className="note">
            {info.upstream
              ? t('int.git.branch', { branch: info.branch ?? '?', upstream: info.upstream })
              : t('int.git.noUpstream', { branch: info.branch ?? '?' })}
            {' · '}
            {t('int.git.state', {
              changes: info.changes ?? 0,
              ahead: info.ahead ?? 0,
              behind: info.behind ?? 0,
            })}
          </span>
          {!!info.ahead && !!info.behind && (
            <span className="note int-warn">{t('int.git.diverged')}</span>
          )}
        </div>
      )}
      <Check
        checked={draft.pullOnStart}
        disabled={!usable}
        onChange={(v) => setGit({ pullOnStart: v })}
      >
        {t('int.git.pullStart')}
      </Check>
      <Check
        checked={draft.pushOnChange}
        disabled={!usable}
        onChange={(v) => setGit({ pushOnChange: v })}
      >
        {t('int.git.pushChange')}
      </Check>
      <Check
        checked={draft.pushOnRun}
        disabled={!usable}
        onChange={(v) => setGit({ pushOnRun: v })}
      >
        {t('int.git.pushRun')}
      </Check>
      <Check
        checked={draft.includeMedia}
        disabled={!usable}
        onChange={(v) => setGit({ includeMedia: v })}
      >
        {t('int.git.media')}
      </Check>
      <div className="grid2">
        <Field label={t('int.git.pullEvery')}>
          <input
            type="number"
            min={0}
            max={1440}
            value={draft.pullEveryMinutes}
            disabled={!usable}
            onChange={(e) =>
              setGit({ pullEveryMinutes: num(e.target.value, 0, 1440, draft.pullEveryMinutes) })
            }
          />
        </Field>
        <Field label={t('int.git.delay')}>
          <input
            type="number"
            min={10}
            max={3600}
            value={draft.delaySeconds}
            disabled={!usable}
            onChange={(e) =>
              setGit({ delaySeconds: num(e.target.value, 10, 3600, draft.delaySeconds) })
            }
          />
        </Field>
      </div>
      <Field label={t('int.git.message')} hint={t('int.git.messageHint')}>
        <input
          value={draft.commitMessage}
          maxLength={200}
          disabled={!usable}
          onChange={(e) => setGit({ commitMessage: e.target.value })}
        />
      </Field>
      <span className="note int-warn">{t('int.git.secrets')}</span>
      <div className="row">
        <Button
          size="sm"
          disabled={!usable}
          onClick={() =>
            void call('integrations.gitSync', { action: 'pull' }).then(() =>
              setNote(t('int.git.checked')),
            )
          }
        >
          {t('int.git.pullNow')}
        </Button>
        <Button
          size="sm"
          disabled={!usable}
          onClick={() =>
            void call('integrations.gitSync', { action: 'push' }).then(() =>
              setNote(t('int.git.checked')),
            )
          }
        >
          {t('int.git.pushNow')}
        </Button>
        {note && <span className="note">{note}</span>}
      </div>
    </Card>
  );
}

export function IntegrationsSettings({
  draft,
  set,
}: {
  draft: Settings;
  set: (p: Partial<Settings>) => void;
}) {
  const t = useT();
  const cfg = draft.integrations;
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const poll = () =>
      void call('integrations.status')
        .then((s) => alive.current && setStatus(s))
        .catch(() => {});
    poll();
    const timer = setInterval(poll, 3000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, []);

  const setI = (p: Partial<IntegrationSettings>) => set({ integrations: { ...cfg, ...p } });
  const n = cfg.notifications;
  const setN = (p: Partial<typeof n>) => setI({ notifications: { ...n, ...p } });
  const tr = cfg.trackers;
  const setT = (p: Partial<typeof tr>) => setI({ trackers: { ...tr, ...p } });
  const tk = cfg.tickets;
  const setK = (p: Partial<typeof tk>) => setI({ tickets: { ...tk, ...p } });
  const secret = (name: SecretKey, label: string, hint?: string) => (
    <SecretField name={name} label={label} status={status} onChange={setStatus} hint={hint} />
  );
  const text = (
    value: string,
    onChange: (v: string) => void,
    extra: { placeholder?: string; mono?: boolean } = {},
  ) => (
    <input
      value={value}
      className={extra.mono ? 'mono' : ''}
      placeholder={extra.placeholder}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
    />
  );

  return (
    <div className="stack">
      <span className="note">{t('int.intro')}</span>

      <GitSection
        draft={cfg.git}
        setGit={(p) => setI({ git: { ...cfg.git, ...p } })}
        path={draft.projectsDirectory}
      />

      <Card title={t('int.n')}>
        <span className="note">{t('int.n.intro')}</span>

        <Check checked={n.slack.enabled} onChange={(v) => setN({ slack: { enabled: v } })}>
          <b>{t('int.n.slack')}</b>
        </Check>
        {n.slack.enabled && (
          <div className="stack int-indent">
            {secret('slackWebhook', t('int.n.webhook'), t('int.n.slackHint'))}
            <TestButton target="slack" config={cfg} />
          </div>
        )}

        <Check checked={n.teams.enabled} onChange={(v) => setN({ teams: { enabled: v } })}>
          <b>{t('int.n.teams')}</b>
        </Check>
        {n.teams.enabled && (
          <div className="stack int-indent">
            {secret('teamsWebhook', t('int.n.webhook'), t('int.n.teamsHint'))}
            <TestButton target="teams" config={cfg} />
          </div>
        )}

        <Check
          checked={n.email.enabled}
          onChange={(v) => setN({ email: { ...n.email, enabled: v } })}
        >
          <b>{t('int.n.email')}</b>
        </Check>
        {n.email.enabled && (
          <div className="stack int-indent">
            <div className="grid2">
              <Field label={t('int.n.host')}>
                {text(n.email.host, (host) => setN({ email: { ...n.email, host } }), {
                  placeholder: 'smtp.example.com',
                })}
              </Field>
              <Field label={t('int.n.port')}>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={n.email.port}
                  onChange={(e) =>
                    setN({
                      email: { ...n.email, port: num(e.target.value, 1, 65535, n.email.port) },
                    })
                  }
                />
              </Field>
              <Field label={t('int.n.security')}>
                <select
                  value={n.email.security}
                  onChange={(e) =>
                    setN({
                      email: { ...n.email, security: e.target.value as typeof n.email.security },
                    })
                  }
                >
                  <option value="starttls">{t('int.n.sec.starttls')}</option>
                  <option value="tls">{t('int.n.sec.tls')}</option>
                  <option value="none">{t('int.n.sec.none')}</option>
                </select>
              </Field>
              <Field label={t('int.n.user')}>
                {text(n.email.username, (username) => setN({ email: { ...n.email, username } }))}
              </Field>
              <Field label={t('int.n.from')}>
                {text(n.email.from, (from) => setN({ email: { ...n.email, from } }), {
                  placeholder: 'Cybermonkey <qa@example.com>',
                })}
              </Field>
              <Field label={t('int.n.to')} hint={t('int.n.toHint')}>
                {text(n.email.to, (to) => setN({ email: { ...n.email, to } }), {
                  placeholder: 'team@example.com',
                })}
              </Field>
            </div>
            {secret('smtpPassword', t('int.n.password'))}
            <TestButton target="email" config={cfg} />
          </div>
        )}

        <b>{t('int.n.events')}</b>
        <Check
          checked={n.events.regression}
          onChange={(v) => setN({ events: { ...n.events, regression: v } })}
        >
          {t('int.n.ev.regression')}
        </Check>
        <span className="note int-indent">{t('int.n.regressionHint')}</span>
        <Check
          checked={n.events.stepFailed}
          onChange={(v) => setN({ events: { ...n.events, stepFailed: v } })}
        >
          {t('int.n.ev.stepFailed')}
        </Check>
        <Check
          checked={n.events.progress}
          onChange={(v) => setN({ events: { ...n.events, progress: v } })}
        >
          {t('int.n.ev.progress')}
        </Check>
        <Check
          checked={n.events.runFinished}
          onChange={(v) => setN({ events: { ...n.events, runFinished: v } })}
        >
          {t('int.n.ev.runFinished')}
        </Check>
        <div className="grid2">
          <Field label={t('int.n.step')}>
            <select
              value={n.progressStep}
              disabled={!n.events.progress}
              onChange={(e) => setN({ progressStep: Number(e.target.value) })}
            >
              {PROGRESS_STEPS.map((s) => (
                <option key={s} value={s}>
                  {s} %
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('int.n.max')}>
            <input
              type="number"
              min={1}
              max={50}
              value={n.maxFailuresPerRun}
              disabled={!n.events.stepFailed}
              onChange={(e) =>
                setN({ maxFailuresPerRun: num(e.target.value, 1, 50, n.maxFailuresPerRun) })
              }
            />
          </Field>
        </div>
        <b>{t('int.n.include')}</b>
        <Check
          checked={n.include.analysis}
          onChange={(v) => setN({ include: { ...n.include, analysis: v } })}
        >
          {t('int.n.inc.analysis')}
        </Check>
        <Check
          checked={n.include.screenshot}
          onChange={(v) => setN({ include: { ...n.include, screenshot: v } })}
        >
          {t('int.n.inc.screenshot')}
        </Check>
        <Check
          checked={n.include.video}
          onChange={(v) => setN({ include: { ...n.include, video: v } })}
        >
          {t('int.n.inc.video')}
        </Check>
        <span className="note">{t('int.n.mediaNote')}</span>
      </Card>

      <Card title={t('int.t')}>
        <span className="note">{t('int.t.intro')}</span>
        <ModePicker value={tr.mode} onChange={(mode) => setT({ mode })} t={t} />
        {tr.mode !== 'off' && (
          <>
            <Field label={t('int.t.kind')}>
              <Segmented
                value={tr.kind}
                onChange={(kind) => setT({ kind })}
                options={[
                  { value: 'testrail', label: 'TestRail' },
                  { value: 'azure', label: 'Azure Test Plans' },
                ]}
              />
            </Field>
            <span className="note">{t('int.t.squash')}</span>
            {tr.kind === 'testrail' ? (
              <div className="stack">
                <div className="grid2">
                  <Field label={t('int.t.url')}>
                    {text(tr.testrail.url, (url) => setT({ testrail: { ...tr.testrail, url } }), {
                      placeholder: 'https://société.testrail.io',
                    })}
                  </Field>
                  <Field label={t('int.t.user')}>
                    {text(tr.testrail.username, (username) =>
                      setT({ testrail: { ...tr.testrail, username } }),
                    )}
                  </Field>
                  <Field label={t('int.t.projectId')}>
                    {text(tr.testrail.projectId, (projectId) =>
                      setT({ testrail: { ...tr.testrail, projectId } }),
                    )}
                  </Field>
                  <Field label={t('int.t.suiteOpt')}>
                    {text(tr.testrail.suiteId, (suiteId) =>
                      setT({ testrail: { ...tr.testrail, suiteId } }),
                    )}
                  </Field>
                </div>
                {secret('testrailApiKey', t('int.t.apiKey'))}
                <TestButton target="testrail" config={cfg} />
              </div>
            ) : (
              <div className="stack">
                <div className="grid2">
                  <Field label={t('int.t.azureUrl')}>
                    {text(tr.azure.url, (url) => setT({ azure: { ...tr.azure, url } }), {
                      placeholder: 'https://dev.azure.com/société',
                    })}
                  </Field>
                  <Field label={t('int.t.project')}>
                    {text(tr.azure.project, (project) => setT({ azure: { ...tr.azure, project } }))}
                  </Field>
                  <Field label={t('int.t.planId')}>
                    {text(tr.azure.planId, (planId) => setT({ azure: { ...tr.azure, planId } }))}
                  </Field>
                  <Field label={t('int.t.suiteId')}>
                    {text(tr.azure.suiteId, (suiteId) => setT({ azure: { ...tr.azure, suiteId } }))}
                  </Field>
                </div>
                {secret('azurePat', t('int.t.pat'))}
                <TestButton target="azure" config={cfg} />
              </div>
            )}
          </>
        )}
      </Card>

      <Card title={t('int.k')}>
        <span className="note">{t('int.k.intro')}</span>
        <ModePicker value={tk.mode} onChange={(mode) => setK({ mode })} t={t} />
        {tk.mode !== 'off' && (
          <>
            <div className="grid2">
              <Field label={t('int.k.provider')}>
                <Segmented
                  value={tk.provider}
                  onChange={(provider) => setK({ provider })}
                  options={[
                    { value: 'github', label: 'GitHub' },
                    { value: 'jira', label: 'Jira' },
                  ]}
                />
              </Field>
              <Field label={t('int.k.grouping')}>
                <select
                  value={tk.grouping}
                  onChange={(e) => setK({ grouping: e.target.value as typeof tk.grouping })}
                >
                  <option value="run">{t('int.k.group.run')}</option>
                  <option value="step">{t('int.k.group.step')}</option>
                </select>
              </Field>
              <Field label={t('int.k.max')}>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={tk.maxPerRun}
                  onChange={(e) => setK({ maxPerRun: num(e.target.value, 1, 20, tk.maxPerRun) })}
                />
              </Field>
            </div>
            {tk.provider === 'github' ? (
              <div className="stack">
                <div className="grid2">
                  <Field label={t('int.k.owner')}>
                    {text(tk.github.owner, (owner) => setK({ github: { ...tk.github, owner } }))}
                  </Field>
                  <Field label={t('int.k.repo')}>
                    {text(tk.github.repo, (repo) => setK({ github: { ...tk.github, repo } }))}
                  </Field>
                  <Field label={t('int.k.labels')}>
                    {text(tk.github.labels, (labels) => setK({ github: { ...tk.github, labels } }))}
                  </Field>
                  <Field label={t('int.k.assignees')}>
                    {text(tk.github.assignees, (assignees) =>
                      setK({ github: { ...tk.github, assignees } }),
                    )}
                  </Field>
                </div>
                {secret('githubToken', t('int.k.token'))}
                <TestButton target="github" config={cfg} />
              </div>
            ) : (
              <div className="stack">
                <div className="grid2">
                  <Field label={t('int.k.jiraUrl')}>
                    {text(tk.jira.url, (url) => setK({ jira: { ...tk.jira, url } }), {
                      placeholder: 'https://société.atlassian.net',
                    })}
                  </Field>
                  <Field label={t('int.k.auth')}>
                    <select
                      value={tk.jira.auth}
                      onChange={(e) =>
                        setK({ jira: { ...tk.jira, auth: e.target.value as typeof tk.jira.auth } })
                      }
                    >
                      <option value="basic">{t('int.k.auth.basic')}</option>
                      <option value="bearer">{t('int.k.auth.bearer')}</option>
                    </select>
                  </Field>
                  {tk.jira.auth === 'basic' && (
                    <Field label={t('int.k.email')}>
                      {text(tk.jira.email, (email) => setK({ jira: { ...tk.jira, email } }))}
                    </Field>
                  )}
                  <Field label={t('int.k.projectKey')}>
                    {text(tk.jira.projectKey, (projectKey) =>
                      setK({ jira: { ...tk.jira, projectKey } }),
                    )}
                  </Field>
                  <Field label={t('int.k.issueType')}>
                    {text(tk.jira.issueType, (issueType) =>
                      setK({ jira: { ...tk.jira, issueType } }),
                    )}
                  </Field>
                  <Field label={t('int.k.labels')}>
                    {text(tk.jira.labels, (labels) => setK({ jira: { ...tk.jira, labels } }))}
                  </Field>
                </div>
                <Field label={t('int.k.extra')} hint={t('int.k.extraHint')}>
                  <textarea
                    className="mono"
                    rows={3}
                    spellCheck={false}
                    value={tk.jira.extraFields}
                    onChange={(e) => setK({ jira: { ...tk.jira, extraFields: e.target.value } })}
                  />
                </Field>
                {secret('jiraToken', t('int.k.token'))}
                <Check
                  checked={tk.attachScreenshot}
                  onChange={(attachScreenshot) => setK({ attachScreenshot })}
                >
                  {t('int.k.attach')}
                </Check>
                <TestButton target="jira" config={cfg} />
              </div>
            )}
            <Check checked={tk.useAi} onChange={(useAi) => setK({ useAi })}>
              <b>{t('int.k.ai')}</b>
            </Check>
            {tk.useAi && (
              <Field label={t('int.k.instructions')} hint={t('int.k.instructionsHint')}>
                <textarea
                  className="mono"
                  rows={9}
                  spellCheck={false}
                  maxLength={8000}
                  value={tk.instructions}
                  placeholder={t('int.k.instructionsExample')}
                  onChange={(e) => setK({ instructions: e.target.value })}
                />
              </Field>
            )}
          </>
        )}
      </Card>

      <Card title={t('int.journal')}>
        {!status?.journal.length && <span className="note">{t('int.journal.empty')}</span>}
        <div className="int-journal">
          {status?.journal.map((e, i) => (
            <div key={e.at + i} className={e.ok ? '' : 'bad'}>
              <span className="mono note">{new Date(e.at).toLocaleTimeString()}</span>{' '}
              <Badge tone={e.ok ? 'ok' : 'err'}>{e.target}</Badge> {e.message}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
