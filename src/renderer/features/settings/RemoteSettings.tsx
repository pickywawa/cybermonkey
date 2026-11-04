import { Plus, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { IntegrationStatus } from '../../../shared/domain/integrations';
import {
  REMOTE_PROVIDERS,
  SAUCE_REGIONS,
  slugFor,
  type RemoteDevice,
  type RemoteProvider,
  type RemoteSettings as Remote,
  type RemoteStatus,
} from '../../../shared/domain/remote';
import type { Settings } from '../../../shared/domain/settings';
import { call } from '../../shared/api';
import { useT } from '../../shared/i18n';
import { Badge, Button, Field, Segmented } from '../../shared/ui/controls';
import { Card, SecretField } from './IntegrationsSettings';

const num = (v: string, min: number, max: number, fallback: number) =>
  Number.isFinite(Number(v)) && v !== ''
    ? Math.max(min, Math.min(max, Math.round(Number(v))))
    : fallback;

/** One line of text per phone, kept as the person typed it (empty lines dropped only when saving the list). */
const lines = (text: string) => text.split(/\r?\n/);

export function RemoteSettings({
  draft,
  set,
}: {
  draft: Settings;
  set: (p: Partial<Settings>) => void;
}) {
  const t = useT();
  const remote = draft.remote;
  const setR = (p: Partial<Remote>) => set({ remote: { ...remote, ...p } });
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [secrets, setSecrets] = useState<IntegrationStatus | null>(null);
  const [provider, setProvider] = useState<RemoteProvider>('browserstack');
  const alive = useRef(true);
  // The text box keeps what is typed, line breaks included: the saved list is its cleaned-up version.
  const [hostsText, setHostsText] = useState(remote.adb.hosts.join('\n'));

  useEffect(() => {
    alive.current = true;
    const poll = () => {
      void call('remote.status')
        .then((s) => alive.current && setStatus(s))
        .catch(() => {});
      void call('integrations.status')
        .then((s) => alive.current && setSecrets(s))
        .catch(() => {});
    };
    poll();
    const timer = setInterval(poll, 4000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <Card title={t('rem.title')}>
      <span className="note">{t('rem.intro')}</span>

      <b>{t('rem.adb')}</b>
      <span className="note">{t('rem.adb.hint')}</span>
      <Field label={t('rem.adb.hosts')}>
        <textarea
          className="mono"
          rows={3}
          spellCheck={false}
          value={hostsText}
          placeholder="192.168.1.20:5555"
          onChange={(e) => {
            setHostsText(e.target.value);
            setR({
              adb: {
                hosts: lines(e.target.value)
                  .map((l) => l.trim())
                  .filter(Boolean),
              },
            });
          }}
        />
      </Field>
      <AdbStates status={status} onRefresh={setStatus} />
      <AdbPair />

      <b>{t('rem.providers')}</b>
      <Segmented
        value={provider}
        onChange={setProvider}
        options={REMOTE_PROVIDERS.map((p) => ({
          value: p,
          label: (
            <>
              {t(`rem.p.${p}` as never)}{' '}
              {status && (
                <span className={status.providers[p].ready ? 'int-ok' : 'int-warn'}>●</span>
              )}
            </>
          ),
        }))}
      />
      <ProviderForm
        provider={provider}
        remote={remote}
        setR={setR}
        secrets={secrets}
        setSecrets={setSecrets}
      />

      <b>{t('rem.profiles')}</b>
      <span className="note">{t('rem.profiles.hint')}</span>
      <Profiles remote={remote} setR={setR} />

      <Field label={t('rem.idle')} hint={t('rem.idle.hint')}>
        <input
          type="number"
          min={1}
          max={60}
          value={remote.idleMinutes}
          onChange={(e) => setR({ idleMinutes: num(e.target.value, 1, 60, remote.idleMinutes) })}
        />
      </Field>
      <span className="note">{t('rem.cli')}</span>
    </Card>
  );
}

function AdbStates({
  status,
  onRefresh,
}: {
  status: RemoteStatus | null;
  onRefresh: (s: RemoteStatus) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  return (
    <div className="stack" style={{ gap: 4 }}>
      {status?.adb.map((a) => (
        <div key={a.host} className="row">
          <span className="mono">{a.host}</span>
          <Badge tone={a.state === 'connected' ? 'ok' : a.state === 'unreachable' ? 'err' : 'warn'}>
            {t(`rem.adb.state.${a.state}` as never)}
          </Badge>
          <span className="note">{a.state === 'connected' ? '' : a.detail}</span>
        </div>
      ))}
      <div>
        <Button
          size="sm"
          busy={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const adb = await call('remote.adbConnect');
              onRefresh({ ...(status ?? { providers: {} as never }), adb });
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('rem.adb.connect')}
        </Button>
      </div>
    </div>
  );
}

function AdbPair() {
  const t = useT();
  const [host, setHost] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="note">{t('rem.adb.pair')}</span>
      <div className="row">
        <input
          className="grow mono"
          value={host}
          placeholder={t('rem.adb.pairHost')}
          onChange={(e) => setHost(e.target.value)}
        />
        <input
          className="mono"
          style={{ width: 130 }}
          value={code}
          maxLength={6}
          placeholder={t('rem.adb.pairCode')}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        />
        <Button
          size="sm"
          busy={busy}
          disabled={!host.trim() || code.length !== 6}
          onClick={async () => {
            setBusy(true);
            setResult(null);
            try {
              setResult(await call('remote.adbPair', { host, code }));
            } catch (e) {
              setResult({ ok: false, message: String((e as Error).message ?? e) });
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('rem.adb.pairDo')}
        </Button>
      </div>
      {result && (
        <span className={`note ${result.ok ? 'int-ok' : 'int-bad'}`}>
          {result.ok ? '✔ ' : '✘ '}
          {result.message}
        </span>
      )}
    </div>
  );
}

function ProviderForm({
  provider,
  remote,
  setR,
  secrets,
  setSecrets,
}: {
  provider: RemoteProvider;
  remote: Remote;
  setR: (p: Partial<Remote>) => void;
  secrets: IntegrationStatus | null;
  setSecrets: (s: IntegrationStatus) => void;
}) {
  const t = useT();
  const secret = (name: Parameters<typeof SecretField>[0]['name'], label: string) => (
    <SecretField name={name} label={label} status={secrets} onChange={setSecrets} />
  );
  const input = (value: string, onChange: (v: string) => void, placeholder?: string) => (
    <input
      value={value}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
    />
  );
  return (
    <div className="stack">
      {provider === 'browserstack' && (
        <>
          <div className="grid2">
            <Field label={t('rem.username')}>
              {input(remote.browserstack.username, (username) =>
                setR({ browserstack: { ...remote.browserstack, username } }),
              )}
            </Field>
            <Field label={t('rem.appiumVersion')}>
              {input(
                remote.browserstack.appiumVersion,
                (appiumVersion) =>
                  setR({ browserstack: { ...remote.browserstack, appiumVersion } }),
                '2.6.0',
              )}
            </Field>
          </div>
          {secret('browserstackKey', t('rem.accessKey'))}
        </>
      )}
      {provider === 'saucelabs' && (
        <>
          <div className="grid2">
            <Field label={t('rem.username')}>
              {input(remote.saucelabs.username, (username) =>
                setR({ saucelabs: { ...remote.saucelabs, username } }),
              )}
            </Field>
            <Field label={t('rem.region')}>
              <select
                value={remote.saucelabs.region}
                onChange={(e) =>
                  setR({
                    saucelabs: {
                      ...remote.saucelabs,
                      region: e.target.value as typeof remote.saucelabs.region,
                    },
                  })
                }
              >
                {SAUCE_REGIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('rem.appiumVersion')}>
              {input(remote.saucelabs.appiumVersion, (appiumVersion) =>
                setR({ saucelabs: { ...remote.saucelabs, appiumVersion } }),
              )}
            </Field>
          </div>
          {secret('saucelabsKey', t('rem.accessKey'))}
        </>
      )}
      {provider === 'devicefarm' && (
        <>
          <span className="note">{t('rem.devicefarm.note')}</span>
          <div className="grid2">
            <Field label={t('rem.awsKeyId')}>
              {input(remote.devicefarm.accessKeyId, (accessKeyId) =>
                setR({ devicefarm: { ...remote.devicefarm, accessKeyId } }),
              )}
            </Field>
            <Field label={t('rem.appiumVersion')}>
              {input(remote.devicefarm.appiumVersion, (appiumVersion) =>
                setR({ devicefarm: { ...remote.devicefarm, appiumVersion } }),
              )}
            </Field>
          </div>
          <Field label={t('rem.projectArn')}>
            {input(
              remote.devicefarm.projectArn,
              (projectArn) => setR({ devicefarm: { ...remote.devicefarm, projectArn } }),
              'arn:aws:devicefarm:us-west-2:123456789012:project:…',
            )}
          </Field>
          {secret('awsSecretKey', t('rem.awsSecret'))}
        </>
      )}
      {provider === 'appium' && (
        <>
          <Field label={t('rem.url')}>
            {input(
              remote.appium.url,
              (url) => setR({ appium: { ...remote.appium, url } }),
              'https://appium.lab.example.com:4723',
            )}
          </Field>
          <div className="grid2">
            <Field label={t('rem.auth')}>
              <select
                value={remote.appium.auth}
                onChange={(e) =>
                  setR({
                    appium: { ...remote.appium, auth: e.target.value as typeof remote.appium.auth },
                  })
                }
              >
                <option value="none">{t('rem.auth.none')}</option>
                <option value="basic">{t('rem.auth.basic')}</option>
                <option value="bearer">{t('rem.auth.bearer')}</option>
              </select>
            </Field>
            {remote.appium.auth === 'basic' && (
              <Field label={t('rem.username')}>
                {input(remote.appium.username, (username) =>
                  setR({ appium: { ...remote.appium, username } }),
                )}
              </Field>
            )}
          </div>
          {remote.appium.auth !== 'none' && secret('remoteAppiumSecret', t('rem.secret'))}
          <span className="note">{t('rem.app.appiumNote')}</span>
        </>
      )}
      {provider !== 'appium' && <AppRefs provider={provider} remote={remote} setR={setR} />}
      <ProviderTest provider={provider} remote={remote} />
    </div>
  );
}

function AppRefs({
  provider,
  remote,
  setR,
}: {
  provider: Exclude<RemoteProvider, 'appium'>;
  remote: Remote;
  setR: (p: Partial<Remote>) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState<'android' | 'ios' | null>(null);
  const [error, setError] = useState('');
  const refs = remote[provider].app;
  const update = (platform: 'android' | 'ios', value: string) =>
    setR({ [provider]: { ...remote[provider], app: { ...refs, [platform]: value } } } as never);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <b>{t('rem.app')}</b>
      <span className="note">{t('rem.app.hint')}</span>
      {(['android', 'ios'] as const).map((platform) => (
        <Field key={platform} label={t(`rem.app.${platform}` as never)}>
          <div className="row">
            <input
              className="grow mono"
              spellCheck={false}
              value={refs[platform]}
              placeholder={
                provider === 'browserstack'
                  ? 'bs://…'
                  : provider === 'saucelabs'
                    ? 'storage:…'
                    : 'arn:aws:devicefarm:…:upload:…'
              }
              onChange={(e) => update(platform, e.target.value)}
            />
            <Button
              size="sm"
              icon={<Upload size={12} />}
              busy={busy === platform}
              onClick={async () => {
                setBusy(platform);
                setError('');
                try {
                  const ref = await call('remote.uploadApp', { provider, platform });
                  if (ref) update(platform, ref);
                } catch (e) {
                  setError(String((e as Error).message ?? e));
                } finally {
                  setBusy(null);
                }
              }}
            >
              {t('rem.app.upload')}
            </Button>
          </div>
        </Field>
      ))}
      {error && <span className="note int-bad">✘ {error}</span>}
    </div>
  );
}

function ProviderTest({ provider, remote }: { provider: RemoteProvider; remote: Remote }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  useEffect(() => setResult(null), [provider]);
  return (
    <div className="row">
      <Button
        size="sm"
        busy={busy}
        onClick={async () => {
          setBusy(true);
          setResult(null);
          try {
            setResult(await call('remote.test', { provider, remote }));
          } catch (e) {
            setResult({ ok: false, message: String((e as Error).message ?? e) });
          } finally {
            setBusy(false);
          }
        }}
      >
        {t('rem.test')}
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

function Profiles({ remote, setR }: { remote: Remote; setR: (p: Partial<Remote>) => void }) {
  const t = useT();
  const patch = (id: string, p: Partial<RemoteDevice>) =>
    setR({ devices: remote.devices.map((d) => (d.id === id ? { ...d, ...p } : d)) });
  const add = () => {
    const label = `${t('rem.profile.default')} ${remote.devices.length + 1}`;
    setR({
      devices: [
        ...remote.devices,
        {
          id: slugFor(
            label,
            remote.devices.map((d) => d.id),
          ),
          label,
          provider: 'browserstack',
          platform: 'android',
          deviceName: '',
          osVersion: '',
          ref: '',
        },
      ],
    });
  };
  return (
    <div className="stack">
      {!remote.devices.length && <span className="note">{t('rem.profiles.empty')}</span>}
      {remote.devices.map((d) => (
        <div key={d.id} className="int-profile">
          <div className="grid2">
            <Field label={t('rem.profile.label')}>
              <input value={d.label} onChange={(e) => patch(d.id, { label: e.target.value })} />
            </Field>
            <Field label={t('rem.profile.provider')}>
              <select
                value={d.provider}
                onChange={(e) => patch(d.id, { provider: e.target.value as RemoteProvider })}
              >
                {REMOTE_PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {t(`rem.p.${p}` as never)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('rem.profile.platform')}>
              <select
                value={d.platform}
                onChange={(e) =>
                  patch(d.id, { platform: e.target.value as RemoteDevice['platform'] })
                }
              >
                <option value="android">Android</option>
                <option value="ios">iOS</option>
              </select>
            </Field>
            {(d.provider === 'browserstack' ||
              d.provider === 'saucelabs' ||
              d.provider === 'appium') && (
              <Field label={t('rem.profile.deviceName')}>
                <input
                  value={d.deviceName}
                  onChange={(e) => patch(d.id, { deviceName: e.target.value })}
                />
              </Field>
            )}
            {d.provider !== 'devicefarm' && (
              <Field label={t('rem.profile.osVersion')}>
                <input
                  value={d.osVersion}
                  onChange={(e) => patch(d.id, { osVersion: e.target.value })}
                />
              </Field>
            )}
            {(d.provider === 'devicefarm' || d.provider === 'appium') && (
              <Field
                label={t(d.provider === 'devicefarm' ? 'rem.profile.arn' : 'rem.profile.udid')}
              >
                <input
                  className="mono"
                  spellCheck={false}
                  value={d.ref}
                  onChange={(e) => patch(d.id, { ref: e.target.value })}
                />
              </Field>
            )}
          </div>
          <div>
            <Button
              size="sm"
              variant="ghost"
              icon={<Trash2 size={12} />}
              onClick={() => setR({ devices: remote.devices.filter((x) => x.id !== d.id) })}
            >
              {t('rem.profile.remove')}
            </Button>
          </div>
        </div>
      ))}
      <div>
        <Button size="sm" icon={<Plus size={12} />} onClick={add}>
          {t('rem.profiles.add')}
        </Button>
      </div>
    </div>
  );
}
