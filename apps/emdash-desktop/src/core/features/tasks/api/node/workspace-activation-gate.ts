import type { OperationRecord } from '@emdash/core/primitives/kernel/api';

export type WorkspaceActivationGateDecision =
  | { kind: 'activate' }
  | { kind: 'await-operation'; operationId: string }
  | { kind: 'refuse'; reason: 'missing' | 'corrupted' | 'operation-failed' };

export function didOperationSettleAfterWorkspaceUpdate(
  operation: Pick<OperationRecord, 'updatedAt'>,
  workspaceUpdatedAt: string
): boolean {
  const updatedAt = Date.parse(workspaceUpdatedAt);
  return Number.isFinite(updatedAt) && operation.updatedAt >= updatedAt;
}

export function decideWorkspaceActivation(input: {
  observedStatus: 'present' | 'missing' | 'corrupted' | null;
  explicitOperation?: boolean;
  createOperation?: Pick<OperationRecord, 'id' | 'status'>;
}): WorkspaceActivationGateDecision {
  const operation = input.createOperation;
  if (
    operation &&
    (operation.status === 'pending' ||
      operation.status === 'running' ||
      operation.status === 'waiting-children')
  ) {
    return { kind: 'await-operation', operationId: operation.id };
  }
  if (input.explicitOperation) {
    return operation?.status === 'succeeded'
      ? { kind: 'activate' }
      : { kind: 'refuse', reason: 'operation-failed' };
  }
  if (input.observedStatus === 'present') return { kind: 'activate' };
  if (operation?.status === 'succeeded' && input.observedStatus === null) {
    return { kind: 'activate' };
  }
  if (input.observedStatus === 'missing' || input.observedStatus === 'corrupted') {
    return { kind: 'refuse', reason: input.observedStatus };
  }
  if (!operation) return { kind: 'refuse', reason: 'missing' };
  return { kind: 'refuse', reason: 'operation-failed' };
}
