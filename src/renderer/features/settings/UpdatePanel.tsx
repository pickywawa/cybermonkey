import { Download, ExternalLink, RefreshCw } from 'lucide-react';
import { call } from '../../shared/api';
import { useT } from '../../shared/i18n';
import { Button, Check } from '../../shared/ui/controls';
import type { Settings } from '../../../shared/domain/settings';
import { useApp } from '../../app/store';

/** Automatic update status (GitHub releases): check, download with progress, verified install. */
export function UpdatePanel({
  draft,
  set,
}: {
  draft: Settings;
  set: (p: Partial<Settings>) => void;
}) {
  const t = useT();
  const { update } = useApp();
  const u = update;
  const mb = (n: number) => (n / 1048576).toFixed(1);
  return (
    <div className="stack">
      <div className="row">
        <b className="grow">{t('upd.current', { v: u?.currentVersion ?? '…' })}</b>
        <Button
          size="sm"
          icon={<RefreshCw size={12} />}
          busy={u?.state === 'checking'}
          onClick={() => void call('updates.check')}
        >
          {t('upd.check')}
        </Button>
      </div>
      {u?.state === 'current' && <div className="notice">{t('upd.upToDate')}</div>}
      {u?.state === 'error' && <div className="notice err">{u.error}</div>}
      {u && ['available', 'downloading', 'ready'].includes(u.state) && (
        <div className="notice">
          <div className="grow">
            <div className="title">{t('upd.available', { v: u.version ?? '' })}</div>
            {u.state === 'downloading' && (
              <>
                <div className="progress" style={{ margin: '6px 0' }}>
                  <i className="p" style={{ width: u.percent + '%' }} />
                </div>
                <span className="note">
                  {mb(u.received)} / {mb(u.total)} Mo
                </span>
              </>
            )}
            {u.notes && <pre style={{ maxHeight: 140 }}>{u.notes}</pre>}
            <div className="row" style={{ marginTop: 6 }}>
              {u.compatible && u.state === 'available' && (
                <Button
                  size="sm"
                  variant="primary"
                  icon={<Download size={12} />}
                  onClick={() => void call('updates.download')}
                >
                  {t('upd.download')}
                </Button>
              )}
              {u.state === 'ready' && (
                <Button size="sm" variant="primary" onClick={() => void call('updates.install')}>
                  {t('upd.install')}
                </Button>
              )}
              {!u.compatible && <span className="note">{t('upd.noInstaller')}</span>}
              <Button
                size="sm"
                variant="ghost"
                icon={<ExternalLink size={12} />}
                onClick={() => void call('updates.release')}
              >
                {t('upd.release')}
              </Button>
            </div>
          </div>
        </div>
      )}
      <Check checked={draft.checkUpdatesOnStart} onChange={(v) => set({ checkUpdatesOnStart: v })}>
        {t('upd.auto')}
      </Check>
      <Check
        checked={draft.autoDownloadUpdates}
        disabled={!draft.checkUpdatesOnStart}
        onChange={(v) => set({ autoDownloadUpdates: v })}
      >
        {t('upd.autoDownload')}
      </Check>
      <p className="note">{t('upd.note')}</p>
    </div>
  );
}
