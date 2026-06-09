import { appSettingsService } from '@main/core/settings/settings-service';
import { createRPCController } from '@shared/lib/ipc/rpc';
import { ok } from '@shared/lib/result';
import { sampleOnce, setResourceMonitorOpen } from './resource-sampler';

export const resourceMonitorController = createRPCController({
  /** One-shot sample of current PTY resource usage. */
  getSnapshot: async () => {
    const { enabled } = await appSettingsService.get('resourceMonitor');
    if (!enabled) return ok(null);
    return ok(await sampleOnce());
  },

  setOpen: (clientId: string, subscriptionId: string, open: boolean, sequence: number) => {
    setResourceMonitorOpen(clientId, subscriptionId, open, sequence);
    return ok();
  },
});
