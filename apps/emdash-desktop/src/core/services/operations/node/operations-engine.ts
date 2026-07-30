import {
  createIdleSweeper,
  type IoActivitySnapshot,
} from '@emdash/core/primitives/io-activity/api';
import { err, ok, type PendingLease, type Result } from '@emdash/shared';
import { createResourceCache, type Scope } from '@emdash/shared/concurrency';
import { log } from '@emdash/shared/logger';
import { systemClock, type Clock } from '@emdash/shared/scheduling';
import { ComputedLiveState, type LiveSource } from '@emdash/wire';
import { and, eq, inArray } from 'drizzle-orm';
import {
  operationKinds,
  type OperationClaimResource,
  type OperationKind,
  type OperationMutationError,
  type OperationTreeKey,
  type OperationTreeList,
} from '@core/primitives/operations/api';
import type { AppDb, DrizzleTx } from '@core/services/app-db/node/db';
import { lifecycleOperations, type LifecycleOperationRow } from '@core/services/app-db/node/schema';
import {
  adoptOperation,
  buildOperationDraft,
  findClaimConflictByResources,
  insertOperation,
  latestOperationForDraft,
  RelatedOperationInsertError,
  type InsertOperationOutcome,
} from './admission';
import type {
  OperationConfirmationReason,
  OperationDefinition,
  OperationProgress,
  OperationSubmission,
  OperationSubmit,
  OperationsNotificationPublisher,
  OperationsSshManager,
} from './definition';
import { createDurableQueue, type DurableQueue } from './durable-queue';
import {
  operationIsRunnable,
  queuedOperations,
  runQueuedOperation,
  settleParentIfChildrenDone,
  tryTransitionStatus,
} from './execution';
import { nextOperationStatus, requireNextOperationStatus } from './operation-status-machine';
import { loadOperationTrees, operationTreeKey } from './projection';

const RECONCILE_INTERVAL_MS = 10 * 60_000;
const RECONCILE_SNAPSHOT: IoActivitySnapshot = {
  running: false,
  busy: false,
  attachedClients: 0,
  detachedAt: null,
  lastInputAt: null,
  lastOutputAt: null,
};

type OperationMutationResult = Result<{ operationId?: string }, OperationMutationError>;

export type OperationsEngineDeps = {
  db: AppDb;
  scope: Scope;
  sshManager: OperationsSshManager;
  notifications: OperationsNotificationPublisher;
  definitions: OperationDefinition[];
  initiatedBy?: string;
  clock?: Clock;
};

export class OperationsEngine {
  private readonly db: AppDb;
  private readonly scope: Scope;
  private readonly sshManager: OperationsSshManager;
  private readonly notifications: OperationsNotificationPublisher;
  private readonly initiatedBy: string | undefined;
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
    this.initiatedBy = deps.initiatedBy;
    this.clock = deps.clock ?? systemClock;
    this.definitions = definitionMap(deps.definitions);
    this.queue = createDurableQueue({
      scope: this.scope,
      list: () => queuedOperations(this.db),
      laneOf: (operation) => operation.hostRef,
      isRunnable: (operation) =>
        operationIsRunnable(
          {
            db: this.db,
            definitions: this.definitions,
            hostIsOnline: (hostRef) => this.hostIsOnline(hostRef),
          },
          operation
        ),
      run: (operation, signal) =>
        runQueuedOperation(
          {
            db: this.db,
            clock: this.clock,
            definitions: this.definitions,
            progress: this.progress,
            hostIsOnline: (hostRef) => this.hostIsOnline(hostRef),
            refreshOperationTrees: () => this.refreshOperationTrees(),
            publishPendingCleanup: (item, reason) => this.publishPendingCleanup(item, reason),
            poke: () => this.poke(),
          },
          operation,
          signal
        ),
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
          compute: () =>
            loadOperationTrees({
              db: this.db,
              definitions: this.definitions,
              progress: this.progress,
              hostIsOnline: (hostRef) => this.hostIsOnline(hostRef),
              projectId: key.projectId,
            }),
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
    const hasRelatedOperations = (submission.related?.length ?? 0) > 0;
    const draft = buildOperationDraft({
      input: {
        ...submission.draft,
        status: submission.draft.status ?? (hasRelatedOperations ? 'waiting-children' : undefined),
      },
      initiatedBy: this.initiatedBy,
      now: this.clock.now(),
    });
    const payloadError = this.validatePayload(draft);
    if (payloadError) return err(payloadError);
    let insertion: InsertOperationOutcome;
    try {
      insertion = this.db.transaction((tx) => {
        const primary = insertOperation(tx, draft, submission.options);
        if (primary.outcome !== 'inserted') return primary;
        for (const related of submission.related ?? []) {
          const relatedDraft = buildOperationDraft({
            input: {
              ...related.draft,
              parentOperationId: draft.id,
            },
            initiatedBy: this.initiatedBy,
            now: this.clock.now(),
          });
          const relatedPayloadError = this.validatePayload(relatedDraft);
          if (relatedPayloadError) {
            throw new RelatedOperationInsertError(relatedPayloadError, relatedDraft);
          }
          const parentForgetPolicy = related.propagation?.onParentForget ?? 'abandon-children';
          const relatedOptions = {
            ...related.options,
            parentForgetPolicy,
          };
          const relatedInsertion = insertOperation(tx, relatedDraft, relatedOptions);
          if (relatedInsertion.outcome === 'duplicate' && relatedInsertion.operationId) {
            adoptOperation(tx, relatedInsertion.operationId, draft.id, parentForgetPolicy);
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
        : await latestOperationForDraft(this.db, draft, submission.options);
      return existing
        ? ok({ operationId: existing.id })
        : err({
            type: 'operation-not-found',
            message: 'The operation was deduplicated but no existing operation was found',
          });
    }

    await this.refreshOperationTrees();
    if (draft.status === 'awaiting-confirmation') {
      this.publishPendingCleanup(draft, draft.confirmationReason ?? 'reconciler-proposed');
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
      if (item.id === operation.id) resetRetryableChildren(tx, operation.id, reset);
      const status = tryTransitionStatus(item, retryEvent);
      if (!status) return;
      tx.update(lifecycleOperations)
        .set({
          status,
          error: null,
          finishedAt: null,
          confirmedAt,
          confirmationReason: null,
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
      if (item.id === operation.id) applyParentForgetPolicy(tx, operation.id, markAbandoned);
      const status = tryTransitionStatus(item, abandonEvent);
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

    await settleParentIfChildrenDone(
      {
        db: this.db,
        refreshOperationTrees: () => this.refreshOperationTrees(),
        poke: () => this.poke(),
      },
      operation
    );
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

  async hasClaimConflict(resources: readonly OperationClaimResource[]): Promise<boolean> {
    const conflict = await findClaimConflictByResources(this.db, resources);
    return conflict !== undefined;
  }

  private async reconcile(definition: OperationDefinition): Promise<void> {
    await definition.reconcile?.({
      db: this.db,
      clock: this.clock,
      submit: this.submit,
    });
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

  private validatePayload(
    operation: Pick<LifecycleOperationRow, 'kind' | 'payload'>
  ): OperationMutationError | undefined {
    const schema = this.definitions.get(operation.kind)?.payloadSchema;
    if (!schema) return undefined;
    const parsed = schema.safeParse(operation.payload);
    if (parsed.status === 'ok') return undefined;
    return {
      type: 'invalid-operation-payload',
      message:
        parsed.status === 'invalid'
          ? parsed.reason
          : `Operation payload for ${operation.kind} uses unsupported version '${parsed.version}'`,
    };
  }

  private async refreshOperationTrees(): Promise<void> {
    for (const key of this.operationTreeKeys.values()) {
      this.operationTrees.peek(key)?.invalidate();
    }
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

export function enqueueSubmission(
  submission: Omit<Extract<OperationSubmission, { outcome: 'enqueue' }>, 'outcome'>
): Result<OperationSubmission, OperationMutationError> {
  return ok({ outcome: 'enqueue', ...submission });
}

function resetRetryableChildren(
  tx: DrizzleTx,
  parentOperationId: string,
  reset: (tx: DrizzleTx, item: LifecycleOperationRow) => void
): void {
  const children = tx
    .select()
    .from(lifecycleOperations)
    .where(
      and(
        eq(lifecycleOperations.parentOperationId, parentOperationId),
        inArray(lifecycleOperations.status, ['awaiting-confirmation' as const, 'failed' as const])
      )
    )
    .all();
  for (const child of children) reset(tx, child);
}

function applyParentForgetPolicy(
  tx: DrizzleTx,
  parentOperationId: string,
  markAbandoned: (tx: DrizzleTx, item: LifecycleOperationRow) => void
): void {
  const children = tx
    .select()
    .from(lifecycleOperations)
    .where(
      and(
        eq(lifecycleOperations.parentOperationId, parentOperationId),
        inArray(lifecycleOperations.status, [
          'pending' as const,
          'waiting-children' as const,
          'running' as const,
          'awaiting-confirmation' as const,
          'failed' as const,
        ])
      )
    )
    .all();
  for (const child of children) {
    if (child.parentForgetPolicy === 'orphan-children') {
      tx.update(lifecycleOperations)
        .set({ parentOperationId: null, parentForgetPolicy: null })
        .where(eq(lifecycleOperations.id, child.id))
        .run();
    } else {
      markAbandoned(tx, child);
    }
  }
}
