import { createRPCController } from '@shared/lib/ipc/rpc';
import { deleteStorageTasks } from './operations/delete-storage-tasks';
import { listTaskStorageUsage } from './operations/list-task-storage-usage';

export const storageController = createRPCController({
  async listTaskStorageUsage(projectId?: string) {
    return listTaskStorageUsage(projectId);
  },
  async deleteTasks(taskIds: string[]) {
    return deleteStorageTasks(taskIds);
  },
});
