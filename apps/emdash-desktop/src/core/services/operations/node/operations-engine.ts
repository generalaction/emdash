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
  operationClaimResourceKey,
  type DeletionEntityKind,
  type DeletionMutationError,
  type DeletionState,
  type OperationClaimResource,
  type OperationKind,
  type OperationStatus,
  type OperationTree,
  type OperationTreeKey,
  type OperationTreeList,
  type OperationTreeRollupStatus,
} from '@core/primitives/operations/api';
import type { AppDb, DrizzleTx } from '@core/services/app-db/node/db';
import {
  lifecycleOperations,
  operationClaims,
  type LifecycleOperationRow,
} from '@core/services/app-db/node/schema';
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
import { createDurableQueue, type DurableQueue } from './durable-queue';
import {
  nextOperationStatus,
  requireNextOperationStatus,
  type OperationStatusEvent,
} from './operation-status-machine';

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

const ROLLUP_SEVERITY: readonly OperationTreeRollupStatus[] = [
  'failed',
  'awaiting-confirmation',
  'blocked-host-offline',
  'cleaning',
  'waiting',
];

type TerminalChildCounts = {
  total: number;
  done: number;
};

type InsertOperationOutcome =
  | { outcome: 'inserted' }
  | { outcome: 'duplicate'; operationId?: string }
  | { outcome: 'precondition-failed'; error: DeletionMutationError };

class RelatedOperationInsertError extends Error {
  constructor(
    readonly error: DeletionMutationError,
    readonly draft: OperationDraft
  ) {
    super(error.message);
    this.name = 'RelatedOperationInsertError';
  }
}

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
  private readonly queue: DurableQueue;
  private started = false;
  private readonly progress = new Map<string, OperationProgress>();
  private readonly operationTreeKeys = new Map<string, OperationTreeKey>();
  private readonly operationTrees: ReturnType<
    typeof createResourceCache<OperationTreeKey, ComputedLiveState<OperationTreeList>>
  >;

  constructor(deps: OperationsEngineDeps) {
    this.db = deps.db;
    this.scope = deps.scope;
    this.sshManager = deps.sshManager;
    this.notifications = deps.notifications;
    this.clock = deps.clock ?? systemClock;
    this.definitions = definitionMap(deps.definitions);
    this.queue = createDurableQueue({
      scope: this.scope,
      list: () => this.queuedOperations(),
      laneOf: (operation) => operation.hostRef,
      isRunnable: (operation) => this.operationIsRunnable(operation),
      run: (operation, signal) => this.runQueuedOperation(operation, signal),
      onError: (error) => log.error('lifecycle operations drain failed', { error }),
      onPass: () => this.refreshOperationTrees(),
    });
    this.operationTrees = createResourceCache<
      OperationTreeKey,
      ComputedLiveState<OperationTreeList>
    >({
      scope: this.scope,
      label: 'operation-trees',
      key: operationTreeKey,
      create: (key, entryScope) => {
        const keyId = operationTreeKey(key);
        const state = new ComputedLiveState<OperationTreeList>({
          compute: () => this.loadOperationTrees(key.projectId),
          clock: this.clock,
          onError: (error) =>
            log.warn('lifecycle operation tree refresh failed', {
              projectId: key.projectId,
              error: String(error),
            }),
        });
        this.operationTreeKeys.set(keyId, key);
        entryScope.add(() => {
          state.dispose();
          this.operationTreeKeys.delete(keyId);
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
      .set({
        status: requireNextOperationStatus('running', { type: 'process-restarted' }),
        error: null,
      })
      .where(eq(lifecycleOperations.status, 'running'));

    const onConnection = (event: { type: string }) => {
      void this.refreshOperationTrees();
      if (event.type === 'connected' || event.type === 'reconnected') this.poke();
    };
    this.sshManager.on('connection-event', onConnection);
    this.scope.add(() => {
      this.sshManager.off('connection-event', onConnection);
    });
    this.scope.add(async () => {
      await this.db
        .update(lifecycleOperations)
        .set({ status: requireNextOperationStatus('running', { type: 'process-restarted' }) })
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

    await this.refreshOperationTrees();
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
    let insertion: InsertOperationOutcome;
    try {
      insertion = this.db.transaction((tx) => {
        const primary = this.insertOperation(tx, draft, submission.options);
        if (primary.outcome !== 'inserted') return primary;
        for (const related of submission.related ?? []) {
          const relatedDraft = this.buildOperationDraft({
            ...related.draft,
            parentOperationId: draft.id,
          });
          const relatedInsertion = this.insertOperation(tx, relatedDraft, related.options);
          if (relatedInsertion.outcome === 'duplicate' && relatedInsertion.operationId) {
            this.adoptOperation(tx, relatedInsertion.operationId, draft.id);
          } else if (relatedInsertion.outcome === 'precondition-failed') {
            throw new RelatedOperationInsertError(relatedInsertion.error, relatedDraft);
          }
        }
        return primary;
      });
    } catch (error) {
      if (!(error instanceof RelatedOperationInsertError)) throw error;
      log.warn('related lifecycle operation insert failed', {
        kind: error.draft.kind,
        entityKey: error.draft.entityKey,
        message: error.error.message,
      });
      return err(error.error);
    }

    if (insertion.outcome === 'precondition-failed') return err(insertion.error);
    if (insertion.outcome === 'duplicate') {
      const existing = insertion.operationId
        ? await this.operationById(insertion.operationId)
        : await this.latestOperationForDraft(draft, submission.options);
      return existing
        ? ok({ operationId: existing.id })
        : err({
            type: 'operation-not-found',
            message: 'The operation was deduplicated but no existing operation was found',
          });
    }

    await this.refreshOperationTrees();
    if (draft.status === 'awaiting-confirmation') {
      this.publishPendingCleanup(draft, draft.payload.confirmationReason ?? 'reconciler-proposed');
    } else {
      this.poke();
    }
    return ok({ operationId: draft.id });
  };

  async retry(operationId: string): Promise<OperationMutationResult> {
    const operation = await this.operationById(operationId);
    if (!operation) {
      return err({ type: 'operation-not-found', message: 'No pending cleanup was found' });
    }
    const definition = this.requireDefinition(operation.kind);
    const confirmedAt = this.clock.now();
    const retryEvent = { type: 'user-retried', confirmedAt } as const;
    const preflight = nextOperationStatus(operation.status, retryEvent);
    if (!preflight.success) {
      return err({ type: preflight.error.type, message: preflight.error.message });
    }
    const reset = (tx: DrizzleTx, item: LifecycleOperationRow = operation) => {
      const status = this.tryTransitionStatus(item, retryEvent);
      if (!status) return;
      tx.update(lifecycleOperations)
        .set({
          status,
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

    await this.refreshOperationTrees();
    this.poke();
    return ok({ operationId: operation.id });
  }

  async forget(operationId: string): Promise<OperationMutationResult> {
    const operation = await this.operationById(operationId);
    if (!operation) {
      return err({ type: 'operation-not-found', message: 'No pending cleanup was found' });
    }
    const definition = this.requireDefinition(operation.kind);
    const abandonEvent = { type: 'user-abandoned' } as const;
    const preflight = nextOperationStatus(operation.status, abandonEvent);
    if (!preflight.success) {
      return err({ type: preflight.error.type, message: preflight.error.message });
    }
    const markAbandoned = (tx: DrizzleTx, item: LifecycleOperationRow = operation) => {
      const status = this.tryTransitionStatus(item, abandonEvent);
      if (!status) return;
      tx.update(lifecycleOperations)
        .set({ status, finishedAt: this.clock.now(), error: null })
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

    await this.refreshOperationTrees();
    return ok({ operationId: operation.id });
  }

  acquireOperationTreeState(projectId?: string): PendingLease<LiveSource> {
    const lease = this.operationTrees.acquire({ projectId });
    return {
      ready: async () => (await lease.ready()).prepare(),
      release: lease.release,
    };
  }

  poke(): void {
    if (!this.started || this.scope.disposed) return;
    this.queue.poke();
  }

  async waitForIdle(): Promise<void> {
    await this.queue.waitForIdle();
  }

  async hasClaimConflict(input: {
    projectId: string;
    workspaceId?: string;
    branchName?: string;
  }): Promise<boolean> {
    const resources: OperationClaimResource[] = [{ kind: 'project', id: input.projectId }];
    if (input.workspaceId !== undefined) {
      resources.push({ kind: 'workspace', id: input.workspaceId });
    }
    if (input.branchName !== undefined) {
      resources.push({ kind: 'branch', projectId: input.projectId, name: input.branchName });
    }
    const conflict = await this.findClaimConflictByResources(resources);
    return conflict !== undefined;
  }

  private async reconcile(definition: OperationDefinition): Promise<void> {
    await definition.reconcile?.({
      db: this.db,
      clock: this.clock,
      submit: this.submit,
    });
  }

  private async queuedOperations(): Promise<LifecycleOperationRow[]> {
    return await this.db
      .select()
      .from(lifecycleOperations)
      .where(inArray(lifecycleOperations.status, ['pending', 'running']))
      .orderBy(lifecycleOperations.createdAt);
  }

  private async operationIsRunnable(operation: LifecycleOperationRow): Promise<boolean> {
    const definition = this.definitions.get(operation.kind);
    if (!definition) return true;
    if (!this.hostIsOnline(operation.hostRef)) return false;
    if (definition.isReady && !(await definition.isReady({ operation, db: this.db }))) {
      return false;
    }
    return true;
  }

  private async runQueuedOperation(
    operation: LifecycleOperationRow,
    signal: AbortSignal
  ): Promise<void> {
    const definition = this.definitions.get(operation.kind);
    if (!definition) {
      await this.failMissingDefinition(operation);
      return;
    }
    if (!this.hostIsOnline(operation.hostRef)) return;
    if (definition.isReady && !(await definition.isReady({ operation, db: this.db }))) {
      return;
    }
    await this.run(operation, definition, signal);
  }

  private async run(
    operation: LifecycleOperationRow,
    definition: OperationDefinition,
    signal: AbortSignal
  ): Promise<void> {
    const runningStatus = this.tryTransitionStatus(operation, { type: 'started' });
    if (!runningStatus) return;
    const current = { ...operation, status: 'running' as const };
    await this.db
      .update(lifecycleOperations)
      .set({ status: runningStatus, attempt: operation.attempt + 1, error: null })
      .where(eq(lifecycleOperations.id, operation.id));
    await this.refreshOperationTrees();

    const result = await this.runWithRetries(current, definition, signal);
    this.progress.delete(operation.id);
    if (result.success) {
      await this.db
        .update(lifecycleOperations)
        .set({
          status: this.transitionStatus(current.status, { type: 'run-succeeded' }),
          finishedAt: this.clock.now(),
          error: null,
        })
        .where(eq(lifecycleOperations.id, operation.id));
    } else if (result.error.type === 'awaiting-confirmation') {
      await this.awaitConfirmation(operation, result.error.reason, result.error.message);
      return;
    } else if (!signal.aborted) {
      const error =
        result.error.code === 'workspace-in-use'
          ? `${result.error.code}: ${result.error.message}`
          : result.error.message;
      await this.db
        .update(lifecycleOperations)
        .set({
          status: this.transitionStatus(current.status, {
            type: 'run-failed',
            error,
            retryable: result.error.retryable,
          }),
          error,
        })
        .where(eq(lifecycleOperations.id, operation.id));
    }
    await this.refreshOperationTrees();
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
            void this.refreshOperationTrees();
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
    reason: OperationConfirmationReason,
    message?: string
  ): Promise<void> {
    await this.db
      .update(lifecycleOperations)
      .set({
        status: this.transitionStatus('running', { type: 'needs-confirmation', reason }),
        attempt: operation.attempt,
        error: message ?? null,
        payload: { ...operation.payload, confirmationReason: reason },
      })
      .where(eq(lifecycleOperations.id, operation.id));
    this.publishPendingCleanup(operation, reason);
    await this.refreshOperationTrees();
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
    const error = `No operation definition is registered for '${operation.kind}'`;
    const failedStatus = this.tryTransitionStatus(operation, {
      type: 'run-failed',
      error,
      retryable: false,
    });
    if (!failedStatus) return;
    await this.db
      .update(lifecycleOperations)
      .set({
        status: failedStatus,
        error,
      })
      .where(eq(lifecycleOperations.id, operation.id));
    await this.refreshOperationTrees();
  }

  private transitionStatus(current: OperationStatus, event: OperationStatusEvent): OperationStatus {
    return requireNextOperationStatus(current, event);
  }

  private tryTransitionStatus(
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

  private buildOperationDraft(input: OperationDraftInput): OperationDraft {
    return {
      id: input.id ?? randomUUID(),
      kind: input.kind,
      status: input.status ?? 'pending',
      projectId: input.projectId ?? null,
      taskId: input.taskId ?? null,
      workspaceId: input.workspaceId ?? null,
      entityKey: input.entityKey,
      parentOperationId: input.parentOperationId ?? null,
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
    if (options.dedupeStatuses && draft.entityKey) {
      const existing = this.operationForEntityKey(tx, draft.entityKey, options.dedupeStatuses);
      if (existing) return { outcome: 'duplicate', operationId: existing.id };
    }
    const preconditionError = options.precondition?.(tx);
    if (preconditionError) {
      return { outcome: 'precondition-failed', error: preconditionError };
    }
    const claimResources = options.claims ?? [];
    const claimConflict = this.findClaimConflict(tx, claimResources);
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
          ? this.operationForEntityKey(tx, draft.entityKey, nonTerminalOperationStatuses)?.id
          : undefined,
      };
    }
    tx.insert(lifecycleOperations).values(draft).run();
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

  private operationForEntityKey(
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

  private adoptOperation(tx: DrizzleTx, operationId: string, parentOperationId: string): void {
    tx.update(lifecycleOperations)
      .set({ parentOperationId })
      .where(eq(lifecycleOperations.id, operationId))
      .run();
  }

  private findClaimConflict(
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

  private async findClaimConflictByResources(
    resources: readonly OperationClaimResource[]
  ): Promise<Pick<LifecycleOperationRow, 'id'> | undefined> {
    const keys = claimResourceKeys(resources);
    if (keys.length === 0) return undefined;
    const [conflict] = await this.db
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

  private async latestOperationForDraft(
    draft: OperationDraft,
    options: OperationInsertOptions | undefined
  ): Promise<LifecycleOperationRow | undefined> {
    if (!draft.entityKey) return undefined;
    const [operation] = await this.db
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

  private async operationById(operationId: string): Promise<LifecycleOperationRow | undefined> {
    const [operation] = await this.db
      .select()
      .from(lifecycleOperations)
      .where(eq(lifecycleOperations.id, operationId))
      .limit(1);
    return operation;
  }

  private requireDefinition(kind: OperationKind): OperationDefinition {
    const definition = this.definitions.get(kind);
    if (!definition) throw new Error(`No operation definition is registered for '${kind}'`);
    return definition;
  }

  private async refreshOperationTrees(): Promise<void> {
    for (const key of this.operationTreeKeys.values()) {
      this.operationTrees.peek(key)?.invalidate();
    }
  }

  private async loadOperationTrees(projectId?: string): Promise<OperationTreeList> {
    const rows = await this.db
      .select()
      .from(lifecycleOperations)
      .where(
        and(
          inArray(lifecycleOperations.status, [...nonTerminalOperationStatuses]),
          projectId === undefined ? undefined : eq(lifecycleOperations.projectId, projectId)
        )
      );
    const terminalChildren = await this.db
      .select()
      .from(lifecycleOperations)
      .where(
        and(
          inArray(lifecycleOperations.status, ['succeeded' as const, 'abandoned' as const]),
          projectId === undefined ? undefined : eq(lifecycleOperations.projectId, projectId)
        )
      );
    const activeChildrenByParent = groupByParent(rows);
    const terminalChildrenByParent = groupTerminalChildrenByParent(terminalChildren);
    const activeOperationIds = new Set(rows.map((row) => row.id));
    const list: OperationTreeList = {};
    for (const row of rows) {
      if (row.parentOperationId !== null && activeOperationIds.has(row.parentOperationId)) continue;
      const tree = await this.toOperationTree(
        row,
        activeChildrenByParent.get(row.id) ?? [],
        terminalChildrenByParent.get(row.id) ?? { total: 0, done: 0 }
      );
      if (tree) list[row.id] = tree;
    }
    return list;
  }

  private async toOperationTree(
    root: LifecycleOperationRow,
    activeChildren: LifecycleOperationRow[],
    terminalChildren: TerminalChildCounts
  ): Promise<OperationTree | undefined> {
    const rootState = await this.toDeletionState(root);
    if (!rootState) return undefined;
    const children = (
      await Promise.all(activeChildren.map((child) => this.toDeletionState(child)))
    ).filter((child): child is DeletionState => child !== undefined);
    const rootForDisplay =
      children.length > 0 && rootState.status === 'cleaning'
        ? ({ ...rootState, status: 'waiting' } as DeletionState)
        : rootState;
    const nodes = [rootForDisplay, ...children];
    return {
      root: rootForDisplay,
      children,
      rollup: {
        total: children.length + terminalChildren.total,
        done: terminalChildren.done,
        status: rollupStatus(nodes),
      },
    };
  }

  private async toDeletionState(row: LifecycleOperationRow): Promise<DeletionState | undefined> {
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
    return toDeletionState(
      row,
      definition.entityKind,
      this.hostIsOnline(row.hostRef),
      description,
      this.progress.get(row.id)
    );
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
      if (progress?.waiting) return { ...base, status: 'waiting' };
      return { ...base, status: 'cleaning' };
    case 'awaiting-confirmation':
      return {
        ...base,
        status: 'awaiting-confirmation',
        confirmationReason: operation.payload.confirmationReason ?? 'stale',
        error: operation.error ?? undefined,
      };
    case 'failed':
      return { ...base, status: 'failed', error: operation.error ?? 'Cleanup failed' };
    case 'succeeded':
    case 'abandoned':
      return undefined;
  }
}

function operationTreeKey(key: OperationTreeKey): string {
  return key.projectId ?? '*';
}

function groupByParent(rows: LifecycleOperationRow[]): Map<string, LifecycleOperationRow[]> {
  const grouped = new Map<string, LifecycleOperationRow[]>();
  for (const row of rows) {
    if (row.parentOperationId === null) continue;
    const existing = grouped.get(row.parentOperationId);
    if (existing) {
      existing.push(row);
    } else {
      grouped.set(row.parentOperationId, [row]);
    }
  }
  return grouped;
}

function groupTerminalChildrenByParent(
  rows: LifecycleOperationRow[]
): Map<string, TerminalChildCounts> {
  const grouped = new Map<string, TerminalChildCounts>();
  for (const row of rows) {
    if (row.parentOperationId === null) continue;
    const existing = grouped.get(row.parentOperationId) ?? { total: 0, done: 0 };
    existing.total += 1;
    if (row.status === 'succeeded') existing.done += 1;
    grouped.set(row.parentOperationId, existing);
  }
  return grouped;
}

export function rollupStatus(nodes: readonly DeletionState[]): OperationTreeRollupStatus {
  for (const status of ROLLUP_SEVERITY) {
    if (nodes.some((node) => node.status === status)) return status;
  }
  return 'waiting';
}

function claimResourceKeys(resources: readonly OperationClaimResource[]): string[] {
  return [...new Set(resources.map(operationClaimResourceKey))];
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
