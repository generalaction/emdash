import { createRPCController } from '@shared/lib/ipc/rpc';
import { featureAnnouncementsService } from './service';

export const featureAnnouncementsController = createRPCController({
  getCurrent: async () => {
    try {
      const manifest = await featureAnnouncementsService.getCurrent();
      return { success: true as const, data: manifest };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
  preview: async () => {
    if (!import.meta.env.DEV) {
      return { success: false as const, error: 'Preview is only available in development builds' };
    }

    try {
      const manifest = await featureAnnouncementsService.preview();
      return { success: true as const, data: manifest };
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
