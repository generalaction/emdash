import { createRPCController } from '@shared/ipc/rpc';
import { editorBufferService } from './editor-buffer-service';

export const editorBufferController = createRPCController({
  saveBuffer: (projectId: string, taskId: string, filePath: string, content: string) =>
    editorBufferService.saveBuffer(projectId, taskId, filePath, content),

  clearBuffer: (projectId: string, taskId: string, filePath: string) =>
    editorBufferService.clearBuffer(projectId, taskId, filePath),

  listBuffers: (projectId: string, taskId: string) =>
    editorBufferService.listBuffers(projectId, taskId),
});
