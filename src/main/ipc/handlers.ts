import { dialog, shell } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { campaignExport } from '../../shared/domain/campaign-export.js';
import {
  applicationDetailsSchema,
  applicationsSchema,
  chatSessionSchema,
  environmentSchema,
  focusSchema,
  projectInput,
  projectNameSchema,
} from '../../shared/domain/project.js';
import { nodeSchema, osSchema, variantSchema } from '../../shared/domain/scenario.js';
import { settingsSchema } from '../../shared/domain/settings.js';
import { REMOTE_PROVIDERS, remoteSchema } from '../../shared/domain/remote.js';
import { SECRET_KEYS, TEST_TARGETS, integrationsSchema } from '../../shared/domain/integrations.js';
import { variablesSchema } from '../../shared/domain/variables.js';
import type { Contract } from '../../shared/ipc.js';
import type { Container } from '../container.js';
import { compareWithLastSuccess } from '../engine/execution/compare.js';
import { DIAGNOSE_SYSTEM } from '../engine/prompts.js';
import type { OS } from '../../shared/domain/scenario.js';
import { effectiveVariables } from '../../shared/domain/project.js';
import type { Updater } from '../infra/updater/updater.js';
import type { WindowManager } from '../app/windows.js';
import type { McpService } from '../mcp/server.js';
import type { Ipc } from './registry.js';

const DOCS = {
  provisioning:
    'https://appium.github.io/appium-xcuitest-driver/latest/getting-started/provisioning-profile/',
  windows: 'https://appium.github.io/appium-xcuitest-driver/latest/guides/non-macos-hosts/',
  tunnels:
    'https://appium.github.io/appium-xcuitest-driver/latest/guides/remotexpc-tunnels-real-devices/',
  preinstalled:
    'https://appium.github.io/appium-xcuitest-driver/latest/guides/run-preinstalled-wda/',
  adb: 'https://developer.android.com/tools/releases/platform-tools',
  xcode: 'https://developer.apple.com/xcode/',
} as const;

const deviceFor = (
  c: Container,
  input: { projectId?: string; deviceId?: string; platform: 'android' | 'ios' },
) => {
  const id =
    input.deviceId ??
    (input.projectId ? c.store.get(input.projectId).deviceIds[input.platform] : undefined);
  if (!id) throw new Error('Associez un appareil à cette plateforme.');
  if (c.devices.known.get(id)?.platform !== input.platform)
    throw new Error('Appareil incompatible avec cette plateforme.');
  return id;
};

/** Every IPC channel of the Contract, grouped by domain. Business logic stays in services. */
export function registerHandlers(
  ipc: Ipc,
  c: Container,
  windows: WindowManager,
  updater: () => Updater,
  mcp: McpService,
) {
  const mutated = async <T>(work: Promise<T>) => {
    const result = await work;
    windows.refreshMenu();
    c.emit({ type: 'workspace' });
    return result;
  };

  /* workspace & settings */
  ipc.handle('workspace.load', () => c.store.state);
  ipc.handle(
    'settings.save',
    async (s) => {
      const saved = await mutated(
        c.store.saveSettings({
          ...s,
          devicesDetached: c.store.state.settings.devicesDetached,
          aiDetached: c.store.state.settings.aiDetached,
          // The token is only ever changed by "mcp.regenerateToken".
          mcpToken: c.store.state.settings.mcpToken,
        }),
      );
      await mcp.apply();
      // New or changed remote devices (adb hosts, cloud profiles) show up without waiting for the next poll.
      void c.monitor.tick(true);
      return saved;
    },
    settingsSchema,
  );
  ipc.handle('mcp.status', () => mcp.status());
  ipc.handle('mcp.regenerateToken', () => mutated(c.store.regenerateMcpToken()));

  /* remote devices */
  const adbListing = () =>
    new Map(
      [...c.devices.known.values()]
        .filter((d) => d.id.startsWith('android:'))
        .map((d) => [
          d.id.slice('android:'.length),
          d.status === 'ready' ? ('device' as const) : d.status,
        ]),
    );
  ipc.handle('remote.status', () => c.remote.status(adbListing()));
  ipc.handle(
    'remote.test',
    (i) => c.remote.test(i.provider, i.remote),
    z.object({ provider: z.enum(REMOTE_PROVIDERS), remote: remoteSchema }),
  );
  ipc.handle(
    'remote.uploadApp',
    async (i) => {
      const picked = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
          i.platform === 'android'
            ? { name: 'Android (.apk)', extensions: ['apk'] }
            : { name: 'iOS (.ipa)', extensions: ['ipa', 'zip'] },
        ],
      });
      if (picked.canceled || !picked.filePaths[0]) return null;
      return c.remote.upload(i.provider, i.platform, picked.filePaths[0]);
    },
    z.object({ provider: z.enum(REMOTE_PROVIDERS), platform: osSchema }),
  );
  ipc.handle('remote.adbConnect', async () => {
    await c.remote.adb.connectNow(c.settings().remote.adb.hosts);
    await c.monitor.tick(true);
    return (await c.remote.status(adbListing())).adb;
  });
  ipc.handle(
    'remote.adbPair',
    (i) => c.remote.adb.pair(i.host, i.code),
    z.object({ host: z.string().max(120), code: z.string().max(12) }),
  );

  /* integrations: git sync, notifications, trackers, tickets */
  ipc.handle('integrations.status', () => c.integrations.status());
  ipc.handle(
    'integrations.setSecret',
    (i) => c.integrations.setSecret(i.key, i.value),
    z.object({ key: z.enum(SECRET_KEYS), value: z.string().max(4000).nullable() }),
  );
  ipc.handle(
    'integrations.test',
    (i) => c.integrations.test(i.target, i.config),
    z.object({ target: z.enum(TEST_TARGETS), config: integrationsSchema }),
  );
  ipc.handle(
    'integrations.gitInfo',
    (i) => c.integrations.gitInfo(i.path),
    z.object({ path: z.string().min(1).max(2000) }),
  );
  ipc.handle(
    'integrations.gitSync',
    (i) => c.integrations.gitSync(i.action),
    z.object({ action: z.enum(['pull', 'push']) }),
  );
  ipc.handle(
    'integrations.answer',
    (i) => c.integrations.answer(i.id, i.accepted, i.edited),
    z.object({
      id: z.string().max(80),
      accepted: z.boolean(),
      edited: z.string().max(60000).optional(),
    }),
  );

  /* projects */
  ipc.handle('projects.create', (p) => mutated(c.store.create(p)), projectInput);
  ipc.handle(
    'projects.update',
    (p) => mutated(c.store.update(p)),
    z.object({
      id: z.string(),
      name: projectNameSchema.optional(),
      platforms: z.array(osSchema).min(1).max(2).optional(),
      focus: focusSchema.optional(),
      tab: z.enum(['creation', 'execution']).optional(),
      applications: applicationsSchema.optional(),
      applicationDetails: applicationDetailsSchema.optional(),
      variables: variablesSchema.optional(),
      environments: z.array(environmentSchema).max(20).optional(),
      activeEnvironmentId: z.string().nullable().optional(),
      chatSessions: z.array(chatSessionSchema).max(500).optional(),
      activeChatSessionId: z.string().nullable().optional(),
      activeCampaignId: z.string().uuid().nullable().optional(),
      nodes: z.array(nodeSchema).max(1000).optional(),
      tags: z.array(z.string().min(1).max(60)).max(500).optional(),
      deviceIds: z
        .object({ android: z.string().optional(), ios: z.string().optional() })
        .optional(),
      selectedNodeId: z.string().nullable().optional(),
      expectedRevision: z.number().int().optional(),
    }) as never,
  );
  ipc.handle('projects.select', (id) => mutated(c.store.select(id)));
  ipc.handle('projects.remove', (id) => mutated(c.store.remove(id)));
  ipc.handle(
    'projects.reveal',
    async (id) => void (await shell.openPath(c.store.get(id).directory)),
  );
  ipc.handle('projects.chooseDirectory', async () => {
    const result = await dialog.showOpenDialog(windows.main()!, {
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipc.handle('projects.applicationInfo', (i) =>
    c.automation.applicationInfo(deviceFor(c, i), i.application),
  );
  ipc.handle('projects.applications', (i) => c.automation.applications(deviceFor(c, i), i.mode));

  /* devices */
  ipc.handle('devices.scan', async () => {
    await c.monitor.tick(true);
    return c.devices.scan();
  });
  ipc.handle('devices.health', (id) => c.diagnostics.health(c.devices.known.get(id), id));
  ipc.handle('devices.warm', (id) => c.automation.warm(id));
  ipc.handle('devices.reconnect', async (id) => {
    try {
      await c.automation.reconnect(id);
    } finally {
      c.emit({ type: 'workspace' });
    }
  });
  ipc.handle('devices.screenshot', async (id) => {
    try {
      return await c.devices.screenshot(id);
    } catch (error) {
      c.emit({ type: 'device', deviceId: id, ready: false });
      throw error;
    }
  });
  ipc.handle('devices.inspect', async (id) => {
    try {
      return await c.automation.inspect(id);
    } catch (error) {
      if (!String(error).includes('occupé')) c.emit({ type: 'device', deviceId: id, ready: false });
      throw error;
    }
  });
  ipc.handle(
    'devices.perform',
    (p) =>
      c.automation
        .perform(
          p.deviceId,
          p.variant,
          p.kind,
          undefined,
          undefined,
          p.projectId ? effectiveVariables(c.store.get(p.projectId)) : {},
          true,
          p.projectId
            ? c.store.get(p.projectId).applications?.[
                c.devices.known.get(p.deviceId)?.platform as OS
              ]
            : undefined,
        )
        .then((out) => (typeof out === 'string' ? out : null)),
    z.object({
      deviceId: z.string(),
      projectId: z.string().optional(),
      variant: variantSchema,
      kind: z.enum(['scenario', 'action', 'navigation', 'test']),
    }) as never,
  );
  ipc.handle('devices.openWda', async (id) => {
    const error = await shell.openPath(await c.automation.openWdaProject(id));
    if (error) throw new Error(error);
  });
  ipc.handle('devices.openDoc', (topic) => shell.openExternal(DOCS[topic]));
  ipc.handle('devices.detach', (v) => windows.detach('devices', v));
  ipc.handle('devices.aiDiagnose', async (id) => {
    const health = await c.diagnostics.health(c.devices.known.get(id), id);
    const prompt = JSON.stringify({
      language: c.settings().language,
      platform: process.platform,
      device: c.devices.known.get(id),
      checks: health.checks.map(({ label, state, detail, log }) => ({
        label,
        state,
        detail,
        log: log?.slice(-1800),
      })),
    });
    return c.hub.converse(DIAGNOSE_SYSTEM, AbortSignal.timeout(120000), (chat) =>
      chat.send(prompt, { timeoutMs: 100000 }),
    );
  });

  /* AI providers */
  ipc.handle('ai.status', (p) => c.hub.status(p));
  ipc.handle('ai.login', (p) => c.hub.login(p));
  ipc.handle('ai.logout', (p) => c.hub.logout(p));
  ipc.handle('ai.detach', (v) => windows.detach('ai', v));

  /* AI-assisted creation */
  ipc.handle(
    'creation.ask',
    (i) => c.creation.ask(i),
    z.object({
      projectId: z.string(),
      prompt: z.string().trim().min(1).max(60000),
      sessionId: z.string().optional(),
      nodeId: z.string().optional(),
      deviceIds: z.array(z.string()).max(2),
    }),
  );
  ipc.handle(
    'creation.answer',
    (i) => c.creation.answer(i),
    z.object({
      projectId: z.string(),
      questionId: z.string(),
      answer: z.string().trim().min(1).max(16000),
    }),
  );
  ipc.handle('creation.cancel', (id) => c.creation.cancel(id));

  /* campaigns, runs, replay */
  ipc.handle('campaigns.list', (id) => c.campaigns.list(id));
  ipc.handle('campaigns.create', async (i) => {
    const campaign = await c.campaigns.create(i.projectId, i.label);
    await mutated(c.store.update({ id: i.projectId, activeCampaignId: campaign.id }));
    return campaign;
  });
  ipc.handle('campaigns.load', (i) => c.runner.loadCampaign(i.projectId, i.campaignId));
  ipc.handle('campaigns.update', (i) => {
    if (c.runner.isRunning() && i.status)
      throw new Error('Attendez la fin de l’exécution avant de terminer la campagne.');
    return mutated(
      c.campaigns.update(i.projectId, i.campaignId, { label: i.label, status: i.status }),
    );
  });
  ipc.handle('campaigns.clean', (i) => mutated(c.runner.cleanCampaigns(i.projectId, i.campaignId)));
  ipc.handle('campaigns.export', async (i) =>
    campaignExport(
      await c.runner.loadCampaign(i.projectId, i.campaignId),
      i.format,
      c.store.get(i.projectId),
    ),
  );
  ipc.handle('runs.start', (i) => c.runner.start(i));
  ipc.handle('runs.cancel', () => c.runner.cancel());
  ipc.handle('runs.current', (id) => c.runner.current(id));
  ipc.handle('runs.analyze', (i) => c.runner.analyze(i));
  ipc.handle('runs.screenshot', async (i) => {
    const campaignId = i.campaignId ?? c.store.get(i.projectId).activeCampaignId;
    return campaignId ? c.campaigns.screenshot({ ...i, campaignId }) : null;
  });
  ipc.handle('runs.video', async (i) => {
    const campaignId = i.campaignId ?? c.store.get(i.projectId).activeCampaignId;
    return campaignId ? c.campaigns.video({ ...i, campaignId }) : null;
  });
  ipc.handle('runs.compare', async (i) => {
    const campaignId = i.campaignId ?? c.store.get(i.projectId).activeCampaignId;
    if (!campaignId) return null;
    return compareWithLastSuccess(
      { campaigns: c.campaigns, loadCampaign: (p, id) => c.runner.loadCampaign(p, id) },
      { ...i, campaignId },
    );
  });
  ipc.handle('runs.applyHealing', (i) => mutated(c.runner.applyHealing(i)));
  const replaySelections = new Map<string, Contract['replay.current'][1]>();
  const replayVersions = new Map<string, number>();
  ipc.handle('replay.current', (id) => (c.store.get(id), replaySelections.get(id) ?? null));
  ipc.handle('replay.select', async (i) => {
    c.store.get(i.projectId);
    const version = (replayVersions.get(i.projectId) ?? 0) + 1;
    replayVersions.set(i.projectId, version);
    const frame = i.frame
      ? await c.runner.replayFrame(i.projectId, i.frame.runId, i.frame.entry.id)
      : null;
    if (replayVersions.get(i.projectId) !== version) return;
    replaySelections.set(i.projectId, frame);
    c.emit({ type: 'replay', projectId: i.projectId, frame });
  });

  /* cross-window component picking (devices window ↔ editor window) */
  ipc.handle('workbench.pick', (picked) => c.emit({ type: 'pick', picked }));

  /* recorder & imports */
  ipc.handle('recorder.start', (i) => c.recorder.start(i));
  ipc.handle('recorder.stop', (id) => c.recorder.stop(id));
  ipc.handle('recorder.status', (id) => c.recorder.status(id));
  ipc.handle('recorder.discard', (i) => c.recorder.discard(i.projectId, i.stepId));
  ipc.handle('imports.pickFile', async () => {
    const result = await dialog.showOpenDialog(windows.main()!, {
      title: 'Importer des cas de test',
      properties: ['openFile'],
      filters: [{ name: 'Test cases', extensions: ['csv', 'tsv', 'json', 'feature', 'md', 'txt'] }],
    });
    if (result.canceled) return null;
    const file = result.filePaths[0];
    const stat = await fs.stat(file);
    if (stat.size > 8 * 1024 * 1024) throw new Error('Fichier trop volumineux (8 Mo max).');
    return { name: path.basename(file), content: await fs.readFile(file, 'utf8') };
  });

  /* updates */
  ipc.handle('updates.status', () => updater().state);
  ipc.handle('updates.check', () => updater().check());
  ipc.handle('updates.download', () => updater().download());
  ipc.handle('updates.install', () => updater().install());
  ipc.handle('updates.release', () =>
    shell.openExternal(
      updater().state.url ?? 'https://github.com/pickywawa/cybermonkey/releases/latest',
    ),
  );
}
