import path from 'node:path';
import type { LiveEvent } from '../shared/ipc.js';
import type { LoginProgress } from '../shared/domain/settings.js';
import { AiHub } from './infra/ai/hub.js';
import { AppiumServer } from './infra/appium/server.js';
import { Automation } from './infra/appium/automation.js';
import { DeviceDiagnostics } from './infra/devices/health.js';
import { DeviceMonitor, Devices } from './infra/devices/scanner.js';
import { CampaignStore } from './infra/storage/campaign-store.js';
import { WorkspaceStore } from './infra/storage/workspace-store.js';
import { CreationAgent } from './engine/creation/agent.js';
import { Runner } from './engine/execution/runner.js';
import { Recorder } from './engine/recorder/recorder.js';
import { IntegrationHub } from './integrations/hub.js';
import { followLanguage } from './integrations/i18n.js';
import { SecretStore, type Cipher } from './integrations/secrets.js';
import { RemoteDevices } from './infra/remote/remote-devices.js';
import { adbTarget } from '../shared/domain/remote.js';

/** Composition root: every service is built here once and injected, nothing is a hidden singleton. */
export async function createContainer(options: {
  userData: string;
  documents: string;
  emit: (event: LiveEvent) => void;
  openAuthUrl: (url: string) => Promise<void>;
  /** Encrypts stored secrets with the OS keychain (desktop app). */
  cipher?: Cipher;
  /** A window can answer confirmation questions. False from the command line. */
  interactive?: boolean;
}) {
  // Every event reaches the window and the integrations (notifications, tickets, git…).
  let integrations: IntegrationHub | undefined;
  const emit = (event: LiveEvent) => {
    options.emit(event);
    integrations?.handle(event);
  };
  const store = new WorkspaceStore(options.userData, options.documents);
  await store.load();
  const settings = () => store.state.settings;
  const campaigns = new CampaignStore((projectId) => store.get(projectId).directory);
  followLanguage(() => settings().language);
  // Credentials (integrations and device clouds) live in one place, apart from the settings.
  const secrets = new SecretStore(
    path.join(options.userData, 'integrations', 'secrets.json'),
    options.cipher,
  );
  const remote = new RemoteDevices({ settings, secrets });

  const devices = new Devices(() => ({
    url: settings().wdaUrl,
    udid: settings().wdaDeviceId,
    mode: settings().iosWdaMode,
    platformVersion: settings().iosPlatformVersion,
  }));
  const server = new AppiumServer(settings, path.join(options.userData, 'appium'));
  const automation = new Automation(
    server,
    (id) => devices.known.get(id),
    settings,
    emit,
    path.join(options.userData, 'appium'),
    () => {
      const project = store.activeProject();
      return project ? Object.values(project.deviceIds).filter((id): id is string => !!id) : [];
    },
  );
  devices.automationScreenshot = (id) => automation.screenshot(id);
  automation.remote = remote;
  devices.remoteSource = {
    ensureAdb: (listed) => remote.adb.ensure(settings().remote.adb.hosts, listed),
    adbPlaceholders: (listed) =>
      settings()
        .remote.adb.hosts.map(adbTarget)
        .filter((host) => host && !listed.has(host))
        .map((host) => ({
          id: `android:${host}`,
          name: host,
          platform: 'android' as const,
          kind: 'network' as const,
          status: 'offline' as const,
          detail: remote.adb.states([host], new Map())[0]?.detail ?? host,
        })),
    profiles: () => remote.devices(),
  };
  const monitor = new DeviceMonitor(
    devices,
    (scan) => emit({ type: 'devices', scan }),
    () => settings().deviceAutoRefresh,
  );
  const diagnostics = new DeviceDiagnostics(automation, server, settings);
  diagnostics.remote = remote;

  const hub = new AiHub(
    settings,
    (progress: LoginProgress) => emit({ type: 'login', progress }),
    options.openAuthUrl,
  );
  const creation = new CreationAgent({ store, devices, automation, hub, settings, live: emit });
  const runner = new Runner({
    store,
    campaigns,
    automation,
    devices,
    hub,
    recovery: creation.recovery,
    settings,
    emit,
  });
  const recorder = new Recorder({ store, devices, automation, hub, settings, live: emit });
  integrations = new IntegrationHub({
    userData: options.userData,
    settings,
    store,
    campaigns,
    loadCampaign: (projectId, campaignId) => runner.loadCampaign(projectId, campaignId),
    isBusy: () => runner.isRunning(),
    ai: hub,
    emit: options.emit,
    interactive: options.interactive ?? false,
    cipher: options.cipher,
    secrets,
  });

  return {
    store,
    campaigns,
    devices,
    server,
    automation,
    monitor,
    diagnostics,
    hub,
    creation,
    runner,
    recorder,
    integrations,
    remote,
    secrets,
    emit,
    settings,
    async stop() {
      integrations.stop();
      monitor.stop();
      recorder.stopAll();
      creation.stop();
      runner.cancel();
      await Promise.allSettled([hub.stop(), runner.stop()]);
      await automation.stop();
    },
  };
}
export type Container = Awaited<ReturnType<typeof createContainer>>;
