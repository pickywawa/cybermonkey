import {
  Download,
  Flag,
  FolderOpen,
  ListChecks,
  Map as MapIcon,
  MoreHorizontal,
  Play,
  Plus,
  Square,
} from 'lucide-react';
import { useState } from 'react';
import {
  EXPORT_EXTENSIONS,
  EXPORT_FORMATS,
  type ExportFormat,
} from '../../../shared/domain/campaign-export';
import { call } from '../../shared/api';
import { useT } from '../../shared/i18n';
import { Button, IconButton, Tabs } from '../../shared/ui/controls';
import { PlatformIcon } from '../../shared/ui/icons';
import { ErrorNotice } from '../../shared/ui/notices';
import { Menu, Modal, useToast } from '../../shared/ui/overlays';
import { useActions, useApp } from '../../app/store';
import { useExec } from './focus';
import { ProgressHeader } from './ProgressHeader';
import { ResultsList } from './ResultsList';
import { ScreensView } from './ScreensView';
import { useRun } from './useRun';

/**
 * A campaign is a test cycle: one row per element of the scenarios with the result of its last run. The header says
 * where the cycle stands; Results lists the elements, Screens lists the screens of the application.
 */
export function ExecutionView({ run }: { run: ReturnType<typeof useRun> }) {
  const t = useT();
  const toast = useToast();
  const { project, campaigns, detail, run: current, settings } = useApp();
  const actions = useActions();
  const exec = useExec();
  const [cleaning, setCleaning] = useState<'one' | 'all' | null>(null);
  const campaign = detail?.campaign;
  if (!project || !settings) return null;

  const newCampaign = async () => {
    await call('campaigns.create', { projectId: project.id });
    await actions.refreshWorkspace();
    await actions.refreshCampaigns();
  };
  const rename = async () => {
    const label = prompt(t('camp.rename'), campaign?.label);
    if (label?.trim() && campaign) {
      await call('campaigns.update', {
        projectId: project.id,
        campaignId: campaign.id,
        label: label.trim(),
      });
      await actions.refreshCampaigns();
      const d = await call('campaigns.load', { projectId: project.id, campaignId: campaign.id });
      actions.setRun(d.reports.at(-1) ?? null);
    }
  };
  const toggleStatus = async () => {
    if (!campaign) return;
    try {
      await call('campaigns.update', {
        projectId: project.id,
        campaignId: campaign.id,
        status: campaign.status === 'open' ? 'completed' : 'open',
      });
      await actions.refreshWorkspace();
    } catch (e) {
      toast(String((e as Error).message), 'err');
    }
  };
  const clean = async () => {
    try {
      await call('campaigns.clean', {
        projectId: project.id,
        campaignId: cleaning === 'all' ? undefined : campaign?.id,
      });
      await actions.refreshWorkspace();
      actions.setRun(null);
    } catch (e) {
      toast(String((e as Error).message), 'err');
    }
    setCleaning(null);
  };
  const exportAs = async (format: ExportFormat) => {
    if (!campaign) return;
    const content = await call('campaigns.export', {
      projectId: project.id,
      campaignId: campaign.id,
      format,
    });
    const [ext, mime] = EXPORT_EXTENSIONS[format];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: mime + ';charset=utf-8' }));
    a.download = `${campaign.label.replace(/[^\p{L}\p{N}-]+/gu, '_')}.${format === 'confluence' ? 'confluence.txt' : ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <div className="exec">
      <div className="camp-bar">
        <FolderOpen size={14} color="var(--dim)" />
        <select
          className="grow"
          value={campaign?.id ?? ''}
          onChange={(e) => void actions.updateProject({ activeCampaignId: e.target.value || null })}
        >
          <option value="">{t('camp.none')}</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
              {c.status === 'completed' ? ` · ${t('camp.completed')}` : ''}
            </option>
          ))}
        </select>
        <Menu
          align="right"
          trigger={(toggle) => (
            <IconButton label={t('camp.menu')} onClick={toggle}>
              <MoreHorizontal size={16} />
            </IconButton>
          )}
        >
          {(close) => (
            <>
              <button
                onClick={() => {
                  close();
                  void newCampaign();
                }}
              >
                <Plus size={13} /> {t('camp.new')}
              </button>
              <hr />
              <button
                disabled={!campaign}
                onClick={() => {
                  close();
                  void rename();
                }}
              >
                {t('camp.renameAction')}
              </button>
              <button
                disabled={!campaign || run.running}
                onClick={() => {
                  close();
                  void toggleStatus();
                }}
              >
                <Flag size={13} />{' '}
                {campaign?.status === 'completed' ? t('camp.reopen') : t('camp.finish')}
              </button>
              <hr />
              <button
                disabled={!campaign || run.running}
                onClick={() => {
                  close();
                  setCleaning('one');
                }}
              >
                {t('camp.clean')}
              </button>
              <button
                disabled={!campaigns.length || run.running}
                onClick={() => {
                  close();
                  setCleaning('all');
                }}
              >
                {t('camp.cleanAll')}
              </button>
            </>
          )}
        </Menu>
      </div>

      {!campaign ? (
        <div className="empty" style={{ flex: 1 }}>
          <ListChecks size={26} />
          <b>{t('camp.emptyTitle')}</b>
          <span className="note">{t('camp.emptyHint')}</span>
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => void newCampaign()}>
            {t('camp.startNew')}
          </Button>
        </div>
      ) : (
        <>
          <div className="exec-top">
            <div className="camp-title-row">
              <div className="grow" style={{ minWidth: 0 }}>
                <h1 className="camp-title ellipsis" title={campaign.label}>
                  {campaign.label}
                </h1>
                <div className="note">
                  <span className={`dot ${campaign.status === 'open' ? 'ok' : ''}`} />{' '}
                  {campaign.status === 'open' ? t('camp.open') : t('camp.completed')} ·{' '}
                  {t('camp.created', {
                    date: new Date(campaign.createdAt).toLocaleString(settings.language),
                  })}
                </div>
              </div>
              <Menu
                align="right"
                trigger={(toggle) => (
                  <Button size="sm" icon={<Download size={13} />} onClick={toggle}>
                    {t('camp.export')}
                  </Button>
                )}
              >
                {(close) =>
                  EXPORT_FORMATS.map((f) => (
                    <button
                      key={f}
                      onClick={() => {
                        close();
                        void exportAs(f);
                      }}
                    >
                      {t(`camp.fmt.${f}` as never)}
                    </button>
                  ))
                }
              </Menu>
              {run.running ? (
                <Button size="sm" variant="danger" icon={<Square size={12} />} onClick={run.stop}>
                  {t('camp.stop')}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="primary"
                  busy={run.starting}
                  disabled={campaign.status !== 'open'}
                  icon={<Play size={13} />}
                  onClick={() => void run.start()}
                >
                  {t('camp.runAll')}
                </Button>
              )}
            </div>
            {run.error != null && <ErrorNotice error={run.error} />}
            {run.missing.length > 0 && (
              <div className="notice warn" style={{ margin: '8px 0 0' }}>
                <div className="grow">
                  {t('camp.missingDevices')}{' '}
                  {run.missing.map((o) => (
                    <PlatformIcon key={o} os={o} />
                  ))}
                </div>
              </div>
            )}
            <ProgressHeader results={exec.results} />
            <Tabs
              value={exec.view}
              onChange={exec.setView}
              options={[
                { value: 'results', label: t('camp.tab.results') },
                {
                  value: 'map',
                  label: (
                    <>
                      <MapIcon size={13} /> {t('camp.tab.map')}
                    </>
                  ),
                },
              ]}
            />
          </div>
          <div className="scroll grow exec-body">
            {exec.view === 'results' ? (
              <ResultsList detail={detail} />
            ) : (
              <ScreensView detail={detail} />
            )}
            {current?.persistenceError && (
              <div className="notice err">{current.persistenceError}</div>
            )}
          </div>
        </>
      )}

      {cleaning && (
        <Modal
          size="narrow"
          title={t('camp.cleanTitle')}
          onClose={() => setCleaning(null)}
          footer={
            <>
              <Button onClick={() => setCleaning(null)}>{t('common.cancel')}</Button>
              <Button variant="danger" onClick={() => void clean()}>
                {t('camp.cleanConfirm')}
              </Button>
            </>
          }
        >
          <p>{cleaning === 'all' ? t('camp.cleanAllBody') : t('camp.cleanBody')}</p>
        </Modal>
      )}
    </div>
  );
}
