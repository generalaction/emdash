import { appendFileSync } from 'node:fs';
import { createRPCController } from '@shared/ipc/rpc';
import { viewStateService } from './view-state-service';

// #region agent log
const _log = (obj: object) => {
  try {
    appendFileSync(
      '/Users/davidkonopka/Documents/emdash/.cursor/debug-f1d8e3.log',
      JSON.stringify({ sessionId: 'f1d8e3', ...obj, timestamp: Date.now(), runId: 'run5' }) + '\n'
    );
  } catch {}
};
// #endregion

export const viewStateController = createRPCController({
  save: (key: string, snapshot: unknown): Promise<void> => {
    // #region agent log
    _log({
      location: 'controller.ts:save-called',
      message: 'viewStateController.save called',
      hypothesisId: 'I',
      data: { key },
    });
    // #endregion
    return viewStateService.save(key, snapshot);
  },
  get: (key: string): Promise<unknown> => viewStateService.get(key),
  del: (key: string): Promise<void> => viewStateService.del(key),
});
