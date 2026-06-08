import { createRPCController } from '@shared/ipc/rpc';
import { ok } from '@shared/result';
import { getUsageSnapshot, refreshUsage } from './operations';

export const usageStatsController = createRPCController({
  getSnapshot: async () => ok(await getUsageSnapshot()),
  refresh: async () => ok(await refreshUsage()),
});
