import { randomUUID } from 'node:crypto';
import {
  createIdleSweeper,
  type IoActivitySnapshot,
} from '@emdash/core/primitives/io-activity/api';
import { err, ok, type PendingLease, type Result } from '@emdash/shared';
import { createResourceCache, type Scope } from '@emdash/shared/concurrency';
import { log } from '@emdash/shared/logger';
import { systemClock, type Clock } from '@emdash/shared/scheduling';
import { ComputedLiveState, type LiveSource } from '@emdash/wire';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  nonTerminalOperationStatuses,
  operationKinds,
  type DeletionEntityKind,
  type DeletionList,
  type DeletionMutationError,
  type DeletionState,
  type OperationKind,
  type OperationStatus,
} from '@core/primitives/operations/api';
import type { AppDb, DrizzleTx } from '@core/services/app-db/node/db';
import { lifecycleOperations, type LifecycleOperationRow } from '@core/services/app-db/node/schema';
import type {
  OperationConfirmationReason,
  OperationDefinition,
  OperationDescription,
  OperationDraft,
  OperationDraftInput,
  OperationInsertOptions,
  OperationProgress,
  OperationRunError,
  OperationSubmission,
  OperationSubmit,
  OperationsNotificationPublisher,
  OperationsSshManager,
} from './definition';

const RETRY_DELAYS_MS = [1_000, 4_000];
const RECONCILE_INTERVAL_MS = 10 * 60_000;
const RECONCILE_SNAPSHOT: IoActivitySnapshot = {
  running: false,
  busy: false,
  attachedClients: 0,
  detachedAt: null,
  lastInputAt: null,
  lastOutputAt: null,
};

type OperationMutationResult = Result<{ operationId?: string }, DeletionMutationError>;

type DeletionStateKey = {
  kind: DeletionEntityKind;
  entityId?: string;
};

type InsertOperationOutcome =
  | { outcome: 'inserted' }
  | { outcome: 'duplicate' }
  | { outcome: 'precondition-failed'; error: DeletionMutationError };

export type OperationsEngineDeps = {
  db: AppDb;
  scope: Scope;
  sshManager: OperationsSshManager;
  notifications: OperationsNotificationPublisher;
  definitions: OperationDefinition[];
  clock?: Clock;
};

export class OperationsEngine {
  private readonly db: AppDb;
  private readonly scope: Scope;
  private readonly sshManager: OperationsSshManager;
  private readonly notifications: OperationsNotificationPublisher;
  private readonly definitions: Map<OperationKind, OperationDefinition>;
  private readonly clock: Clock;
  private started = false;
  private drainRequested = false;
  private drainPromise: Promise<void> | undefined;
  private readonly progress = new Map<string, OperationProgress>();
  private readonly deletionStateKeys = new Map<string, DeletionStateKey>();
  private readonly deletionStates: ReturnType<
    typeof createResourceCache<DeletionStateKey, ComputedLiveState<DeletionList>>
  >;

  constructor(deps: OperationsEngineDeps) {
    this.db = deps.db;
    this.scope = deps.scope;
    this.sshManager = deps.sshManager;
    this.notifications = deps.notifications;
    this.clock = deps.clock ?? systemClock;
    this.definitions = definitionMap(deps.definitions);
    this.deletionStates = createResourceCache<DeletionStateKey, ComputedLiveState<DeletionList>>({
      scope: this.scope,
      label: 'deletion-states',
      key: deletionStateKey,
      create: (key, entryScope) => {
        const keyId = deletionStateKey(key);
        const state = new ComputedLiveState<DeletionList>({
          compute: () => this.loadDeletionList(key.kind, key.entityId),
          clock: this.clock,
          onError: (error) =>
            log.warn('lifecycle deletion state refresh failed', {
              kind: key.kind,
              entityId: key.entityId,
              error: String(error),
            }),
        });
        this.deletionStateKeys.set(keyId, key);
        entryScope.add(() => {
          state.dispose();
          this.deletionStateKeys.delete(keyId);
        });
        return state;
      },
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.db
      .update(lifecycleOperations)
      .set({ status: 'pending', error: null })
      .where(eq(lifecycleOperations.status, 'running'));

    const onConnection = (event: { type: string }) => {
      void this.refreshDeletionStates();
      if (event.type === 'connected' || event.type === 'reconnected') this.poke();
    };
    this.sshManager.on('connection-event', onConnection);
    this.scope.add(() => {
      this.sshManager.off('connection-event', onConnection);
    });
    this.scope.add(async () => {
      await this.db
        .update(lifecycleOperations)
        .set({ status: 'pending' })
        .where(eq(lifecycleOperations.status, 'running'));
    });

    const reconcileDefinitions = [...this.definitions.values()].filter(
      (definition) => definition.reconcile !== undefined
    );
    if (reconcileDefinitions.length > 0) {
      const sweeper = createIdleSweeper({
        scope: this.scope,
        clock: this.clock,
        intervalMs: RECONCILE_INTERVAL_MS,
        entries: () => reconcileDefinitions,
        snapshot: () => RECONCILE_SNAPSHOT,
        policy: () => () => ({ action: 'deactivate', reason: 'reconcile' }),
        deactivate: (definition) => this.reconcile(definition),
        onError: (error, definition) =>
          log.warn('lifecycle reconciler sweep failed', {
            kind: definition?.kind,
            error: String(error),
          }),
      });
      void sweeper.sweepNow();
    }

    await this.refreshDeletionStates();
    this.poke();
  }

  readonly submit: OperationSubmit = async (prepare) => {
    const prepared = await prepare({ db: this.db, clock: this.clock });
    if (!prepared.success) return prepared;
    if (prepared.data.outcome === 'existing') {
      return ok({ operationId: prepared.data.operationId });
    }

    const submission = prepared.data;
    const draft = this.buildOperationDraft(submission.draft);
    const insertion = this.db.transaction((tx) => {
      const primary = this.insertOperation(tx, draft, submission.options);
      if (primary.outcome !== 'inserted') return primary;
      for (const related of submission.related ?? []) {
        this.insertOperation(tx, this.buildOperationDraft(related.draft), related.options);
      }
      return primary;
    });

    if (insertion.outcome === 'precondition-failed') return err(insertion.error);
    if (insertion.outcome === 'duplicate') {
      const existing = await this.latestOperationForDraft(draft, submission.options);
      return existing
        ? ok({ operationId: existing.id })
        : err({
            type: 'operation-not-found',
            message: 'The operation was deduplicated but no existing operation was found',
          });
    }

    await this.refreshDeletionStates();
    if (draft.status === 'awaiting-confirmation') {
      this.publishPendingCleanup(draft, draft.payload.confirmationReason ?? 'reconciler-proposed');
    } else {
      this.poke();
    }
    return ok({ operationId: draft.id });
  };

  async retryDelete(kind: DeletionEntityKind, entityId: string): Promise<OperationMutationResult> {
    const operation = await this.latestOperation(kind, entityId);
    if (!operation) {
      return err({ type: 'operation-not-found', message: 'No pending cleanup was found' });
    }
    const definition = this.requireDefinition(operation.kind);
    const confirmedAt = this.clock.now();
    const reset = (tx: DrizzleTx, item: LifecycleOperationRow = operation) => {
      tx.update(lifecycleOperations)
        .set({
          status: 'pending',
          error: null,
          finishedAt: null,
          payload: {
            ...item.payload,
            confirmedAt,
            confirmationReason: undefined,
          },
        })
        .where(eq(lifecycleOperations.id, item.id))
        .run();
    };

    if (definition.retry) {
      await definition.retry({
        operation,
        db: this.db,
        clock: this.clock,
        reset,
      });
    } else {
      this.db.transaction((tx) => reset(tx));
    }

    await this.refreshDeletionStates();
    this.poke();
    return ok({ operationId: operation.id });
  }

  async forgetWithoutCleanup(
    kind: DeletionEntityKind,
    entityId: string
  ): Promise<OperationMutationResult> {
    const operation = await this.latestOperation(kind, entityId);
    if (!operation) {
      return err({ type: 'operation-not-found', message: 'No pending cleanup was found' });
    }
    const definition = this.requireDefinition(operation.kind);
    const markAbandoned = (tx: DrizzleTx, item: LifecycleOperationRow = operation) => {
      tx.update(lifecycleOperations)
        .set({ status: 'abandoned', finishedAt: this.clock.now(), error: null })
        .where(eq(lifecycleOperations.id, item.id))
        .run();
    };

    if (definition.forget) {
      await definition.forget({
        operation,
        db: this.db,
        clock: this.clock,
        markAbandoned,
      });
    } else {
      this.db.transaction((tx) => markAbandoned(tx));
    }

    await this.refreshDeletionStates();
    return ok({ operationId: operation.id });
  }

  acquireDeletionState(kind: DeletionEntityKind, entityId?: string): PendingLease<LiveSource> {
    const lease = this.deletionStates.acquire({ kind, entityId });
    return {
      ready: async () => (await lease.ready()).prepare(),
      release: lease.release,
    };
  }

  poke(): void {
    if (!this.started || this.scope.disposed) return;
    this.drainRequested = true;
    if (this.drainPromise) return;
    this.drainPromise = this.scope
      .run('drain', async (signal) => {
        while (this.drainRequested && !signal.aborted) {
          this.drainRequested = false;
          await this.drain(signal);
        }
      })
      .value()
      .catch((error) => log.error('lifecycle operations drain failed', { error }))
      .finally(() => {
        this.drainPromise = undefined;
        if (this.drainRequested) this.poke();
      });
  }

  async waitForIdle(): Promise<void> {
    while (this.drainPromise) await this.drainPromise;
  }

  async waitForConflictingCleanup(input: {
    projectId: string;
    workspaceId?: string;
    branchName?: string;
  }): Promise<boolean> {
    const operations = await this.db
      .select()
      .from(lifecycleOperations)
      .where(
        and(
          eq(lifecycleOperations.projectId, input.projectId),
          inArray(lifecycleOperations.status, [...nonTerminalOperationStatuses])
        )
      );
    for (const operation of operations) {
      const definition = this.requireDefinition(operation.kind);
      if (definition.entityKind === 'project') return false;
      if (input.workspaceId !== undefined && operation.workspaceId === input.workspaceId) {
        return false;
      }
      if (input.branchName !== undefined) {
        const description = await definition.describe({ operation, db: this.db });
        if (description.branchName === input.branchName) return false;
      }
    }
    return true;
  }

  private async reconcile(definition: OperationDefinition): Promise<void> {
    await definition.reconcile?.({
      db: this.db,
      clock: this.clock,
      submit: this.submit,
    });
  }

  private async drain(signal: AbortSignal): Promise<void> {
    let madeProgress = true;
    while (madeProgress && !signal.aborted) {
      madeProgress = false;
      const operations = await this.db
        .select()
        .from(lifecycleOperations)
        .where(inArray(lifecycleOperations.status, ['pending', 'running']))
        .orderBy(lifecycleOperations.createdAt);

      for (const operation of operations) {
        if (signal.aborted) return;
        const definition = this.definitions.get(operation.kind);
        if (!definition) {
          await this.failMissingDefinition(operation);
          madeProgress = true;
          continue;
        }
        if (!this.hostIsOnline(operation.hostRef)) continue;
        if (definition.isReady && !(await definition.isReady({ operation, db: this.db }))) {
          continue;
        }
        await this.run(operation, definition, signal);
        madeProgress = true;
      }
    }
    await this.refreshDeletionStates();
  }

  private async run(
    operation: LifecycleOperationRow,
    definition: OperationDefinition,
    signal: AbortSignal
  ): Promise<void> {
    const current = { ...operation, status: 'running' as const };
    await this.db
      .update(lifecycleOperations)
      .set({ status: 'running', attempt: operation.attempt + 1, error: null })
      .where(eq(lifecycleOperations.id, operation.id));
    await this.refreshDeletionStates();

    const result = await this.runWithRetries(current, definition, signal);
    this.progress.delete(operation.id);
    if (result.success) {
      await this.db
        .update(lifecycleOperations)
        .set({ status: 'succeeded', finishedAt: this.clock.now(), error: null })
        .where(eq(lifecycleOperations.id, operation.id));
    } else if (result.error.type === 'awaiting-confirmation') {
      await this.awaitConfirmation(operation, result.error.reason);
      return;
    } else if (!signal.aborted) {
      await this.db
        .update(lifecycleOperations)
        .set({
          status: 'failed',
          error:
            result.error.code === 'workspace-in-use'
              ? `${result.error.code}: ${result.error.message}`
              : result.error.message,
        })
        .where(eq(lifecycleOperations.id, operation.id));
    }
    await this.refreshDeletionStates();
  }

  private async runWithRetries(
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
          db: this.db,
          signal,
          clock: this.clock,
          reportProgress: (progress) => {
            this.progress.set(operation.id, progress);
            void this.refreshDeletionStates();
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
      await this.clock.sleep(RETRY_DELAYS_MS[retryIndex], { signal });
      retryIndex += 1;
    }
  }

  private async awaitConfirmation(
    operation: LifecycleOperationRow,
    reason: OperationConfirmationReason
  ): Promise<void> {
    await this.db
      .update(lifecycleOperations)
      .set({
        status: 'awaiting-confirmation',
        attempt: operation.attempt,
        payload: { ...operation.payload, confirmationReason: reason },
      })
      .where(eq(lifecycleOperations.id, operation.id));
    this.publishPendingCleanup(operation, reason);
    await this.refreshDeletionStates();
  }

  private publishPendingCleanup(
    operation: Pick<LifecycleOperationRow, 'id' | 'payload' | 'hostRef'>,
    reason: OperationConfirmationReason
  ): void {
    this.notifications.publishPendingCleanup({
      operationId: operation.id,
      payload: operation.payload,
      hostRef: operation.hostRef,
      reason,
    });
  }

  private hostIsOnline(hostRef: string): boolean {
    return hostRef === 'local' || this.sshManager.isConnected(hostRef);
  }

  private async failMissingDefinition(operation: LifecycleOperationRow): Promise<void> {
    await this.db
      .update(lifecycleOperations)
      .set({
        status: 'failed',
        error: `No operation definition is registered for '${operation.kind}'`,
      })
      .where(eq(lifecycleOperations.id, operation.id));
    await this.refreshDeletionStates();
  }

  private buildOperationDraft(input: OperationDraftInput): OperationDraft {
    return {
      id: input.id ?? randomUUID(),
      kind: input.kind,
      status: input.status ?? 'pending',
      projectId: input.projectId ?? null,
      taskId: input.taskId ?? null,
      workspaceId: input.workspaceId ?? null,
      entityKey: input.entityKey,
      hostRef: input.hostRef,
      payload: input.payload,
      createdAt: input.createdAt ?? this.clock.now(),
    };
  }

  private insertOperation(
    tx: DrizzleTx,
    draft: OperationDraft,
    options: OperationInsertOptions = {}
  ): InsertOperationOutcome {
    if (
      options.dedupeStatuses &&
      draft.entityKey &&
      this.hasOperation(tx, draft.entityKey, options.dedupeStatuses)
    ) {
      return { outcome: 'duplicate' };
    }
    const preconditionError = options.precondition?.(tx);
    if (preconditionError) {
      return { outcome: 'precondition-failed', error: preconditionError };
    }
    if (options.tombstone && options.tombstone(tx) === 0) {
      return { outcome: 'duplicate' };
    }
    tx.insert(lifecycleOperations).values(draft).run();
    return { outcome: 'inserted' };
  }

  private hasOperation(
    tx: DrizzleTx,
    entityKey: string,
    statuses: readonly OperationStatus[]
  ): boolean {
    return (
      tx
        .select({ id: lifecycleOperations.id })
        .from(lifecycleOperations)
        .where(
          and(
            eq(lifecycleOperations.entityKey, entityKey),
            inArray(lifecycleOperations.status, [...statuses])
          )
        )
        .limit(1)
        .get() !== undefined
    );
  }

  private async latestOperationForDraft(
    draft: OperationDraft,
    options: OperationInsertOptions | undefined
  ): Promise<LifecycleOperationRow | undefined> {
    const definition = this.requireDefinition(draft.kind);
    return this.latestOperation(
      definition.entityKind,
      draft.entityKey ?? '',
      options?.dedupeStatuses ?? nonTerminalOperationStatuses
    );
  }

  private async latestOperation(
    kind: DeletionEntityKind,
    entityId: string,
    statuses: readonly OperationStatus[] = nonTerminalOperationStatuses
  ): Promise<LifecycleOperationRow | undefined> {
    const kinds = this.operationKindsForEntity(kind);
    if (kinds.length === 0) return undefined;
    const [operation] = await this.db
      .select()
      .from(lifecycleOperations)
      .where(
        and(
          eq(lifecycleOperations.entityKey, entityId),
          inArray(lifecycleOperations.kind, kinds),
          inArray(lifecycleOperations.status, [...statuses])
        )
      )
      .orderBy(desc(lifecycleOperations.createdAt))
      .limit(1);
    return operation;
  }

  private operationKindsForEntity(kind: DeletionEntityKind): OperationKind[] {
    return [...this.definitions.values()]
      .filter((definition) => definition.entityKind === kind)
      .map((definition) => definition.kind);
  }

  private requireDefinition(kind: OperationKind): OperationDefinition {
    const definition = this.definitions.get(kind);
    if (!definition) throw new Error(`No operation definition is registered for '${kind}'`);
    return definition;
  }

  private async refreshDeletionStates(): Promise<void> {
    for (const key of this.deletionStateKeys.values()) {
      this.deletionStates.peek(key)?.invalidate();
    }
  }

  private async loadDeletionList(
    kind: DeletionEntityKind,
    entityId?: string
  ): Promise<DeletionList> {
    const kinds = this.operationKindsForEntity(kind);
    if (kinds.length === 0) return {};
    const rows = await this.db
      .select()
      .from(lifecycleOperations)
      .where(
        and(
          inArray(lifecycleOperations.kind, kinds),
          inArray(lifecycleOperations.status, [...nonTerminalOperationStatuses]),
          entityId === undefined ? undefined : eq(lifecycleOperations.entityKey, entityId)
        )
      );
    const list: DeletionList = {};
    for (const row of rows) {
      const definition = this.requireDefinition(row.kind);
      let description: OperationDescription = {};
      try {
        description = await definition.describe({ operation: row, db: this.db });
      } catch (error) {
        log.warn('lifecycle operation description failed', {
          operationId: row.id,
          kind: row.kind,
          error: String(error),
        });
      }
      const entry = toDeletionState(
        row,
        definition.entityKind,
        this.hostIsOnline(row.hostRef),
        description,
        this.progress.get(row.id)
      );
      if (entry) list[entry.entityId] = entry;
    }
    return list;
  }
}

function definitionMap(
  definitions: OperationDefinition[]
): Map<OperationKind, OperationDefinition> {
  const map = new Map<OperationKind, OperationDefinition>();
  for (const definition of definitions) {
    if (map.has(definition.kind)) {
      throw new Error(`Duplicate operation definition '${definition.kind}'`);
    }
    map.set(definition.kind, definition);
  }
  const missing = operationKinds.filter((kind) => !map.has(kind));
  if (missing.length > 0) {
    throw new Error(`Missing operation definitions: ${missing.join(', ')}`);
  }
  return map;
}

function toDeletionState(
  operation: LifecycleOperationRow,
  entityKind: DeletionEntityKind,
  hostOnline: boolean,
  description: OperationDescription,
  progress?: OperationProgress
): DeletionState | undefined {
  if (!operation.entityKey) return undefined;
  const base = {
    operationId: operation.id,
    operationKind: operation.kind,
    entityId: operation.entityKey,
    entityKind,
    projectId: operation.projectId ?? undefined,
    entityName: operation.payload.entityName ?? description.entityName,
    hostRef: operation.hostRef,
    hostLabel: operation.payload.hostLabel,
    workspacePath: description.workspacePath ?? operation.payload.workspacePath,
    branchName: description.branchName ?? operation.payload.branchName,
    createdAt: operation.createdAt,
    attempt: operation.attempt,
    currentStep: progress?.currentStep,
    completedSteps: progress?.completedSteps,
    totalSteps: progress?.totalSteps,
  };
  switch (operation.status) {
    case 'pending':
      return { ...base, status: hostOnline ? 'cleaning' : 'blocked-host-offline' };
    case 'running':
      return { ...base, status: 'cleaning' };
    case 'awaiting-confirmation':
      return {
        ...base,
        status: 'awaiting-confirmation',
        confirmationReason: operation.payload.confirmationReason ?? 'stale',
      };
    case 'failed':
      return { ...base, status: 'failed', error: operation.error ?? 'Cleanup failed' };
    case 'succeeded':
    case 'abandoned':
      return undefined;
  }
}

function deletionStateKey(key: DeletionStateKey): string {
  return `${key.kind}:${key.entityId ?? '*'}`;
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

export function enqueueSubmission(
  submission: Omit<Extract<OperationSubmission, { outcome: 'enqueue' }>, 'outcome'>
): Result<OperationSubmission, DeletionMutationError> {
  return ok({ outcome: 'enqueue', ...submission });
}
