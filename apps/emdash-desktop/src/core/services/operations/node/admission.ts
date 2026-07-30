import { randomUUID } from 'node:crypto';
import { desc, and, eq, inArray } from 'drizzle-orm';
import {
  nonTerminalOperationStatuses,
  operationClaimResourceKey,
  type OperationClaimResource,
  type OperationMutationError,
  type OperationStatus,
} from '@core/primitives/operations/api';
import type { AppDb, DrizzleTx } from '@core/services/app-db/node/db';
import {
  lifecycleOperations,
  operationClaims,
  type LifecycleOperationRow,
} from '@core/services/app-db/node/schema';
import type { OperationDraft, OperationDraftInput, OperationInsertOptions } from './definition';

export type InsertOperationOutcome =
  | { outcome: 'inserted' }
  | { outcome: 'duplicate'; operationId?: string }
  | { outcome: 'precondition-failed'; error: OperationMutationError };

export class RelatedOperationInsertError extends Error {
  constructor(
    readonly error: OperationMutationError,
    readonly draft: OperationDraft
  ) {
    super(error.message);
    this.name = 'RelatedOperationInsertError';
  }
}

export function buildOperationDraft(options: {
  input: OperationDraftInput;
  initiatedBy: string | undefined;
  now: number;
}): OperationDraft {
  const { input } = options;
  return {
    id: input.id ?? randomUUID(),
    kind: input.kind,
    status: input.status ?? 'pending',
    projectId: input.projectId ?? null,
    taskId: input.taskId ?? null,
    workspaceId: input.workspaceId ?? null,
    entityKey: input.entityKey,
    parentOperationId: input.parentOperationId ?? null,
    initiatedBy: input.initiatedBy ?? options.initiatedBy ?? null,
    hostRef: input.hostRef,
    payload: input.payload,
    confirmedAt: input.confirmedAt ?? null,
    confirmationReason: input.confirmationReason ?? null,
    createdAt: input.createdAt ?? options.now,
  };
}

export function insertOperation(
  tx: DrizzleTx,
  draft: OperationDraft,
  options: OperationInsertOptions = {}
): InsertOperationOutcome {
  if (options.dedupeStatuses && draft.entityKey) {
    const existing = operationForEntityKey(tx, draft.entityKey, options.dedupeStatuses);
    if (existing) return { outcome: 'duplicate', operationId: existing.id };
  }
  const preconditionError = options.precondition?.(tx);
  if (preconditionError) {
    return { outcome: 'precondition-failed', error: preconditionError };
  }
  const claimResources = options.claims ?? [];
  const claimConflict = findClaimConflict(tx, claimResources);
  if (claimConflict) {
    if (claimConflict.kind === draft.kind && claimConflict.entityKey === draft.entityKey) {
      return { outcome: 'duplicate', operationId: claimConflict.id };
    }
    return {
      outcome: 'precondition-failed',
      error: {
        type: 'resource-claimed',
        message: `Resource is already claimed by operation ${claimConflict.id}`,
      },
    };
  }
  if (options.tombstone && options.tombstone(tx) === 0) {
    return {
      outcome: 'duplicate',
      operationId: draft.entityKey
        ? operationForEntityKey(tx, draft.entityKey, nonTerminalOperationStatuses)?.id
        : undefined,
    };
  }
  tx.insert(lifecycleOperations)
    .values({
      ...draft,
      parentForgetPolicy: options.parentForgetPolicy ?? null,
    })
    .run();
  if (claimResources.length > 0) {
    tx.insert(operationClaims)
      .values(
        claimResources.map((resource) => ({
          operationId: draft.id,
          resourceKey: operationClaimResourceKey(resource),
        }))
      )
      .run();
  }
  return { outcome: 'inserted' };
}

export function operationForEntityKey(
  tx: DrizzleTx,
  entityKey: string,
  statuses: readonly OperationStatus[]
): Pick<LifecycleOperationRow, 'id'> | undefined {
  return tx
    .select({ id: lifecycleOperations.id })
    .from(lifecycleOperations)
    .where(
      and(
        eq(lifecycleOperations.entityKey, entityKey),
        inArray(lifecycleOperations.status, [...statuses])
      )
    )
    .orderBy(desc(lifecycleOperations.createdAt))
    .limit(1)
    .get();
}

export function adoptOperation(
  tx: DrizzleTx,
  operationId: string,
  parentOperationId: string,
  parentForgetPolicy?: OperationInsertOptions['parentForgetPolicy']
): void {
  tx.update(lifecycleOperations)
    .set({ parentOperationId, parentForgetPolicy: parentForgetPolicy ?? null })
    .where(eq(lifecycleOperations.id, operationId))
    .run();
}

export function findClaimConflict(
  tx: DrizzleTx,
  resources: readonly OperationClaimResource[]
): Pick<LifecycleOperationRow, 'id' | 'kind' | 'entityKey'> | undefined {
  const keys = claimResourceKeys(resources);
  if (keys.length === 0) return undefined;
  return tx
    .select({
      id: lifecycleOperations.id,
      kind: lifecycleOperations.kind,
      entityKey: lifecycleOperations.entityKey,
    })
    .from(operationClaims)
    .innerJoin(lifecycleOperations, eq(operationClaims.operationId, lifecycleOperations.id))
    .where(
      and(
        inArray(operationClaims.resourceKey, keys),
        inArray(lifecycleOperations.status, [...nonTerminalOperationStatuses])
      )
    )
    .orderBy(lifecycleOperations.createdAt)
    .limit(1)
    .get();
}

export async function findClaimConflictByResources(
  db: AppDb,
  resources: readonly OperationClaimResource[]
): Promise<Pick<LifecycleOperationRow, 'id'> | undefined> {
  const keys = claimResourceKeys(resources);
  if (keys.length === 0) return undefined;
  const [conflict] = await db
    .select({ id: lifecycleOperations.id })
    .from(operationClaims)
    .innerJoin(lifecycleOperations, eq(operationClaims.operationId, lifecycleOperations.id))
    .where(
      and(
        inArray(operationClaims.resourceKey, keys),
        inArray(lifecycleOperations.status, [...nonTerminalOperationStatuses])
      )
    )
    .orderBy(lifecycleOperations.createdAt)
    .limit(1);
  return conflict;
}

export async function latestOperationForDraft(
  db: AppDb,
  draft: OperationDraft,
  options: OperationInsertOptions | undefined
): Promise<LifecycleOperationRow | undefined> {
  if (!draft.entityKey) return undefined;
  const [operation] = await db
    .select()
    .from(lifecycleOperations)
    .where(
      and(
        eq(lifecycleOperations.entityKey, draft.entityKey),
        inArray(lifecycleOperations.status, [
          ...(options?.dedupeStatuses ?? nonTerminalOperationStatuses),
        ])
      )
    )
    .orderBy(desc(lifecycleOperations.createdAt))
    .limit(1);
  return operation;
}

function claimResourceKeys(resources: readonly OperationClaimResource[]): string[] {
  return [...new Set(resources.map(operationClaimResourceKey))];
}
