import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import type { TaskService } from '@core/features/tasks/api/node/task-service';
import type { WorkspaceIdentityService } from '@core/features/workspaces/api/node/workspace-identity-service';
import type { LinkedIssue } from '@core/primitives/linked-issues/api';
import type {
  CreateTaskParams,
  DeleteTaskOptions,
  TaskLifecycleStatus,
} from '@core/primitives/tasks/api';
import type { TelemetryService } from '@core/primitives/telemetry/api/telemetry';
import type { AppDb } from '@core/services/app-db/node/db';
import type { OperationsEngine } from '@core/services/operations/node';
import { generateTaskName } from './name-generation/generateTaskName';
import { getProjectWorkspaces } from './operations/getProjectWorkspaces';

export function createTaskOperations(dependencies: {
  db: AppDb;
  operations: OperationsEngine;
  runtimes: RuntimeBroker;
  service: TaskService;
  telemetry: TelemetryService;
  workspaceIdentity: WorkspaceIdentityService;
}) {
  const { operations, service: taskService, telemetry } = dependencies;
  return {
    async createTask(params: CreateTaskParams) {
      return taskService.createTask(operations, params);
    },
    async getTasks(projectId?: string) {
      return taskService.getTasks(projectId);
    },
    async getDeletePreflight(projectId: string, taskIds: string[]) {
      return taskService.getDeletePreflight(projectId, taskIds);
    },
    async deleteTask(projectId: string, taskId: string, options?: DeleteTaskOptions) {
      return taskService.deleteTask(operations, projectId, taskId, options);
    },
    async deleteTasks(projectId: string, taskIds: string[], options?: DeleteTaskOptions) {
      return taskService.deleteTasks(operations, projectId, taskIds, options);
    },
    async archiveTask(projectId: string, taskId: string) {
      return taskService.archiveTask(projectId, taskId, telemetry);
    },
    async restoreTask(id: string) {
      return taskService.restoreTask(id);
    },
    async renameTask(projectId: string, taskId: string, newName: string) {
      return taskService.renameTask(projectId, taskId, newName);
    },
    async updateLinkedIssue(taskId: string, issue?: LinkedIssue) {
      return taskService.updateLinkedIssue(taskId, issue, telemetry);
    },
    async updateTaskStatus(taskId: string, status: TaskLifecycleStatus) {
      return taskService.updateTaskStatus(taskId, status, telemetry);
    },
    async setTaskPinned(taskId: string, isPinned: boolean) {
      return taskService.setTaskPinned(taskId, isPinned);
    },
    async convertAutomationTask(taskId: string) {
      return taskService.convertAutomationTask(taskId);
    },
    async getProjectWorkspaces(projectId: string) {
      return getProjectWorkspaces(
        {
          db: dependencies.db,
          runtimes: dependencies.runtimes,
          workspaceIdentity: dependencies.workspaceIdentity,
        },
        projectId
      );
    },
    async teardownTask(_projectId: string, taskId: string) {
      return taskService.teardown(taskId, 'terminate');
    },
    generateTaskName,
  };
}
