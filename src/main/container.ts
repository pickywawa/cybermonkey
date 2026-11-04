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

/** Composition root: every service is built here once and injected, nothing is a hidden singleton. */
export async function createContainer(options: {
  userData: string;
  documents: string;
  emit: (event: LiveEvent) => void;
  openAuthUrl: (url: string) => Promise<void>;
}) {
  const { emit } = options;
  const store = new WorkspaceStore(options.userData, options.documents);
  await store.load();
  const settings = () => store.state.settings;
  const campaigns = new CampaignStore((projectId) => store.get(projectId).directory);

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
  const monitor = new DeviceMonitor(
    devices,
    (scan) => emit({ type: 'devices', scan }),
    () => settings().deviceAutoRefresh,
  );
  const diagnostics = new DeviceDiagnostics(automation, server, settings);

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
    emit,
    settings,
    async stop() {
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
