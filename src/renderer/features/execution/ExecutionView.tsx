import {
  Download,
  FolderOpen,
  Map as MapIcon,
  MoreHorizontal,
  Play,
  Plus,
  RotateCcw,
  Square,
  ListChecks,
  Flag,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { campaignProgress, campaignFrames, outcomeOf } from '../../../shared/domain/campaign';
import {
  EXPORT_EXTENSIONS,
  EXPORT_FORMATS,
  type ExportFormat,
} from '../../../shared/domain/campaign-export';
import { call } from '../../shared/api';
import { useT } from '../../shared/i18n';
import { Button, ProgressRing, Tabs } from '../../shared/ui/controls';
import { PlatformIcon } from '../../shared/ui/icons';
import { ErrorNotice } from '../../shared/ui/notices';
import { Menu, Modal, useToast } from '../../shared/ui/overlays';
import { useActions, useApp } from '../../app/store';
import { ProgressView } from './ProgressView';
import { ResultsTable } from './ResultsTable';
import { ScreenMap } from './ScreenMap';
import { Timeline } from './Timeline';
import { useRun } from './useRun';

export function ExecutionView({ run }: { run: ReturnType<typeof useRun> }) {
  const t = useT();
  const toast = useToast();
  const { project, projectOs, campaigns, detail, run: current, settings } = useApp();
  const actions = useActions();
  const [view, setView] = useState<'progress' | 'results' | 'map'>('progress');
  const [reportId, setReportId] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [cleaning, setCleaning] = useState<'one' | 'all' | null>(null);
  const campaign = detail?.campaign;
  const reports = detail?.reports ?? [];
  const report = reports.find((r) => r.id === reportId) ?? reports.at(-1);
  const progress = useMemo(
    () => campaignProgress(detail, project!, projectOs),
    [detail, project, projectOs],
  );
  const frames = useMemo(() => campaignFrames(detail), [detail]);
  const checks = frames.filter((f) => f.entry.kind === 'test');
  const passed = checks.filter((f) => outcomeOf(f.entry) === 'passed').length,
    failed = checks.filter((f) => outcomeOf(f.entry) === 'failed').length;
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
  const runAll = () =>
    reports.some((r) => r.entries.length) ? setConfirmAll(true) : void run.start();

  return (
    <div className="exec">
      <div className="camp-head">
        <FolderOpen size={15} color="var(--dim)" />
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
        <Button size="sm" icon={<Plus size={13} />} onClick={newCampaign}>
          {t('camp.new')}
        </Button>
        <Menu
          align="right"
          trigger={(toggle) => (
            <Button size="sm" variant="ghost" onClick={toggle}>
              <MoreHorizontal size={15} />
            </Button>
          )}
        >
          {(close) => (
            <>
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
          <Button variant="primary" icon={<Plus size={14} />} onClick={newCampaign}>
            {t('camp.startNew')}
          </Button>
        </div>
      ) : (
        <div className="scroll grow" style={{ padding: '0 20px 20px' }}>
          <h1 className="camp-title">{campaign.label}</h1>
          <div className="row wrap muted" style={{ marginBottom: 10 }}>
            <span className={`dot ${campaign.status === 'open' ? 'ok' : ''}`} />{' '}
            {campaign.status === 'open' ? t('camp.open') : t('camp.completed')} ·{' '}
            {t('camp.created', {
              date: new Date(campaign.createdAt).toLocaleString(settings.language),
            })}
          </div>
          <div className="stats">
            <div>
              <b>{reports.length}</b>
              <span>{t('camp.runs')}</span>
            </div>
            <div className="ok">
              <b>{passed}</b>
              <span>{t('camp.passed')}</span>
            </div>
            <div className={failed ? 'bad' : ''}>
              <b>{failed}</b>
              <span>{t('camp.failed')}</span>
            </div>
            <div>
              <b>{progress.overall.pending}</b>
              <span>{t('camp.remaining')}</span>
            </div>
            <div className="ring-cell">
              <ProgressRing percent={progress.overall.percent} />
              <span>{t('camp.done')}</span>
            </div>
          </div>
          {run.error != null && <ErrorNotice error={run.error} />}
          {run.missing.length > 0 && (
            <div className="notice warn" style={{ margin: '8px 0' }}>
              <div className="grow">
                {t('camp.missingDevices')}{' '}
                {run.missing.map((o) => (
                  <PlatformIcon key={o} os={o} />
                ))}
              </div>
            </div>
          )}
          <div className="row wrap" style={{ margin: '12px 0 4px' }}>
            <Tabs
              value={view}
              onChange={setView}
              options={[
                {
                  value: 'progress',
                  label: (
                    <>
                      <ListChecks size={13} /> {t('camp.tab.progress')}
                    </>
                  ),
                },
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
            <span className="grow" />
            {reports.length > 1 && (
              <select
                style={{ width: 210 }}
                value={report?.id}
                onChange={(e) => setReportId(e.target.value)}
              >
                {reports.map((r) => (
                  <option key={r.id} value={r.id}>
                    {new Date(r.startedAt).toLocaleString(settings.language)} ·{' '}
                    {t(`st.${r.status}` as never)}
                  </option>
                ))}
              </select>
            )}
            <Menu
              align="right"
              trigger={(toggle) => (
                <Button icon={<Download size={14} />} onClick={toggle}>
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
              <Button variant="danger" icon={<Square size={13} />} onClick={run.stop}>
                {t('camp.stop')}
              </Button>
            ) : (
              <Button
                variant="primary"
                busy={run.starting}
                disabled={campaign.status !== 'open'}
                icon={<Play size={14} />}
                onClick={runAll}
              >
                {t('camp.runAll')}
                {projectOs.length === 1 ? ` · ${projectOs[0] === 'ios' ? 'iOS' : 'Android'}` : ''}
              </Button>
            )}
          </div>
          <Timeline />
          {view === 'progress' && <ProgressView detail={detail} />}
          {view === 'results' &&
            (report ? (
              <ResultsTable report={report} />
            ) : (
              <div className="empty note">{t('res.none')}</div>
            ))}
          {view === 'map' && detail && <ScreenMap detail={detail} />}
          {current?.persistenceError && (
            <div className="notice err">{current.persistenceError}</div>
          )}
        </div>
      )}
      {confirmAll && (
        <Modal
          size="narrow"
          title={t('camp.rerunTitle')}
          onClose={() => setConfirmAll(false)}
          footer={
            <>
              <Button onClick={() => setConfirmAll(false)}>{t('common.cancel')}</Button>
              <Button
                icon={<RotateCcw size={13} />}
                onClick={() => {
                  setConfirmAll(false);
                  void run.start({ resetCampaign: true });
                }}
              >
                {t('camp.rerunReset')}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setConfirmAll(false);
                  void run.start();
                }}
              >
                {t('camp.rerunKeep')}
              </Button>
            </>
          }
        >
          <p>{t('camp.rerunBody')}</p>
        </Modal>
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
