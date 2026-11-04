import { FolderOpen } from 'lucide-react';
import { useState } from 'react';
import { THEMES, type Settings } from '../../../shared/domain/settings';
import { call } from '../../shared/api';
import { useT } from '../../shared/i18n';
import { Button, Check, Field } from '../../shared/ui/controls';
import { ErrorNotice } from '../../shared/ui/notices';
import { Modal } from '../../shared/ui/overlays';
import { useActions, useApp } from '../../app/store';
import type { SettingsTab } from '../../app/ui';
import { AiSettings } from './AiSettings';
import { IntegrationsSettings } from './IntegrationsSettings';
import { McpSettings } from './McpSettings';
import { RemoteSettings } from './RemoteSettings';
import { UpdatePanel } from './UpdatePanel';

/** Preview colors (background, sidebar, accent) of each theme: the CSS variables only exist on the root element. */
const SWATCH: Record<string, [string, string, string]> = {
  light: ['#ffffff', '#f4f5f9', '#4f6bff'],
  dark: ['#16171d', '#1d1f27', '#6d8bff'],
  midnight: ['#0b1020', '#0f1730', '#3ea6ff'],
  dracula: ['#282a36', '#21222c', '#bd93f9'],
  forest: ['#121a16', '#0e1512', '#34d399'],
  sunset: ['#1f1518', '#180f12', '#ff7a59'],
};
const num = (v: string, min: number, max: number, fallback: number) =>
  Number.isFinite(Number(v)) && v !== ''
    ? Math.max(min, Math.min(max, Math.round(Number(v))))
    : fallback;

export function SettingsDialog({
  initialTab = 'general',
  onClose,
}: {
  initialTab?: SettingsTab;
  onClose: () => void;
}) {
  const t = useT();
  const { settings } = useApp();
  const actions = useActions();
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [draft, setDraft] = useState<Settings>(settings!);
  const [error, setError] = useState<unknown>(null);
  const set = (p: Partial<Settings>) => setDraft((d) => ({ ...d, ...p }));
  const save = async () => {
    try {
      await actions.saveSettings(draft);
      onClose();
    } catch (e) {
      setError(e);
    }
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  return (
    <Modal
      size="wide"
      title={t('set.title')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" disabled={!dirty} onClick={save}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="settings-layout">
        <nav className="vtabs" role="tablist" aria-orientation="vertical">
          {(
            [
              'general',
              'ai',
              'creation',
              'execution',
              'devices',
              'integrations',
              'mcp',
              'updates',
            ] as const
          ).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={tab === v}
              className={tab === v ? 'on' : ''}
              onClick={() => setTab(v)}
            >
              {t(`set.tab.${v}` as never)}
            </button>
          ))}
        </nav>
        <div className="stack settings-content">
          {error != null && <ErrorNotice error={error} />}
          {tab === 'general' && (
            <>
              <div className="grid2">
                <Field label={t('set.language')}>
                  <select
                    value={draft.language}
                    onChange={(e) => set({ language: e.target.value as Settings['language'] })}
                  >
                    <option value="fr">Français</option>
                    <option value="en">English</option>
                  </select>
                </Field>
                <Field label={t('set.theme')}>
                  <select
                    value={draft.theme}
                    onChange={(e) => set({ theme: e.target.value as Settings['theme'] })}
                  >
                    {THEMES.map((x) => (
                      <option key={x} value={x}>
                        {t(`set.theme.${x}` as never)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="theme-swatches">
                {THEMES.filter((x) => x !== 'system').map((x) => (
                  <button
                    key={x}
                    className={draft.theme === x ? 'on' : ''}
                    title={t(`set.theme.${x}` as never)}
                    onClick={() => set({ theme: x })}
                  >
                    {SWATCH[x].map((c, i) => (
                      <i key={i} style={{ background: c }} />
                    ))}
                  </button>
                ))}
              </div>
              <Field label={t('set.projectsDir')} hint={t('set.projectsDirHint')}>
                <div className="row">
                  <input
                    className="mono"
                    value={draft.projectsDirectory}
                    onChange={(e) => set({ projectsDirectory: e.target.value })}
                  />
                  <Button
                    icon={<FolderOpen size={14} />}
                    onClick={async () => {
                      const d = await call('projects.chooseDirectory');
                      if (d) set({ projectsDirectory: d });
                    }}
                  >
                    {t('set.browse')}
                  </Button>
                </div>
              </Field>
            </>
          )}
          {tab === 'ai' && <AiSettings draft={draft} set={set} />}
          {tab === 'creation' && (
            <>
              <div className="grid2">
                <Field label={t('set.cr.decisions')} hint={t('set.cr.decisionsHint')}>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={draft.creationMaxDecisions}
                    onChange={(e) => set({ creationMaxDecisions: num(e.target.value, 1, 500, 40) })}
                  />
                </Field>
                <Field label={t('set.cr.minutes')} hint={t('set.cr.minutesHint')}>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={draft.creationTimeoutMinutes}
                    onChange={(e) =>
                      set({ creationTimeoutMinutes: num(e.target.value, 1, 120, 12) })
                    }
                  />
                </Field>
              </div>
              <Field label={t('set.cr.mode')}>
                <select
                  value={draft.explorationMode}
                  onChange={(e) =>
                    set({ explorationMode: e.target.value as Settings['explorationMode'] })
                  }
                >
                  <option value="interactive">{t('ai.interactive')}</option>
                  <option value="auto-approve">{t('ai.auto')}</option>
                </select>
              </Field>
              <Check
                checked={draft.creationFastMode}
                onChange={(v) => set({ creationFastMode: v })}
              >
                {t('set.cr.fast')}
              </Check>
              <Check checked={draft.creationReplay} onChange={(v) => set({ creationReplay: v })}>
                {t('set.cr.replay')}
              </Check>
              <Check
                checked={draft.creationPreparation}
                onChange={(v) => set({ creationPreparation: v })}
              >
                {t('set.cr.preparation')}
              </Check>
              <Check
                checked={draft.creationQuestions}
                disabled={draft.explorationMode === 'auto-approve'}
                onChange={(v) => set({ creationQuestions: v })}
              >
                {t('set.cr.questions')}
              </Check>
              <Field label={t('set.cr.prompt')} hint={t('set.cr.promptHint')}>
                <textarea
                  rows={5}
                  value={draft.creationPrompt}
                  onChange={(e) => set({ creationPrompt: e.target.value })}
                />
              </Field>
            </>
          )}
          {tab === 'execution' && (
            <>
              <Field label={t('set.ex.prep')} hint={t('set.ex.prepHint')}>
                <select
                  value={draft.executionPreparation}
                  onChange={(e) =>
                    set({
                      executionPreparation: e.target.value as Settings['executionPreparation'],
                    })
                  }
                >
                  {(['off', 'existing', 'ai'] as const).map((x) => (
                    <option key={x} value={x}>
                      {t(`set.ex.prep.${x}` as never)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('set.ex.proof')} hint={t('set.ex.proofHint')}>
                <select
                  value={draft.executionProof}
                  onChange={(e) =>
                    set({ executionProof: e.target.value as Settings['executionProof'] })
                  }
                >
                  {(['all', 'key', 'failures'] as const).map((x) => (
                    <option key={x} value={x}>
                      {t(`set.ex.proof.${x}` as never)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('set.ex.video')} hint={t('set.ex.videoHint')}>
                <select
                  value={draft.executionVideo}
                  onChange={(e) =>
                    set({ executionVideo: e.target.value as Settings['executionVideo'] })
                  }
                >
                  <option value="failures">{t('set.ex.video.failures')}</option>
                  <option value="off">{t('set.ex.video.off')}</option>
                </select>
              </Field>
              <Field label={t('set.ex.healing')} hint={t('set.ex.healingHint')}>
                <select
                  value={draft.healing}
                  onChange={(e) => set({ healing: e.target.value as Settings['healing'] })}
                >
                  <option value="off">{t('set.ex.healing.off')}</option>
                  <option value="actions">{t('set.ex.healing.actions')}</option>
                </select>
              </Field>
              <Field label={t('set.ex.interruptions')} hint={t('set.ex.interruptionsHint')}>
                <select
                  value={draft.interruptionMode}
                  onChange={(e) =>
                    set({ interruptionMode: e.target.value as Settings['interruptionMode'] })
                  }
                >
                  <option value="smart">{t('set.ex.int.smart')}</option>
                  <option value="rules">{t('set.ex.int.rules')}</option>
                  <option value="off">{t('set.ex.int.off')}</option>
                </select>
              </Field>
              <Check
                checked={draft.retryFailedSteps}
                onChange={(v) => set({ retryFailedSteps: v })}
              >
                {t('set.ex.retry')}
              </Check>
              <p className="note">{t('set.ex.retryHint')}</p>
              <Field label={t('set.ex.analysis')}>
                <select
                  value={draft.analysisMode}
                  onChange={(e) =>
                    set({ analysisMode: e.target.value as Settings['analysisMode'] })
                  }
                >
                  {(['automatic', 'ask', 'off'] as const).map((x) => (
                    <option key={x} value={x}>
                      {t(`set.ex.analysis.${x}` as never)}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
          {tab === 'devices' && (
            <>
              <Check
                checked={draft.deviceAutoRefresh}
                onChange={(v) => set({ deviceAutoRefresh: v })}
              >
                {t('set.dev.auto')}
              </Check>
              <Field label={t('set.dev.appium')}>
                <input
                  className="mono"
                  value={draft.appiumUrl}
                  onChange={(e) => set({ appiumUrl: e.target.value })}
                />
              </Field>
              <div className="eyebrow">iOS</div>
              <Field label={t('set.dev.wdaMode')} hint={t('set.dev.wdaModeHint')}>
                <select
                  value={draft.iosWdaMode}
                  onChange={(e) => set({ iosWdaMode: e.target.value as Settings['iosWdaMode'] })}
                >
                  {(['build', 'preinstalled', 'external'] as const).map((x) => (
                    <option key={x} value={x}>
                      {t(`set.dev.wda.${x}` as never)}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid2">
                <Field label="Apple Team ID">
                  <input
                    className="mono"
                    maxLength={10}
                    value={draft.iosTeamId}
                    onChange={(e) => set({ iosTeamId: e.target.value.toUpperCase() })}
                  />
                </Field>
                <Field label={t('set.dev.wdaBundle')}>
                  <input
                    className="mono"
                    value={draft.iosWdaBundleId}
                    placeholder="com.example.WebDriverAgent"
                    onChange={(e) => set({ iosWdaBundleId: e.target.value })}
                  />
                </Field>
                <Field label={t('set.dev.xcconfig')}>
                  <input
                    className="mono"
                    value={draft.iosXcodeConfigFile}
                    onChange={(e) => set({ iosXcodeConfigFile: e.target.value })}
                  />
                </Field>
                <Field label={t('set.dev.iosVersion')}>
                  <input
                    value={draft.iosPlatformVersion}
                    placeholder="18.2"
                    onChange={(e) => set({ iosPlatformVersion: e.target.value })}
                  />
                </Field>
                <Field label={t('set.dev.wdaUrl')}>
                  <input
                    className="mono"
                    value={draft.wdaUrl}
                    onChange={(e) => set({ wdaUrl: e.target.value })}
                  />
                </Field>
                <Field label={t('set.dev.wdaUdid')}>
                  <input
                    className="mono"
                    value={draft.wdaDeviceId}
                    onChange={(e) => set({ wdaDeviceId: e.target.value })}
                  />
                </Field>
              </div>
              <Check checked={draft.iosKeepAwake} onChange={(v) => set({ iosKeepAwake: v })}>
                {t('set.dev.keepAwake')}
              </Check>
              <div className="row wrap">
                {(['provisioning', 'preinstalled', 'tunnels', 'windows'] as const).map((d) => (
                  <Button
                    key={d}
                    size="sm"
                    variant="ghost"
                    onClick={() => void call('devices.openDoc', d)}
                  >
                    {t(`set.dev.doc.${d}` as never)}
                  </Button>
                ))}
              </div>
              <RemoteSettings draft={draft} set={set} />
            </>
          )}
          {tab === 'integrations' && <IntegrationsSettings draft={draft} set={set} />}
          {tab === 'mcp' && <McpSettings draft={draft} set={set} />}
          {tab === 'updates' && <UpdatePanel draft={draft} set={set} />}
        </div>
      </div>
    </Modal>
  );
}
