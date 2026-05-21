import { createRPCController } from '@shared/ipc/rpc';
import type { CreateTaskParams, DeleteTaskOptions, Issue, TaskLifecycleStatus } from '@shared/tasks';
import { generateTaskName } from './name-generation/generateTaskName';
import { formatProvisionTaskError } from './provision-task-error';
import { taskService } from './task-service';

export const taskController = createRPCController({
  async createTask(params: CreateTaskParams) {
    return taskService.createTask(params);
  },
  async getTasks(projectId?: string) {
    return taskService.getTasks(projectId);
  },
  async getDeletePreflight(projectId: string, taskIds: string[]) {
    return taskService.getDeletePreflight(projectId, taskIds);
  },
  async deleteTask(projectId: string, taskId: string, options?: DeleteTaskOptions) {
    return taskService.deleteTask(projectId, taskId, options);
  },
  async deleteTasks(projectId: string, taskIds: string[], options?: DeleteTaskOptions) {
    return taskService.deleteTasks(projectId, taskIds, options);
  },
  async archiveTask(projectId: string, taskId: string) {
    return taskService.archiveTask(projectId, taskId);
  },
  async restoreTask(id: string) {
    return taskService.restoreTask(id);
  },
  async renameTask(projectId: string, taskId: string, newName: string) {
    return taskService.renameTask(projectId, taskId, newName);
  },
  async updateLinkedIssue(taskId: string, issue?: Issue) {
    return taskService.updateLinkedIssue(taskId, issue);
  },
  async updateTaskStatus(taskId: string, status: TaskLifecycleStatus) {
    return taskService.updateTaskStatus(taskId, status);
  },
  async setTaskPinned(taskId: string, isPinned: boolean) {
    return taskService.setTaskPinned(taskId, isPinned);
  },
  async provisionTask(taskId: string) {
    const result = await taskService.provision(taskId);
    if (!result.success) {
      throw new Error(`Failed to provision task: ${formatProvisionTaskError(result.error)}`);
    }
    return result.data;
  },
  async teardownTask(_projectId: string, taskId: string) {
    return taskService.teardown(taskId, 'terminate');
  },
  generateTaskName,
});
