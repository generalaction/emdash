import { createController, type LeasedLiveModelProvider } from '@emdash/wire';
import { operationsContract } from '@core/services/operations/api';
import type { OperationsEngine } from './operations-engine';

export function createOperationsWireController(operations: OperationsEngine) {
  return createController(operationsContract, {
    retry: ({ operationId }) => operations.retry(operationId),
    forget: ({ operationId }) => operations.forget(operationId),
    operationTrees: createOperationTreesProvider(operations),
  });
}

function createOperationTreesProvider(
  operations: OperationsEngine
): LeasedLiveModelProvider<typeof operationsContract.operationTrees> {
  return {
    kind: 'leasedLiveModelProvider',
    contract: operationsContract.operationTrees,
    acquireState(key, name) {
      let lease: ReturnType<OperationsEngine['acquireOperationTreeState']> | undefined;
      let released = false;
      return {
        ready: async () => {
          if (name !== 'list') {
            throw new Error(`Unknown operation tree state '${String(name)}'`);
          }
          if (released) throw new Error('Operation tree state lease was released before ready');
          lease ??= operations.acquireOperationTreeState(key.projectId);
          if (released) {
            await lease.release();
            throw new Error('Operation tree state lease was released before ready');
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
      throw new Error('Operation tree model does not expose mutations');
    },
    async dispose() {},
  };
}
