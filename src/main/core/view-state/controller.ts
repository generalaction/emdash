import { createRPCController } from '@shared/ipc/rpc';
import { viewStateService } from './view-state-service';

export const viewStateController = createRPCController({
  save: (key: string, snapshot: unknown): Promise<void> => {
    return viewStateService.save(key, snapshot);
  },
  get: (key: string): Promise<unknown> => viewStateService.get(key),
  del: (key: string): Promise<void> => viewStateService.del(key),
});
