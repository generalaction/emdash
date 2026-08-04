import type { OperationRecord } from '@emdash/core/primitives/kernel/api';

export type WorkspaceActivationGateDecision =
  | { kind: 'activate' }
  | { kind: 'await-operation'; operationId: string }
  | { kind: 'refuse'; reason: 'missing' | 'corrupted' | 'operation-failed' };

export function decideWorkspaceActivation(input: {
  observedStatus: 'present' | 'missing' | 'corrupted' | null;
  createOperation?: Pick<OperationRecord, 'id' | 'status'>;
}): WorkspaceActivationGateDecision {
  if (input.observedStatus === 'present') return { kind: 'activate' };
  if (input.observedStatus === 'missing' || input.observedStatus === 'corrupted') {
    return { kind: 'refuse', reason: input.observedStatus };
  }
  const operation = input.createOperation;
  if (!operation) return { kind: 'refuse', reason: 'missing' };
  if (
    operation.status === 'pending' ||
    operation.status === 'running' ||
    operation.status === 'waiting-children'
  ) {
    return { kind: 'await-operation', operationId: operation.id };
  }
  return operation.status === 'succeeded'
    ? { kind: 'activate' }
    : { kind: 'refuse', reason: 'operation-failed' };
}
