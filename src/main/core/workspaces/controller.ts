import { createRPCController } from '@shared/ipc/rpc';
import { taskService } from '../tasks/task-service';
import { formatProvisionWorkspaceError } from './workspace-bootstrap-service';

export const workspaceController = createRPCController({
  async provisionWorkspace(taskId: string) {
    const result = await taskService.provisionWorkspace(taskId);
    if (!result.success) throw new Error(formatProvisionWorkspaceError(result.error));
    return { path: result.data };
  },
});
