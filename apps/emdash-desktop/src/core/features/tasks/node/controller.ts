import type { TaskService } from '@core/features/tasks/api/node/task-service';
import type { TaskSessionManager } from '@core/features/tasks/api/node/task-session-manager';
import type { CreateTaskParams, DeleteTaskOptions } from '@core/primitives/tasks/api';
import type { TelemetryService } from '@core/primitives/telemetry/api/telemetry';
import type { AppDb } from '@core/services/app-db/node/db';
import type { OperationsEngine } from '@core/services/operations/node';
import { generateTaskName } from './name-generation/generateTaskName';
import { getProjectWorkspaces } from './operations/getProjectWorkspaces';

export function createTaskOperations(dependencies: {
  db: AppDb;
  operations: OperationsEngine;
  service: TaskService;
  taskSessions: Pick<TaskSessionManager, 'getTask'>;
  telemetry: TelemetryService;
}) {
  const { operations, service: taskService } = dependencies;
  return {
    async createTask(params: CreateTaskParams) {
      return taskService.createTask(operations, params);
    },
    async getTasks(projectId?: string) {
      return taskService.getTasks(projectId);
    },
    async getDeletePreflight(_projectId: string, taskIds: string[]) {
      return taskService.getDeletePreflight(operations, taskIds);
    },
    async deleteTask(projectId: string, taskId: string, options?: DeleteTaskOptions) {
      return taskService.deleteTask(operations, projectId, taskId, options);
    },
    async deleteTasks(projectId: string, taskIds: string[], options?: DeleteTaskOptions) {
      return taskService.deleteTasks(operations, projectId, taskIds, options);
    },
    async getProjectWorkspaces(projectId: string) {
      return getProjectWorkspaces(
        { db: dependencies.db, taskSessions: dependencies.taskSessions },
        projectId
      );
    },
    async teardownTask(_projectId: string, taskId: string) {
      return taskService.teardown(taskId, 'terminate');
    },
    generateTaskName,
  };
}
