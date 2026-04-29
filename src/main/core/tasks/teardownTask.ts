import { taskManager } from '../projects/task-manager';

export async function teardownTask(_projectId: string, taskId: string) {
  return await taskManager.teardownTask(taskId, 'terminate');
}
