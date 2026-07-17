import type { Contract, ContractImpl, LeasedLiveModelProvider } from '@emdash/wire';
import { tasksWireContract } from '@core/features/tasks/api';
import { taskEvents } from '@core/features/tasks/node';
import type { OperationsService } from '@main/core/operations/operations-service';
import { taskOperations } from './controller';

type ContractDefinitionsOf<TContract> = TContract extends Contract<infer Defs> ? Defs : never;
type TasksWireImpl = ContractImpl<ContractDefinitionsOf<typeof tasksWireContract>>;

export type TasksWireController = {
  impl: TasksWireImpl;
  dispose(): Promise<void>;
};

export function createTasksWireController(): TasksWireController {
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
      delete: async (input) => {
        const operationsService = await getOperationsService();
        await operationsService.initialize();
        return operationsService.enqueueDeleteTask(input);
      },
      retryDelete: async (input) => {
        const operationsService = await getOperationsService();
        await operationsService.initialize();
        return operationsService.retryDelete('task', input.taskId);
      },
      forgetWithoutCleanup: async (input) => {
        const operationsService = await getOperationsService();
        await operationsService.initialize();
        return operationsService.forgetWithoutCleanup('task', input.taskId);
      },
      deletions: createTaskDeletionsProvider(),
    },
    async dispose() {},
  };
}

function createTaskDeletionsProvider(): LeasedLiveModelProvider<
  typeof tasksWireContract.deletions
> {
  return {
    kind: 'leasedLiveModelProvider',
    contract: tasksWireContract.deletions,
    acquireState(key, name) {
      let lease: ReturnType<OperationsService['acquireDeletionState']> | undefined;
      let released = false;
      return {
        ready: async () => {
          if (name !== 'list') throw new Error(`Unknown task deletion state '${String(name)}'`);
          if (released) throw new Error('Task deletion state lease was released before ready');
          const operationsService = await getOperationsService();
          await operationsService.initialize();
          lease ??= operationsService.acquireDeletionState('task', key.entityId);
          if (released) {
            await lease.release();
            throw new Error('Task deletion state lease was released before ready');
          }
          return lease.ready();
        },
        release: async () => {
          released = true;
          await lease?.release();
        },
      };
    },
    async runMutation() {
      throw new Error('Task deletions model does not expose mutations');
    },
    async dispose() {},
  };
}

async function getOperationsService(): Promise<OperationsService> {
  return (await import('@main/core/operations/operations-service')).operationsService;
}
