import type { Contract, ContractImpl, LeasedLiveModelProvider } from '@emdash/wire';
import type { OperationsService } from '@main/core/operations/operations-service';
import { tasksWireContract } from '@shared/core/tasks/wire-contract';

type ContractDefinitionsOf<TContract> = TContract extends Contract<infer Defs> ? Defs : never;
type TasksWireImpl = ContractImpl<ContractDefinitionsOf<typeof tasksWireContract>>;

export type TasksWireController = {
  impl: TasksWireImpl;
  dispose(): Promise<void>;
};

export function createTasksWireController(): TasksWireController {
  return {
    impl: {
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
