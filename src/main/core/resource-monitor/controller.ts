import { createRPCController } from '@shared/ipc/rpc';
import { ok } from '@shared/result';
import { sampleOnce } from './resource-sampler';

export const resourceMonitorController = createRPCController({
  /** One-shot sample of current PTY resource usage. */
  getSnapshot: async () => {
    return ok(await sampleOnce());
  },
});
