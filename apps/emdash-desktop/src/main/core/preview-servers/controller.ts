import type { ManualPreviewServerRequest } from '@shared/core/preview-servers/types';
import { createRPCController } from '@shared/lib/ipc/rpc';
import { previewServerService } from './preview-server-service-instance';

export const previewServersController = createRPCController({
  listForWorkspace: async (args: { projectId: string; workspaceId: string }) =>
    previewServerService.listForWorkspace(args),

  listAll: async () => previewServerService.listAll(),

  forwardManual: async (request: ManualPreviewServerRequest) =>
    previewServerService.forwardManual(request),

  stop: async (id: string) => previewServerService.stop(id),

  stopForWorkspace: async (args: { projectId: string; workspaceId: string }) =>
    previewServerService.stopForWorkspace(args.projectId, args.workspaceId),

  stopAll: async () => previewServerService.stopAll(),

  restart: async (id: string) => previewServerService.restart(id),
});
