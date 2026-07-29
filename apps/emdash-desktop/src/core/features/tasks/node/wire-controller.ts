import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import type { Contract, ContractImpl } from '@emdash/wire';
import type { tasksWireContract } from '@core/features/tasks/api';
import type { TaskService } from '@core/features/tasks/api/node/task-service';
import { taskEvents } from '@core/features/tasks/node';
import { enqueueDeleteTask } from '@core/features/tasks/node/operations/delete-task-definition';
import type { WorkspaceIdentityService } from '@core/features/workspaces/api/node/workspace-identity-service';
import type { TelemetryService } from '@core/primitives/telemetry/api/telemetry';
import type { AppDb } from '@core/services/app-db/node/db';
import type { OperationsEngine } from '@core/services/operations/node';
import { createTaskOperations } from './controller';

type ContractDefinitionsOf<TContract> = TContract extends Contract<infer Defs> ? Defs : never;
type TasksWireImpl = ContractImpl<ContractDefinitionsOf<typeof tasksWireContract>>;

export type TasksWireController = {
  impl: TasksWireImpl;
  dispose(): Promise<void>;
};

export function createTasksWireController(options: {
  db: AppDb;
  operations: OperationsEngine;
  runtimes: RuntimeBroker;
  service: TaskService;
  telemetry: TelemetryService;
  workspaceIdentity: WorkspaceIdentityService;
}): TasksWireController {
  const { operations } = options;
  const taskOperations = createTaskOperations(options);
  return {
    impl: {
      createTask: (input) => taskOperations.createTask(input),
      getTasks: ({ projectId }) => taskOperations.getTasks(projectId),
      getDeletePreflight: ({ projectId, taskIds }) =>
        taskOperations.getDeletePreflight(projectId, taskIds),
      deleteTask: ({ projectId, taskId, options }) =>
        taskOperations.deleteTask(projectId, taskId, options),
      deleteTasks: ({ projectId, taskIds, options }) =>
        taskOperations.deleteTasks(projectId, taskIds, options),
      archiveTask: ({ projectId, taskId }) => taskOperations.archiveTask(projectId, taskId),
      restoreTask: ({ taskId }) => taskOperations.restoreTask(taskId),
      renameTask: ({ projectId, taskId, newName }) =>
        taskOperations.renameTask(projectId, taskId, newName),
      updateLinkedIssue: ({ taskId, issue }) => taskOperations.updateLinkedIssue(taskId, issue),
      updateTaskStatus: ({ taskId, status }) => taskOperations.updateTaskStatus(taskId, status),
      setTaskPinned: ({ taskId, isPinned }) => taskOperations.setTaskPinned(taskId, isPinned),
      convertAutomationTask: ({ taskId }) => taskOperations.convertAutomationTask(taskId),
      getProjectWorkspaces: ({ projectId }) => taskOperations.getProjectWorkspaces(projectId),
      teardownTask: ({ projectId, taskId }) => taskOperations.teardownTask(projectId, taskId),
      generateTaskName: (input) => taskOperations.generateTaskName(input),
      events: taskEvents,
      delete: (input) => enqueueDeleteTask(operations, input),
    },
    async dispose() {},
  };
}
