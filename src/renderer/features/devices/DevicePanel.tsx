import {
  ArrowUpRight,
  ArrowLeft,
  Crosshair,
  Hand,
  MoreHorizontal,
  RefreshCw,
  Smartphone,
  Stethoscope,
  Undo2,
  Wrench,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Component, Device, Screen } from '../../../shared/domain/devices';
import { makeVariant, type OS } from '../../../shared/domain/scenario';
import { campaignFrames } from '../../../shared/domain/campaign';
import { call } from '../../shared/api';
import { useT } from '../../shared/i18n';
import { Button, IconButton, Spinner } from '../../shared/ui/controls';
import { PlatformIcon, osName } from '../../shared/ui/icons';
import { ErrorNotice } from '../../shared/ui/notices';
import { Menu } from '../../shared/ui/overlays';
import { useActions, useApp } from '../../app/store';
import { describeDiagnostic } from './diagnostics';
import { HealthDialog } from './HealthDialog';
import { Mirror, type Gesture } from './Mirror';
import { useWorkbench } from './workbench';

/** One card per active OS: device picker, live mirror, component picking, history replay. */
export function DevicePanel({
  mode,
  detached,
}: {
  mode: 'creation' | 'execution';
  detached?: boolean;
}) {
  const t = useT();
  const { project, projectOs, devices, settings, replay, detail } = useApp();
  const actions = useActions();
  const frames = useMemoFrames(detail);
  if (!project || !settings) return null;
  return (
    <div className="devices-panel">
      <div className="panel-head">
        <Smartphone size={16} color="var(--accent)" />
        <span className="grow">{t('dev.title')}</span>
        <IconButton label={t('dev.refresh')} onClick={() => void actions.refreshDevices()}>
          <RefreshCw size={15} />
        </IconButton>
        {!detached && (
          <IconButton label={t('dev.detach')} onClick={() => void call('devices.detach', true)}>
            <ArrowUpRight size={15} />
          </IconButton>
        )}
      </div>
      {replay && mode === 'execution' && (
        <div className="replay-bar">
          <span className="grow ellipsis">
            {t('dev.history')} ·{' '}
            {new Date(replay.entry.completedAt!).toLocaleString(settings.language)}
          </span>
          <Button
            size="sm"
            icon={<Undo2 size={13} />}
            onClick={() => void call('replay.select', { projectId: project.id, frame: null })}
          >
            {t('dev.live')}
          </Button>
        </div>
      )}
      <div className="scroll grow device-cards">
        {projectOs.map((os) => (
          <DeviceCard
            key={os}
            os={os}
            mode={mode}
            devices={devices.devices.filter((d) => d.platform === os)}
            frames={frames}
          />
        ))}
        {devices.diagnostics.length > 0 && !devices.devices.length && (
          <div className="stack" style={{ padding: '0 12px 12px' }}>
            {devices.diagnostics.map((code) => {
              const d = describeDiagnostic(code);
              return (
                <div key={code} className="notice warn">
                  <div className="grow">
                    <div className="title">{t(d.key, { name: d.name ?? '' })}</div>
                  </div>
                  {d.doc && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void call('devices.openDoc', d.doc!)}
                    >
                      {t('common.docs')}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
const useMemoFrames = (detail: ReturnType<typeof useApp>['detail']) =>
  useMemo(() => campaignFrames(detail), [detail]);

function DeviceCard({
  os,
  mode,
  devices,
  frames,
}: {
  os: OS;
  mode: 'creation' | 'execution';
  devices: Device[];
  frames: ReturnType<typeof campaignFrames>;
}) {
  const t = useT();
  const { project, unreachable, replay, run, aiMessage } = useApp();
  const actions = useActions();
  const { picked, pick } = useWorkbench();
  const deviceId = project!.deviceIds[os];
  const device = devices.find((d) => d.id === deviceId);
  const [screen, setScreen] = useState<Screen | null>(null);
  const [exploring, setExploring] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [health, setHealth] = useState(false);
  const [historic, setHistoric] = useState<string | null>(null);
  const [driving, setDriving] = useState(false);
  const live = !!device && device.status === 'ready' && !replay && !unreachable.has(deviceId!);

  // History: last completed step of this OS at the selected instant.
  const frame = useMemo(
    () =>
      replay
        ? [...frames]
            .reverse()
            .find(
              (f) =>
                f.entry.platform === os &&
                f.entry.completedAt! <= replay.entry.completedAt! &&
                f.entry.screenshot,
            )
        : undefined,
    [replay, frames, os],
  );
  useEffect(() => {
    setHistoric(null);
    if (!frame || !project) return;
    void call('runs.screenshot', {
      projectId: project.id,
      campaignId: project.activeCampaignId ?? undefined,
      runId: frame.runId,
      entryId: frame.entry.id,
    })
      .then(setHistoric)
      .catch(() => {});
  }, [frame?.entry.id, project?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const explore = async () => {
    if (!deviceId) return;
    setExploring(true);
    setError(null);
    try {
      setScreen(await call('devices.inspect', deviceId));
    } catch (e) {
      setError(e);
    } finally {
      setExploring(false);
    }
  };
  useEffect(() => {
    setScreen(null);
  }, [deviceId, replay]);
  const driveOn = driving && live && run?.status !== 'running';
  /** Remote control: the same engine that plays the steps performs the gesture, one at a time. */
  const act = async (g: Gesture | 'back') => {
    if (!deviceId) return;
    const variant =
      g === 'back'
        ? makeVariant({ operation: 'back' })
        : g.kind === 'tap'
          ? makeVariant({ operation: 'tap', point: { x: g.x, y: g.y } })
          : makeVariant({ operation: 'swipe', direction: g.direction });
    await call('devices.perform', {
      deviceId,
      projectId: project?.id,
      variant,
      kind: 'action',
    });
  };
  const select = (id: string) => void actions.updateProject({ deviceIds: { [os]: id } as never });

  return (
    <section className="device-card">
      <header>
        <PlatformIcon os={os} size={16} />
        <b>{osName(os)}</b>
        <select className="grow" value={deviceId ?? ''} onChange={(e) => select(e.target.value)}>
          <option value="">{t('dev.choose')}</option>
          {devices.map((d) => (
            <option key={d.id} value={d.id} disabled={d.status !== 'ready'}>
              {d.name} · {d.kind}
              {d.status !== 'ready' ? ` (${d.status})` : ''}
            </option>
          ))}
        </select>
        {device && (
          <span
            className={`dot ${device.status === 'ready' && !unreachable.has(device.id) ? 'ok' : 'err'}`}
            title={device.detail}
          />
        )}
        <Menu
          align="right"
          trigger={(toggle) => (
            <IconButton label="Menu" onClick={toggle}>
              <MoreHorizontal size={15} />
            </IconButton>
          )}
        >
          {(close) => (
            <>
              <button
                disabled={!deviceId}
                onClick={() => {
                  close();
                  setHealth(true);
                }}
              >
                <Stethoscope size={14} /> {t('dev.health')}
              </button>
              <button
                disabled={!deviceId}
                onClick={() => {
                  close();
                  void call('devices.reconnect', deviceId!).catch(setError);
                }}
              >
                <Wrench size={14} /> {t('dev.reconnect')}
              </button>
              {os === 'ios' && process_isMac() && (
                <button
                  disabled={!deviceId}
                  onClick={() => {
                    close();
                    void call('devices.openWda', deviceId!).catch(setError);
                  }}
                >
                  {t('dev.openWda')}
                </button>
              )}
              <button
                onClick={() => {
                  close();
                  void call('devices.openDoc', os === 'ios' ? 'provisioning' : 'adb');
                }}
              >
                {t('common.docs')}
              </button>
            </>
          )}
        </Menu>
      </header>
      {!deviceId || !device ? (
        <div className="empty">
          <PlatformIcon os={os} size={26} />
          <b>{t('dev.pair', { os: osName(os) })}</b>
          <span className="note">{t('dev.pairHint')}</span>
          {devices.length === 0 && (
            <Button
              size="sm"
              onClick={() => (deviceId ? setHealth(true) : void actions.refreshDevices())}
            >
              {t('dev.scan')}
            </Button>
          )}
        </div>
      ) : (
        <>
          {error != null && (
            <div style={{ padding: 8 }}>
              <ErrorNotice error={error} onAskAi={() => setHealth(true)} />
            </div>
          )}
          {run?.status === 'running' && !replay && (
            <div className="note" style={{ padding: '0 12px 6px' }}>
              <Spinner size={11} /> {t('dev.running')}
            </div>
          )}
          <Mirror
            deviceId={deviceId}
            live={live}
            busy={run?.status === 'running' || !!aiMessage}
            image={replay ? (historic ?? '') : undefined}
            screen={replay ? null : screen}
            selectedId={picked?.os === os ? picked.component.id : undefined}
            onSelect={(c: Component) => screen && pick({ os, deviceId, component: c, screen })}
            onError={setError}
            control={driveOn ? act : undefined}
          />
          {live && !replay && (
            <div className="row" style={{ padding: '6px 10px 0' }}>
              <Button
                size="sm"
                variant={driving ? 'primary' : 'ghost'}
                icon={<Hand size={13} />}
                disabled={run?.status === 'running'}
                title={t('dev.driveHint')}
                onClick={() => {
                  setDriving(!driving);
                  setScreen(null);
                }}
              >
                {t('dev.drive')}
              </Button>
              {driveOn && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<ArrowLeft size={13} />}
                  onClick={() => void act('back').catch(setError)}
                >
                  {t('dev.back')}
                </Button>
              )}
              {driveOn && <span className="note">{t('dev.driveHelp')}</span>}
            </div>
          )}
          {replay && !historic && (
            <div className="note" style={{ padding: 10 }}>
              {t('dev.noCapture')}
            </div>
          )}
          {!replay && mode === 'creation' && (
            <div className="row" style={{ padding: '8px 10px' }}>
              <Button size="sm" busy={exploring} icon={<Crosshair size={13} />} onClick={explore}>
                {screen ? t('dev.reexplore') : t('dev.explore')}
              </Button>
              {screen && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setScreen(null);
                    pick(null);
                  }}
                >
                  {t('dev.hideOverlay')}
                </Button>
              )}
              {picked?.os === os && (
                <span className="note ellipsis">
                  → {picked.component.label || picked.component.text || picked.component.type}
                </span>
              )}
            </div>
          )}
        </>
      )}
      {health && deviceId && <HealthDialog deviceId={deviceId} onClose={() => setHealth(false)} />}
    </section>
  );
}
const process_isMac = () => navigator.userAgent.includes('Mac');
