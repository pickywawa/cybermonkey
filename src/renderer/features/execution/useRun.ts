import { useState } from 'react';
import { call } from '../../shared/api';
import { useActions, useActiveDevices, useApp } from '../../app/store';

/** Starting and stopping runs, shared by the tree's ▶ buttons and the campaign toolbar. */
export function useRun() {
  const { project, projectOs, run } = useApp();
  const actions = useActions();
  const devices = useActiveDevices();
  const [error, setError] = useState<unknown>(null);
  const [starting, setStarting] = useState(false);
  const running = run?.status === 'running';
  const start = async (opts: { nodeId?: string; resetCampaign?: boolean } = {}) => {
    if (!project?.activeCampaignId) return;
    setStarting(true);
    setError(null);
    try {
      const report = await call('runs.start', {
        projectId: project.id,
        campaignId: project.activeCampaignId,
        platforms: projectOs,
        nodeId: opts.nodeId,
        resetCampaign: opts.resetCampaign,
        deviceIds: Object.values(devices),
      });
      actions.setRun(report);
    } catch (e) {
      setError(e);
    } finally {
      setStarting(false);
    }
  };
  return {
    start,
    stop: () => void call('runs.cancel'),
    running,
    starting,
    error,
    clearError: () => setError(null),
    missing: projectOs.filter((os) => !devices[os]),
  };
}
