import type { ManualPreviewServerRequest } from '@shared/core/preview-servers/types';
import { createRPCController } from '@shared/lib/ipc/rpc';
import { previewServerService } from './preview-server-service-instance';

export const previewServersController = createRPCController({
  listForWorkspace: async (args: { projectId: string; workspaceId: string }) =>
    previewServerService.listForWorkspace(args),

  forwardManual: async (request: ManualPreviewServerRequest) =>
    previewServerService.forwardManual(request),

  stop: async (id: string) => previewServerService.stop(id),

  restart: async (id: string) => previewServerService.restart(id),
});
