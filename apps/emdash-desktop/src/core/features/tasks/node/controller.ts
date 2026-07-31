import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import type { TaskService } from '@core/features/tasks/api/node/task-service';
import type { WorkspaceIdentityService } from '@core/features/workspaces/api/node/workspace-identity-service';
import type { CreateTaskParams, DeleteTaskOptions } from '@core/primitives/tasks/api';
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
  const { operations, service: taskService } = dependencies;
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
