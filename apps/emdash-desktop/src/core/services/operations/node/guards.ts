import type { LifecycleOperationRow } from '@core/services/app-db/node/schema';

const STALE_AFTER_MS = 24 * 60 * 60 * 1_000;
const RESUME_AGE_MS = 10 * 60 * 1_000;

export function isOperationStale(operation: LifecycleOperationRow, now: number): boolean {
  return now - (operation.payload.confirmedAt ?? operation.createdAt) > STALE_AFTER_MS;
}

export function isResumedOperation(operation: LifecycleOperationRow, now: number): boolean {
  return operation.attempt > 0 || now - operation.createdAt > RESUME_AGE_MS;
}
