import type { OperationConfirmationReason } from '@emdash/core/primitives/operations/api';
import { err, type Result } from '@emdash/shared';
import type { OperationRunError } from './definition';
import type { LifecycleOperationRow } from './lifecycle-operation';

const STALE_AFTER_MS = 24 * 60 * 60 * 1_000;
const RESUME_AGE_MS = 10 * 60 * 1_000;

export function isOperationStale(operation: LifecycleOperationRow, now: number): boolean {
  return now - (operation.confirmedAt ?? operation.createdAt) > STALE_AFTER_MS;
}

export function isResumedOperation(operation: LifecycleOperationRow, now: number): boolean {
  return operation.attempt > 0 || now - operation.createdAt > RESUME_AGE_MS;
}

export function operationNeedsConfirmation(
  reason: OperationConfirmationReason
): Result<void, OperationRunError> {
  return err({ type: 'awaiting-confirmation', reason });
}

export function operationFailed(
  message: string,
  options: { code?: string; retryable?: boolean } = {}
): Result<void, OperationRunError> {
  return err({
    type: 'failed',
    code: options.code ?? 'operation-failed',
    message,
    retryable: options.retryable ?? true,
  });
}
