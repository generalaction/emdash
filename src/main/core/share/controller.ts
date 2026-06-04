import { log } from '@main/lib/logger';
import { createRPCController } from '@shared/ipc/rpc';
import { type SharePayload, type ShareType } from '@shared/share';
import { shareService } from './share-service';

export const shareController = createRPCController({
  create: async (payload: SharePayload) => {
    try {
      const data = await shareService.createShare(payload);
      return { success: true, data };
    } catch (error) {
      log.error('Failed to create share:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  fetch: async (args: { type: ShareType; id: string }) => {
    try {
      const data = await shareService.fetchShare(args.type, args.id);
      return { success: true, data };
    } catch (error) {
      log.error('Failed to fetch share:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
});
