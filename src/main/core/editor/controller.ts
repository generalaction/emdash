import { createRPCController } from '@shared/ipc/rpc';
import { editorBufferService } from './editor-buffer-service';

export const editorBufferController = createRPCController({
  saveBuffer: (projectId: string, workspaceId: string, filePath: string, content: string) =>
    editorBufferService.saveBuffer(projectId, workspaceId, filePath, content),

  clearBuffer: (projectId: string, workspaceId: string, filePath: string) =>
    editorBufferService.clearBuffer(projectId, workspaceId, filePath),

  listBuffers: (projectId: string, workspaceId: string) =>
    editorBufferService.listBuffers(projectId, workspaceId),
});
