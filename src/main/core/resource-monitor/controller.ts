import { createRPCController } from '@shared/ipc/rpc';
import { ok } from '@shared/result';
import { appSettingsService } from '@main/core/settings/settings-service';
import { sampleOnce } from './resource-sampler';

export const resourceMonitorController = createRPCController({
  /** One-shot sample of current PTY resource usage. */
  getSnapshot: async () => {
    const { enabled } = await appSettingsService.get('resourceMonitor');
    if (!enabled) return ok(null);
    return ok(await sampleOnce());
  },
});
