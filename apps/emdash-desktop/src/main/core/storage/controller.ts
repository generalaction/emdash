import { createRPCController } from '@shared/lib/ipc/rpc';
import { deleteStorageTasks, listTaskStorageUsage } from './storage-service';

export const storageController = createRPCController({
  async listTaskStorageUsage(projectId?: string) {
    return listTaskStorageUsage(projectId);
  },
  async deleteTasks(taskIds: string[]) {
    return deleteStorageTasks(taskIds);
  },
});
