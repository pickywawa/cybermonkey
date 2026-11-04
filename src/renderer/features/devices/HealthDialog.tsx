import {
  BookOpen,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Copy,
  RefreshCw,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { DeviceCheck, DeviceHealth } from '../../../shared/domain/devices';
import { call } from '../../shared/api';
import { useT } from '../../shared/i18n';
import { Button, Spinner } from '../../shared/ui/controls';
import { ErrorNotice } from '../../shared/ui/notices';
import { Modal, useToast } from '../../shared/ui/overlays';
import { useApp } from '../../app/store';

const icon = (s: DeviceCheck['state']) =>
  s === 'ok' ? (
    <CircleCheck size={16} color="var(--ok)" />
  ) : s === 'error' ? (
    <CircleAlert size={16} color="var(--danger)" />
  ) : s === 'pending' ? (
    <Spinner />
  ) : (
    <CircleHelp size={16} color="var(--dim)" />
  );

/** Step-by-step readiness of one device: what is wrong, how to fix it, and AI help when stuck. */
export function HealthDialog({ deviceId, onClose }: { deviceId: string; onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const { devices } = useApp();
  const device = devices.devices.find((d) => d.id === deviceId);
  const [health, setHealth] = useState<DeviceHealth | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<'check' | 'reconnect' | 'ai' | null>('check');
  const [advice, setAdvice] = useState('');
  const check = useCallback(async () => {
    setBusy('check');
    try {
      setHealth(await call('devices.health', deviceId));
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }, [deviceId]);
  useEffect(() => {
    void check();
  }, [check]);
  const reconnect = async () => {
    setBusy('reconnect');
    try {
      await call('devices.reconnect', deviceId);
      toast(t('dev.reconnected'), 'ok');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
      void check();
    }
  };
  const ask = async () => {
    setBusy('ai');
    try {
      setAdvice(await call('devices.aiDiagnose', deviceId));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  const failing = health?.checks.filter((c) => c.state === 'error').length ?? 0;
  return (
    <Modal
      title={`${t('dev.health')} · ${device?.name ?? deviceId}`}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <Button icon={<Sparkles size={14} />} busy={busy === 'ai'} onClick={ask}>
            {t('dev.askAi')}
          </Button>
          <Button icon={<RefreshCw size={14} />} busy={busy === 'check'} onClick={check}>
            {t('dev.recheck')}
          </Button>
          <Button
            variant="primary"
            icon={<Wrench size={14} />}
            busy={busy === 'reconnect'}
            onClick={reconnect}
          >
            {t('dev.reconnect')}
          </Button>
        </>
      }
    >
      <div className="stack">
        {error != null && <ErrorNotice error={error} />}
        {health && (
          <p className="muted">
            {failing ? t('dev.healthFailing', { n: failing }) : t('dev.healthOk')}
          </p>
        )}
        {health?.checks.map((c) => (
          <div key={c.id} className={`check-row ${c.state}`}>
            {icon(c.state)}
            <div className="grow">
              <div className="row">
                <b>{c.label}</b>
                <span className="muted note" style={{ whiteSpace: 'pre-wrap' }}>
                  {c.detail}
                </span>
              </div>
              {c.state !== 'ok' && c.fix && (
                <div className="note" style={{ marginTop: 4 }}>
                  → {c.fix}
                </div>
              )}
              {c.state !== 'ok' && c.command && (
                <div className="row" style={{ marginTop: 4 }}>
                  <code className="grow ellipsis" title={c.command}>
                    {c.command}
                  </code>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Copy size={12} />}
                    onClick={() =>
                      navigator.clipboard
                        .writeText(c.command!)
                        .then(() => toast(t('common.copied'), 'ok'))
                    }
                  >
                    {t('common.copy')}
                  </Button>
                </div>
              )}
              {c.documentation && (
                <a className="note" href={c.documentation} target="_blank" rel="noreferrer">
                  <BookOpen size={11} /> {t('common.docs')}
                </a>
              )}
              {c.log && (
                <details>
                  <summary className="note" style={{ cursor: 'pointer' }}>
                    {t('common.details')}
                  </summary>
                  <pre>{c.log}</pre>
                </details>
              )}
            </div>
          </div>
        ))}
        {!health && !error && (
          <div className="empty">
            <Spinner size={20} />
          </div>
        )}
        {advice && (
          <div className="notice">
            <Sparkles size={16} />
            <div className="grow" style={{ whiteSpace: 'pre-wrap' }}>
              {advice}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
