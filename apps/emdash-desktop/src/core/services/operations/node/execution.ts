import {
  nonTerminalOperationStatuses,
  nextOperationStatus,
  type OperationConfirmationReason,
  requireNextOperationStatus,
  type OperationStatusEvent,
  type OperationStatus,
} from '@emdash/core/primitives/operations/api';
import { err, type Result } from '@emdash/shared';
import { log } from '@emdash/shared/logger';
import type { Clock } from '@emdash/shared/scheduling';
import { and, eq, inArray } from 'drizzle-orm';
import type { OperationKind } from '@core/primitives/operations/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { lifecycleOperations, type LifecycleOperationRow } from '@core/services/app-db/node/schema';
import type { OperationDefinition, OperationProgress, OperationRunError } from './definition';

const RETRY_DELAYS_MS = [1_000, 4_000];

export type OperationExecutionContext = {
  db: AppDb;
  clock: Clock;
  definitions: Map<OperationKind, OperationDefinition>;
  progress: Map<string, OperationProgress>;
  hostIsOnline(hostRef: string): boolean;
  refreshOperationTrees(projectId?: string): Promise<void>;
  publishPendingCleanup(
    operation: Pick<LifecycleOperationRow, 'id' | 'payload' | 'hostRef'>,
    reason: OperationConfirmationReason
  ): void;
  poke(): void;
};

export async function queuedOperations(db: AppDb): Promise<LifecycleOperationRow[]> {
  return await db
    .select()
    .from(lifecycleOperations)
    .where(inArray(lifecycleOperations.status, ['pending', 'running']))
    .orderBy(lifecycleOperations.createdAt);
}

export async function operationIsRunnable(
  context: Pick<OperationExecutionContext, 'db' | 'definitions' | 'hostIsOnline'>,
  operation: LifecycleOperationRow
): Promise<boolean> {
  const definition = context.definitions.get(operation.kind);
  if (!definition) return true;
  if (!context.hostIsOnline(operation.hostRef)) return false;
  if (definition.isReady && !(await definition.isReady({ operation, db: context.db }))) {
    return false;
  }
  return true;
}

export async function runQueuedOperation(
  context: OperationExecutionContext,
  operation: LifecycleOperationRow,
  signal: AbortSignal
): Promise<void> {
  const definition = context.definitions.get(operation.kind);
  if (!definition) {
    await failMissingDefinition(context, operation);
    return;
  }
  if (!context.hostIsOnline(operation.hostRef)) return;
  if (definition.isReady && !(await definition.isReady({ operation, db: context.db }))) {
    return;
  }
  await runOperation(context, operation, definition, signal);
}

async function runOperation(
  context: OperationExecutionContext,
  operation: LifecycleOperationRow,
  definition: OperationDefinition,
  signal: AbortSignal
): Promise<void> {
  const runningStatus = tryTransitionStatus(operation, { type: 'started' });
  if (!runningStatus) return;
  const current = { ...operation, status: 'running' as const };
  await context.db
    .update(lifecycleOperations)
    .set({ status: runningStatus, attempt: operation.attempt + 1, error: null })
    .where(eq(lifecycleOperations.id, operation.id));
  await context.refreshOperationTrees(operation.projectId ?? undefined);

  const result = await runWithRetries(context, current, definition, signal);
  context.progress.delete(operation.id);
  if (result.success) {
    await context.db
      .update(lifecycleOperations)
      .set({
        status: transitionStatus(current.status, { type: 'run-succeeded' }),
        finishedAt: context.clock.now(),
        error: null,
      })
      .where(eq(lifecycleOperations.id, operation.id));
    await settleParentIfChildrenDone(context, operation);
  } else if (result.error.type === 'awaiting-confirmation') {
    await awaitConfirmation(context, operation, result.error.reason, result.error.message);
    return;
  } else if (!signal.aborted) {
    const error = result.error.message;
    await context.db
      .update(lifecycleOperations)
      .set({
        status: transitionStatus(current.status, {
          type: 'run-failed',
          error,
          retryable: result.error.retryable,
        }),
        error,
      })
      .where(eq(lifecycleOperations.id, operation.id));
  }
  await context.refreshOperationTrees(operation.projectId ?? undefined);
}

export async function settleParentIfChildrenDone(
  context: Pick<OperationExecutionContext, 'db' | 'refreshOperationTrees' | 'poke'>,
  child: LifecycleOperationRow
): Promise<void> {
  if (!child.parentOperationId) return;
  const settled = context.db.transaction((tx) => {
    const [liveChild] = tx
      .select({ id: lifecycleOperations.id })
      .from(lifecycleOperations)
      .where(
        and(
          eq(lifecycleOperations.parentOperationId, child.parentOperationId!),
          inArray(lifecycleOperations.status, [...nonTerminalOperationStatuses])
        )
      )
      .limit(1)
      .all();
    if (liveChild) return false;
    const status = requireNextOperationStatus('waiting-children', { type: 'children-settled' });
    const changes = tx
      .update(lifecycleOperations)
      .set({ status })
      .where(
        and(
          eq(lifecycleOperations.id, child.parentOperationId!),
          eq(lifecycleOperations.status, 'waiting-children')
        )
      )
      .run().changes;
    return changes > 0;
  });
  if (!settled) return;
  await context.refreshOperationTrees(child.projectId ?? undefined);
  context.poke();
}

export async function settleWaitingParents(db: AppDb): Promise<number> {
  return db.transaction((tx) => {
    const parents = tx
      .select({ id: lifecycleOperations.id })
      .from(lifecycleOperations)
      .where(eq(lifecycleOperations.status, 'waiting-children'))
      .all();
    let settledCount = 0;
    for (const parent of parents) {
      const [liveChild] = tx
        .select({ id: lifecycleOperations.id })
        .from(lifecycleOperations)
        .where(
          and(
            eq(lifecycleOperations.parentOperationId, parent.id),
            inArray(lifecycleOperations.status, [...nonTerminalOperationStatuses])
          )
        )
        .limit(1)
        .all();
      if (liveChild) continue;
      const status = requireNextOperationStatus('waiting-children', {
        type: 'children-settled',
      });
      settledCount += tx
        .update(lifecycleOperations)
        .set({ status })
        .where(
          and(
            eq(lifecycleOperations.id, parent.id),
            eq(lifecycleOperations.status, 'waiting-children')
          )
        )
        .run().changes;
    }
    return settledCount;
  });
}

async function runWithRetries(
  context: OperationExecutionContext,
  operation: LifecycleOperationRow,
  definition: OperationDefinition,
  signal: AbortSignal
): Promise<Result<void, OperationRunError>> {
  let retryIndex = 0;
  for (;;) {
    let result: Result<void, OperationRunError>;
    try {
      result = await definition.run({
        operation,
        db: context.db,
        signal,
        clock: context.clock,
        reportProgress: (progress) => {
          context.progress.set(operation.id, progress);
          void context.refreshOperationTrees(operation.projectId ?? undefined);
        },
      });
    } catch (error) {
      result = err({
        type: 'failed',
        code: 'operation-failed',
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
      });
    }

    if (
      result.success ||
      result.error.type === 'awaiting-confirmation' ||
      !result.error.retryable ||
      retryIndex >= RETRY_DELAYS_MS.length
    ) {
      return result;
    }
    await context.clock.sleep(RETRY_DELAYS_MS[retryIndex], { signal });
    retryIndex += 1;
  }
}

async function awaitConfirmation(
  context: OperationExecutionContext,
  operation: LifecycleOperationRow,
  reason: OperationConfirmationReason,
  message?: string
): Promise<void> {
  await context.db
    .update(lifecycleOperations)
    .set({
      status: transitionStatus('running', { type: 'needs-confirmation', reason }),
      attempt: operation.attempt,
      error: message ?? null,
      confirmationReason: reason,
    })
    .where(eq(lifecycleOperations.id, operation.id));
  context.publishPendingCleanup(operation, reason);
  await context.refreshOperationTrees(operation.projectId ?? undefined);
}

async function failMissingDefinition(
  context: OperationExecutionContext,
  operation: LifecycleOperationRow
): Promise<void> {
  const error = `No operation definition is registered for '${operation.kind}'`;
  const failedStatus = tryTransitionStatus(operation, {
    type: 'run-failed',
    error,
    retryable: false,
  });
  if (!failedStatus) return;
  await context.db
    .update(lifecycleOperations)
    .set({
      status: failedStatus,
      error,
    })
    .where(eq(lifecycleOperations.id, operation.id));
  await context.refreshOperationTrees(operation.projectId ?? undefined);
}

export function transitionStatus(
  current: OperationStatus,
  event: OperationStatusEvent
): OperationStatus {
  return requireNextOperationStatus(current, event);
}

export function tryTransitionStatus(
  operation: Pick<LifecycleOperationRow, 'id' | 'kind' | 'status'>,
  event: OperationStatusEvent
): OperationStatus | undefined {
  const result = nextOperationStatus(operation.status, event);
  if (result.success) return result.data;
  log.warn('illegal lifecycle operation status transition', {
    operationId: operation.id,
    kind: operation.kind,
    current: result.error.current,
    event: result.error.event,
  });
  return undefined;
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
