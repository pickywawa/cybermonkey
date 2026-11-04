import { Crosshair, List, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { OS_LIST, type OS } from '../../../shared/domain/scenario';
import type { AppInfo, Applications } from '../../../shared/domain/project';
import { call } from '../../shared/api';
import { useT } from '../../shared/i18n';
import { Button, Check, Field } from '../../shared/ui/controls';
import { PlatformIcon, osName } from '../../shared/ui/icons';
import { ErrorNotice } from '../../shared/ui/notices';
import { Modal } from '../../shared/ui/overlays';
import { useActions, useApp } from '../../app/store';

/** Create or edit a project. The application under test is detected on the connected device or picked from its installed apps. */
export function ProjectDialog({ mode, onClose }: { mode: 'new' | 'edit'; onClose: () => void }) {
  const t = useT();
  const { project, devices } = useApp();
  const actions = useActions();
  const editing = mode === 'edit' && !!project;
  const [name, setName] = useState(editing ? project!.name : '');
  const [platforms, setPlatforms] = useState<OS[]>(
    editing ? project!.platforms : ['android', 'ios'],
  );
  const [apps, setApps] = useState<Applications>(
    editing ? project!.applications : { android: '', ios: '' },
  );
  const [details, setDetails] = useState(editing ? project!.applicationDetails : {});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [picker, setPicker] = useState<OS | null>(null);

  const deviceFor = (os: OS) =>
    (editing ? project!.deviceIds[os] : undefined) ??
    devices.devices.find((d) => d.platform === os && d.status === 'ready' && d.kind === 'usb')
      ?.id ??
    devices.devices.find((d) => d.platform === os && d.status === 'ready')?.id;
  const setApp = (os: OS, info: AppInfo) => {
    setApps((a) => ({ ...a, [os]: info.id }));
    setDetails((d) => ({
      ...d,
      [os]: info.name || info.id ? { id: info.id, name: info.name, icon: info.icon } : undefined,
    }));
  };
  const detect = async (os: OS) => {
    const deviceId = deviceFor(os);
    if (!deviceId) return setError(new Error(t('proj.needDevice', { os: osName(os) })));
    setBusy('detect:' + os);
    setError(null);
    try {
      const [current] = await call('projects.applications', {
        deviceId,
        platform: os,
        mode: 'current',
      });
      const info = await call('projects.applicationInfo', {
        deviceId,
        platform: os,
        application: current.id,
      }).catch(() => current);
      setApp(os, { ...current, ...info });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  const submit = async () => {
    setBusy('save');
    setError(null);
    try {
      const applications = Object.fromEntries(
        OS_LIST.map((o) => [o, platforms.includes(o) ? apps[o] : '']),
      ) as Applications;
      if (editing) {
        await actions.updateProject({
          name: name.trim(),
          platforms,
          applications,
          applicationDetails: details,
        });
      } else {
        await call('projects.create', {
          name: name.trim(),
          platforms,
          applications,
          applicationDetails: details,
        });
        await actions.refreshWorkspace();
      }
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Modal
      title={editing ? t('proj.edit') : t('proj.new')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            busy={busy === 'save'}
            disabled={!name.trim() || !platforms.length}
            onClick={submit}
          >
            {editing ? t('common.save') : t('proj.create')}
          </Button>
        </>
      }
    >
      <div className="stack">
        {error != null && <ErrorNotice error={error} />}
        <Field label={t('proj.name')} hint={editing ? t('proj.renameHint') : t('proj.folderHint')}>
          <input autoFocus value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('proj.platforms')} hint={t('proj.platformsHint')}>
          <div className="row">
            {OS_LIST.map((os) => (
              <Check
                key={os}
                checked={platforms.includes(os)}
                onChange={(v) => setPlatforms((p) => (v ? [...p, os] : p.filter((x) => x !== os)))}
              >
                <span className="row" style={{ gap: 4 }}>
                  <PlatformIcon os={os} /> {osName(os)}
                </span>
              </Check>
            ))}
          </div>
        </Field>
        {platforms.map((os) => (
          <div key={os} className="app-field">
            <div className="row">
              <PlatformIcon os={os} />
              <b className="grow">{t('proj.appOf', { os: osName(os) })}</b>
              <Button
                size="sm"
                busy={busy === 'detect:' + os}
                icon={<Crosshair size={12} />}
                onClick={() => void detect(os)}
                title={t('proj.detectHint')}
              >
                {t('proj.detect')}
              </Button>
              <Button
                size="sm"
                icon={<List size={12} />}
                disabled={!deviceFor(os)}
                onClick={() => setPicker(os)}
              >
                {t('proj.pick')}
              </Button>
            </div>
            <div className="row">
              {details[os]?.icon ? (
                <img
                  src={details[os]!.icon}
                  width={34}
                  height={34}
                  style={{ borderRadius: 8 }}
                  alt=""
                />
              ) : (
                <span className="app-icon">
                  <PlatformIcon os={os} size={18} />
                </span>
              )}
              <div className="grow stack" style={{ gap: 4 }}>
                <input
                  placeholder={os === 'android' ? 'com.example.app' : 'com.example.App'}
                  className="mono"
                  value={apps[os]}
                  onChange={(e) => {
                    setApps({ ...apps, [os]: e.target.value });
                    setDetails((d) => ({ ...d, [os]: undefined }));
                  }}
                />
                {details[os]?.name && <span className="note">{details[os]!.name}</span>}
              </div>
            </div>
          </div>
        ))}
        <p className="note">{t('proj.appHint')}</p>
      </div>
      {picker && (
        <AppPicker
          os={picker}
          deviceId={deviceFor(picker)!}
          onClose={() => setPicker(null)}
          onPick={(info) => {
            setApp(picker, info);
            setPicker(null);
            void call('projects.applicationInfo', {
              deviceId: deviceFor(picker),
              platform: picker,
              application: info.id,
            })
              .then((i) => setApp(picker, { ...info, ...i }))
              .catch(() => {});
          }}
        />
      )}
    </Modal>
  );
}

function AppPicker({
  os,
  deviceId,
  onClose,
  onPick,
}: {
  os: OS;
  deviceId: string;
  onClose: () => void;
  onPick: (a: AppInfo) => void;
}) {
  const t = useT();
  const [all, setAll] = useState(false);
  const [list, setList] = useState<AppInfo[] | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    setList(null);
    call('projects.applications', { deviceId, platform: os, mode: all ? 'all' : 'list' })
      .then(setList)
      .catch((e) => {
        setError(e);
        setList([]);
      });
  }, [deviceId, os, all]);
  const shown = useMemo(
    () => (list ?? []).filter((a) => (a.name + a.id).toLowerCase().includes(q.toLowerCase())),
    [list, q],
  );
  return (
    <Modal title={t('proj.pickTitle', { os: osName(os) })} onClose={onClose}>
      <div className="stack">
        {error != null && <ErrorNotice error={error} />}
        <div className="row">
          <div className="search grow">
            <Search size={13} />
            <input
              autoFocus
              placeholder={t('proj.search')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Check checked={all} onChange={setAll}>
            {t('proj.system')}
          </Check>
        </div>
        <div className="app-list">
          {list === null ? (
            <div className="empty note">…</div>
          ) : (
            shown.slice(0, 300).map((a) => (
              <button key={a.id} className="app-row" onClick={() => onPick(a)}>
                <b className="ellipsis">{a.name}</b>
                <span className="note ellipsis">{a.id}</span>
              </button>
            ))
          )}
          {list && !shown.length && <div className="empty note">{t('proj.noApp')}</div>}
        </div>
      </div>
    </Modal>
  );
}
