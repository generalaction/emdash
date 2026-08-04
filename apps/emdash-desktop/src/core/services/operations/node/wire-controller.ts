import { createController, expose } from '@emdash/wire';
import { operationsContract } from '@core/services/operations/api';
import type { OperationsEngine } from './operations-engine';

export function createOperationsWireController(operations: OperationsEngine) {
  return createController(operationsContract, {
    retry: ({ operationId }) => operations.retry(operationId),
    forget: ({ operationId }) => operations.forget(operationId),
    cancel: ({ operationId }) => operations.cancel(operationId),
    operationTrees: createOperationTreesProvider(operations),
  });
}

function createOperationTreesProvider(operations: OperationsEngine) {
  return expose(operationsContract.operationTrees, {
    list: (key, scope) => operations.operationTreeState(key, scope),
  });
}
