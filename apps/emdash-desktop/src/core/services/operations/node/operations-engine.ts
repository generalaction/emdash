import {
  formatHostRef,
  isLocalHostRef,
  LOCAL_HOST_REF,
  parseHostRef,
  sshConnectionIdOf,
  type SerializedHostRef,
} from '@emdash/core/primitives/host/api';
import {
  claimsCollide,
  isTerminalStatus,
  type AnyOperationDefinition,
  type ConflictPolicy,
  type InputOf,
  type OperationHandler,
  type OperationProgress,
  type OperationRecord,
  type ProgressSink,
  type ResourceClaim,
} from '@emdash/core/primitives/kernel/api';
import {
  createOperationEngine,
  type OperationEngine as KernelOperationEngine,
  type OperationRegistry,
} from '@emdash/core/primitives/kernel/engine';
import type { SqliteOperationStore } from '@emdash/core/primitives/kernel/sqlite';
import {
  operationNeedsConfirmationErrorSchema,
  projectOperationTrees,
  type ParsedOperationProjection,
  type OperationMutationError,
  type OperationTreeKey,
  type OperationTreeList,
} from '@emdash/core/primitives/operations/api';
import { err, ok, type Result } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import type { Logger } from '@emdash/shared/logger';
import { systemClock, type Clock } from '@emdash/shared/scheduling';
import { family, query, type Family, type Query } from '@emdash/wire';
import type { OperationPayload } from '@core/primitives/operations/api';
import { startPeriodicSweep } from '@core/primitives/periodic-sweep/node/periodic-sweep';
import type { AppDb } from '@core/services/app-db/node/db';
import {
  matchOperationProject,
  operationsPokes,
  publishOperationSettled,
  type OperationTreePoke,
} from '@core/services/operations/node/pokes';
import type {
  OperationDefinition,
  OperationInputBase,
  OperationMutationResult,
  OperationReconcileContext,
  OperationSubmitOptions,
  OperationsNotificationPublisher,
  OperationsSshManager,
} from './definition';
import { OPERATION_RETENTION_MS } from './runtime';

const RECENT_SETTLED_WINDOW_MS = OPERATION_RETENTION_MS;
const RECONCILER_INTERVAL_MS = 10 * 60_000;
const WAIT_FOR_IDLE_TIMEOUT_MS = 10_000;
const WAIT_FOR_IDLE_POLL_MS = 25;
const FORGET_SETTLE_TIMEOUT_MS = 5_000;

type OperationMutation = Result<OperationMutationResult, OperationMutationError>;

export type OperationsEngineDeps = {
  db: AppDb;
  scope: Scope;
  store: SqliteOperationStore;
  sshManager: OperationsSshManager;
  notifications: OperationsNotificationPublisher;
  definitions: OperationDefinition[];
  conflictPolicies: readonly ConflictPolicy[];
  logger: Pick<Logger, 'warn'>;
  initiatedBy?: string;
  clock?: Clock;
};

export class OperationsEngine {
  readonly db: AppDb;
  private readonly scope: Scope;
  private readonly store: SqliteOperationStore;
  private readonly sshManager: OperationsSshManager;
  private readonly notifications: OperationsNotificationPublisher;
  private readonly logger: Pick<Logger, 'warn'>;
  private readonly definitions: Map<string, OperationDefinition>;
  private readonly kernel: KernelOperationEngine;
  private readonly clock: Clock;
  private readonly initiatedBy: string | undefined;
  private readonly progress = new Map<string, OperationProgress>();
  private readonly operationTrees: Family<OperationTreeKey, Query<OperationTreeList>>;

  constructor(deps: OperationsEngineDeps) {
    this.db = deps.db;
    this.scope = deps.scope;
    this.store = deps.store;
    this.sshManager = deps.sshManager;
    this.notifications = deps.notifications;
    this.logger = deps.logger;
    this.clock = deps.clock ?? systemClock;
    this.initiatedBy = deps.initiatedBy;
    this.definitions = new Map(
      deps.definitions.map((definition) => [definition.definition.name, definition])
    );
    this.kernel = createOperationEngine({
      store: deps.store,
      registry: this.createRegistry(deps.definitions, deps.conflictPolicies),
      progress: this.createProgressSink(),
      clock: {
        now: () => this.clock.now(),
        setTimeout: (callback, ms) => setTimeout(callback, ms),
      },
      dispatchGate: (record) => this.hostIsOnline(this.hostRefFromRecord(record)),
    });
    this.operationTrees = family<OperationTreeKey, Query<OperationTreeList>>(
      (key, scope) =>
        query({
          fetch: () => this.loadOperationTrees(key),
          pokes: [operationsPokes.trees.subscription(matchOperationProject(key.projectId))],
          clock: this.clock,
          scope,
        }),
      { name: 'operation-trees', key: operationTreeKey, scope: this.scope }
    );
  }

  async start(): Promise<void> {
    await this.kernel.recover();
    const onConnection = (event: { type: string }) => {
      this.refreshOperationTrees();
      if (event.type === 'connected' || event.type === 'reconnected') {
        this.kernel.poke();
      }
    };
    this.sshManager.on('connection-event', onConnection);
    this.scope.add(() => {
      this.sshManager.off('connection-event', onConnection);
    });
    const reconciler = startPeriodicSweep({
      scope: this.scope,
      intervalMs: RECONCILER_INTERVAL_MS,
      run: () => this.sweep(),
      onError: (error) => {
        this.logger.warn('operations reconciler sweep failed', { error: String(error) });
      },
    });
    await reconciler.runNow();
    this.refreshOperationTrees();
  }

  async submit<D extends AnyOperationDefinition>(
    definition: D,
    input: InputOf<D>
  ): Promise<OperationMutation> {
    return this.submitKernel(definition, input, {
      initiator: { kind: 'user', action: definition.name },
      options: {},
      revertOnReject: false,
    });
  }

  async submitWithTombstone<D extends AnyOperationDefinition>(
    definition: D,
    input: InputOf<D>,
    options: OperationSubmitOptions = {}
  ): Promise<OperationMutation> {
    return this.submitKernel(definition, input, {
      initiator: { kind: 'user', action: definition.name },
      options,
      revertOnReject: true,
    });
  }

  async submitReconciler<D extends AnyOperationDefinition>(
    definition: D,
    input: InputOf<D>,
    options: OperationSubmitOptions = {}
  ): Promise<OperationMutation> {
    return this.submitKernel(definition, input, {
      initiator: { kind: 'reconciler', probe: definition.name },
      options,
      revertOnReject: false,
    });
  }

  async retry(operationId: string): Promise<OperationMutation> {
    const record = await this.getRoot(operationId);
    if (!record) {
      return err({
        type: 'operation-not-found',
        message: `Operation ${operationId} was not found`,
      });
    }
    if (!this.definitions.has(record.name)) {
      return err({ type: 'operation-not-found', message: `Operation ${record.name} is unknown` });
    }
    const parsed = this.parseRecord(record);
    if (!parsed) {
      return err({
        type: 'operation-input-invalid',
        message: `Operation ${record.name} input is invalid`,
      });
    }
    const { descriptor, input } = parsed;
    const confirmation = needsConfirmation(record);
    const confirmed = confirmation
      ? ({ ...input, confirmedAt: this.clock.now() } as InputOf<typeof descriptor.definition>)
      : input;
    const submitted = await this.kernel.submit(descriptor.definition, confirmed, {
      initiator: { kind: 'user', action: 'retry-operation' },
    });
    if (!submitted.success) return err(admissionError(submitted.error));
    const oldRecords = await this.collectSubtree(record.id);
    const terminalIds = oldRecords
      .filter((oldRecord) => isTerminalStatus(oldRecord.status))
      .map((oldRecord) => oldRecord.id);
    const inputBase = asOperationInputBase(confirmed);
    void this.pruneTerminalRecordsWhenIdle(terminalIds, inputBase.projectId ?? undefined);
    this.refreshOperationTrees(inputBase.projectId ?? undefined);
    return ok({ operationId: submitted.data.id });
  }

  /**
   * Cancels a queued (never-dispatched) operation. Running operations are not
   * cancellable through this path — the outbox contract is pending-only
   * cancellation; use `forget` for terminal cleanup.
   */
  async cancel(operationId: string): Promise<OperationMutation> {
    const record = await this.kernel.get(operationId);
    if (!record) {
      return err({
        type: 'operation-not-found',
        message: `Operation ${operationId} was not found`,
      });
    }
    if (record.status !== 'pending') {
      return err({
        type: 'operation-not-cancellable',
        message: 'Only queued operations can be cancelled',
      });
    }
    await this.kernel.cancel(operationId);
    this.refreshOperationTrees();
    return ok({ operationId });
  }

  /**
   * Forget-host cascade: cancels every queued operation targeting the host so
   * its rows can be untracked without leaving orphaned outbox entries.
   */
  async cancelPendingForHost(hostRef: SerializedHostRef): Promise<number> {
    const active = await this.kernel.query({ active: true });
    let cancelled = 0;
    for (const record of active.records) {
      if (record.status !== 'pending') continue;
      if (this.hostRefFromRecord(record) !== hostRef) continue;
      await this.kernel.cancel(record.id);
      cancelled += 1;
    }
    if (cancelled > 0) this.refreshOperationTrees();
    return cancelled;
  }

  hostIsReachable(hostRef: SerializedHostRef): boolean {
    return this.hostIsOnline(hostRef);
  }

  async forget(operationId: string): Promise<OperationMutation> {
    const root = await this.getRoot(operationId);
    if (!root) {
      return err({
        type: 'operation-not-found',
        message: `Operation ${operationId} was not found`,
      });
    }

    await this.cancelTree(root.id);
    await this.waitForSubtreeSettlement(root.id, FORGET_SETTLE_TIMEOUT_MS);
    const records = await this.collectSubtree(root.id);
    for (const record of records) {
      if (record.id !== root.id && (await this.wasAdopted(record.id))) {
        continue;
      }
      await this.purgeRecord(record);
    }
    const terminalIds = records
      .filter((record) => isTerminalStatus(record.status))
      .map((record) => record.id);
    await this.store.transaction((tx) => tx.prune(terminalIds));
    this.refreshOperationTrees();
    return ok({ operationId });
  }

  operationTreeState(key: OperationTreeKey, scope: Scope): Query<OperationTreeList> {
    const release = this.operationTrees.retain({ projectId: key.projectId });
    scope.add(release);
    return this.operationTrees({ projectId: key.projectId });
  }

  poke(): void {
    this.kernel.poke();
  }

  async waitForIdle(timeoutMs = WAIT_FOR_IDLE_TIMEOUT_MS): Promise<void> {
    const deadline = this.clock.now() + timeoutMs;
    while (this.clock.now() < deadline) {
      const active = (await this.kernel.query({ active: true })).records;
      if (active.length === 0) return;
      await this.clock.sleep(WAIT_FOR_IDLE_POLL_MS);
    }
    throw new Error('Timed out waiting for operations to become idle');
  }

  async hasClaimConflict(claims: readonly ResourceClaim[]): Promise<boolean> {
    const active = await this.kernel.query({ active: true });
    return active.records.some((record) => claimsCollide(claims, record.claims));
  }

  async latestForWorkspace(
    operationName: string,
    workspaceId: string,
    options: { rootOnly?: boolean } = {}
  ): Promise<OperationRecord | undefined> {
    const limit = 500;
    let after: { seq: number } | undefined;
    let latest: OperationRecord | undefined;
    for (;;) {
      const page = await this.kernel.query({ name: [operationName], after, limit });
      for (const record of page.records) {
        if (options.rootOnly && record.parentId !== undefined) continue;
        const parsed = this.parseRecord(record);
        if (parsed && (parsed.input as { workspaceId?: string }).workspaceId === workspaceId) {
          latest = record;
        }
      }
      if (page.records.length < limit) return latest;
      after = { seq: page.records[page.records.length - 1]!.seq };
    }
  }

  async getForWorkspace(
    operationId: string,
    operationNames: readonly string[],
    workspaceId: string
  ): Promise<OperationRecord | undefined> {
    const record = await this.kernel.get(operationId);
    if (!record || !operationNames.includes(record.name)) return undefined;
    const parsed = this.parseRecord(record);
    return parsed && (parsed.input as { workspaceId?: string }).workspaceId === workspaceId
      ? record
      : undefined;
  }

  async waitForTerminal(
    operationId: string,
    signal?: AbortSignal
  ): Promise<OperationRecord | undefined> {
    for (;;) {
      if (signal?.aborted) return undefined;
      const record = await this.kernel.get(operationId);
      if (!record || isTerminalStatus(record.status)) return record;
      await this.clock.sleep(WAIT_FOR_IDLE_POLL_MS);
    }
  }

  async shutdown(): Promise<void> {
    await this.kernel.shutdown();
    this.store.close();
  }

  private async submitKernel<D extends AnyOperationDefinition>(
    definition: D,
    input: InputOf<D>,
    opts: {
      initiator: Parameters<KernelOperationEngine['submit']>[2]['initiator'];
      options: OperationSubmitOptions;
      revertOnReject: boolean;
    }
  ): Promise<OperationMutation> {
    const descriptor = this.definitions.get(definition.name);
    if (!descriptor) {
      return err({
        type: 'operation-not-found',
        message: `Operation ${definition.name} is unknown`,
      });
    }

    const tombstoneError = this.applyPreconditionAndTombstone(opts.options);
    if (tombstoneError) return err(tombstoneError);

    let submitted: Awaited<ReturnType<KernelOperationEngine['submit']>>;
    try {
      submitted = await this.kernel.submit(definition, input, {
        initiator: opts.initiator,
      });
    } catch (error) {
      if (opts.revertOnReject && opts.options.revertTombstone) {
        this.db.transaction((tx) => opts.options.revertTombstone?.(tx));
      }
      return err({
        type: 'operation-rejected',
        message: error instanceof Error ? error.message : 'Operation submission failed',
      });
    }
    if (!submitted.success) {
      if (opts.revertOnReject && opts.options.revertTombstone) {
        this.db.transaction((tx) => opts.options.revertTombstone?.(tx));
      }
      return err(admissionError(submitted.error));
    }
    this.maybePublishProposalNotification(submitted.data.id, definition, input);
    this.refreshOperationTrees(asOperationInputBase(input).projectId ?? undefined);
    return ok({ operationId: submitted.data.id });
  }

  private applyPreconditionAndTombstone(
    options: OperationSubmitOptions
  ): OperationMutationError | undefined {
    return this.db.transaction((tx) => {
      const precondition = options.precondition?.(tx);
      if (precondition) return precondition;
      const changed = options.tombstone?.(tx) ?? 1;
      if (changed === 0) {
        return { type: 'operation-duplicate', message: 'Operation target is already tombstoned' };
      }
      return undefined;
    });
  }

  private createRegistry(
    definitions: readonly OperationDefinition[],
    conflictPolicies: readonly ConflictPolicy[]
  ): OperationRegistry {
    return {
      definitions: definitions.map((definition) => definition.definition),
      handlers: definitions.map(
        (definition) => definition.handler as OperationHandler<AnyOperationDefinition>
      ),
      conflictPolicies,
    };
  }

  private createProgressSink(): ProgressSink {
    return {
      publish: (update) => {
        if (update.stages.length > 0) this.progress.set(update.operationId, update);
        void this.refreshOperationTreeForRecord(update.operationId);
      },
      end: (operationId) => {
        this.progress.delete(operationId);
        void this.refreshOperationTreeForRecord(operationId);
      },
    };
  }

  private parseRecord(record: OperationRecord) {
    const descriptor = this.definitions.get(record.name);
    if (!descriptor) return undefined;
    const parsed = descriptor.definition.input.safeParse(record.input);
    if (parsed.status !== 'ok') return undefined;
    return { descriptor, input: parsed.data };
  }

  private async loadOperationTrees(key: OperationTreeKey): Promise<OperationTreeList> {
    const records = (await this.kernel.query({})).records;
    const parsedInputs = new Map<string, ParsedOperationProjection>();
    for (const record of records) {
      const parsed = this.parseRecord(record);
      if (!parsed) continue;
      const { descriptor } = parsed;
      const operationInput = asOperationInputBase(parsed.input);
      parsedInputs.set(record.id, {
        displayName: descriptor.displayName,
        entityKind: descriptor.entityKind,
        entityId:
          operationInput.workspaceId ??
          operationInput.taskId ??
          operationInput.projectId ??
          record.key,
        projectId: operationInput.projectId ?? undefined,
        entityName: operationInput.entityName,
        hostRef: operationInput.hostRef,
        hostLabel: operationInput.hostLabel,
        workspacePath: operationInput.workspacePath,
        branchName: operationInput.branchName,
        prediction: descriptor.prediction?.(parsed.input),
      });
    }
    return projectOperationTrees({
      records,
      parsedInputs,
      progress: this.progress,
      dispatchReport: this.kernel.lastDispatchReport(),
      now: this.clock.now(),
      recentSettledWindowMs: RECENT_SETTLED_WINDOW_MS,
      projectId: key.projectId,
      fallbackHostRef: formatHostRef(LOCAL_HOST_REF),
    });
  }

  private refreshOperationTrees(projectId?: string): void {
    const poke: OperationTreePoke = projectId ? { projectId } : {};
    operationsPokes.trees.poke(poke);
  }

  private hostIsOnline(hostRef: SerializedHostRef): boolean {
    const parsed = parseHostRef(hostRef);
    if (isLocalHostRef(parsed)) return true;
    const connectionId = sshConnectionIdOf(parsed);
    return connectionId !== undefined && this.sshManager.isConnected(connectionId);
  }

  private hostRefFromRecord(record: OperationRecord): SerializedHostRef {
    const parsed = this.parseRecord(record);
    return parsed ? asOperationInputBase(parsed.input).hostRef : formatHostRef(LOCAL_HOST_REF);
  }

  private async refreshOperationTreeForRecord(operationId: string): Promise<void> {
    const record = await this.kernel.get(operationId);
    if (!record) {
      this.refreshOperationTrees();
      return;
    }
    const parsed = this.parseRecord(record);
    if (!parsed) {
      this.refreshOperationTrees();
      return;
    }
    const input = asOperationInputBase(parsed.input);
    this.refreshOperationTrees(input.projectId ?? undefined);
    if (isTerminalStatus(record.status) && input.repoPath) {
      publishOperationSettled({
        hostRef: input.hostRef,
        repoPath: input.repoPath,
        status: record.status,
      });
    }
  }

  private async getRoot(operationId: string): Promise<OperationRecord | undefined> {
    let current = await this.kernel.get(operationId);
    while (current?.parentId) {
      const parent = await this.kernel.get(current.parentId);
      if (!parent) break;
      current = parent;
    }
    return current;
  }

  private async collectSubtree(operationId: string): Promise<OperationRecord[]> {
    const root = await this.kernel.get(operationId);
    if (!root) return [];
    const children = await this.kernel.query({ parentId: operationId });
    const descendants = await Promise.all(
      children.records.map((child) => this.collectSubtree(child.id))
    );
    return [root, ...descendants.flat()];
  }

  private async cancelTree(operationId: string): Promise<void> {
    await this.kernel.cancel(operationId);
    const children = await this.kernel.query({ parentId: operationId, active: true });
    for (const child of children.records) {
      if (await this.wasAdopted(child.id)) continue;
      await this.cancelTree(child.id);
    }
  }

  private async waitForSubtreeSettlement(operationId: string, timeoutMs: number): Promise<void> {
    const deadline = this.clock.now() + timeoutMs;
    while (this.clock.now() < deadline) {
      const records = await this.collectSubtree(operationId);
      if (records.every((record) => isTerminalStatus(record.status))) return;
      await this.clock.sleep(WAIT_FOR_IDLE_POLL_MS);
    }
  }

  private async wasAdopted(operationId: string): Promise<boolean> {
    return (await this.store.listTransitions(operationId)).some(
      (transition) => transition.cause === 'adoption'
    );
  }

  private async purgeRecord(record: OperationRecord): Promise<void> {
    const parsed = this.parseRecord(record);
    if (!parsed?.descriptor.purge) return;
    await parsed.descriptor.purge({ input: parsed.input, record, db: this.db, clock: this.clock });
  }

  private async sweep(): Promise<void> {
    const openKeys = await this.loadOpenOperationKeys();
    const context: OperationReconcileContext = {
      db: this.db,
      clock: this.clock,
      submit: async (definition, input, options) => {
        await this.submitReconciler(definition, input, options);
      },
      hasActiveKey: async (key) => {
        return openKeys.has(key);
      },
    };

    for (const definition of this.definitions.values()) {
      await definition.reconcile?.(context);
    }
    await this.pruneRetainedRecords();
  }

  private async loadOpenOperationKeys(): Promise<Set<string>> {
    const records = (await this.kernel.query({})).records;
    return new Set(
      records
        .filter((record) => !isTerminalStatus(record.status) || needsConfirmation(record))
        .map((record) => record.key)
    );
  }

  private async pruneRetainedRecords(): Promise<void> {
    const active = await this.kernel.query({ active: true });
    if (active.records.length > 0) return;
    const records = (await this.kernel.query({})).records;
    const pruneIds = records
      .filter((record) => {
        if (!isTerminalStatus(record.status)) return false;
        if (!this.parseRecord(record)) return true;
        if (needsConfirmation(record)) return false;
        if (record.status === 'cancelled') return true;
        return record.updatedAt < this.clock.now() - OPERATION_RETENTION_MS;
      })
      .map((record) => record.id);
    await this.store.transaction((tx) => tx.prune(pruneIds));
  }

  private async pruneTerminalRecordsWhenIdle(
    ids: readonly string[],
    projectId?: string
  ): Promise<void> {
    if (ids.length === 0) return;
    try {
      await this.waitForIdle();
      await this.store.transaction((tx) => tx.prune(ids));
      this.refreshOperationTrees(projectId);
    } catch (error) {
      this.logger.warn('operations prune after retry failed', { error: String(error) });
    }
  }

  private maybePublishProposalNotification<D extends AnyOperationDefinition>(
    operationId: string,
    definition: D,
    input: InputOf<D>
  ): void {
    if (!isReconcilerInput(input)) return;
    const descriptor = this.definitions.get(definition.name);
    if (!descriptor) return;
    const operationInput = asOperationInputBase(input);
    const payload: OperationPayload = {
      version: '2',
      source: 'reconciler',
      entityName: operationInput.entityName,
      workspacePath: operationInput.workspacePath,
      branchName: operationInput.branchName,
      hostLabel: operationInput.hostLabel,
    };
    this.notifications.publishPendingCleanup({
      operationId,
      payload,
      hostRef: operationInput.hostRef,
      reason: 'reconciler-proposed',
    });
  }
}

function needsConfirmation(record: OperationRecord) {
  if (record.status !== 'rejected') return undefined;
  const parsed = operationNeedsConfirmationErrorSchema.safeParse(record.rejectedError);
  return parsed.success ? parsed.data : undefined;
}

function isReconcilerInput(input: unknown): input is { source: 'reconciler' } {
  return (
    typeof input === 'object' &&
    input !== null &&
    'source' in input &&
    input.source === 'reconciler'
  );
}

function asOperationInputBase(input: unknown): OperationInputBase {
  return input as OperationInputBase;
}

function admissionError(error: { kind: string; conflicts?: OperationRecord[]; name?: string }) {
  switch (error.kind) {
    case 'conflict':
      return {
        type: 'resource-claimed',
        message: `Operation conflicts with ${error.conflicts?.[0]?.name ?? 'another operation'}`,
      };
    case 'duplicate':
      return { type: 'operation-duplicate', message: 'Operation is already queued' };
    case 'unknown-definition':
    case 'missing-handler':
      return {
        type: 'operation-not-found',
        message: error.name ? `Operation ${error.name} is unknown` : 'Operation is unknown',
      };
    default:
      return {
        type: 'operation-rejected',
        message: error.name ? `Operation ${error.name} cannot be submitted` : 'Operation failed',
      };
  }
}

function operationTreeKey(key: OperationTreeKey): string {
  return JSON.stringify({ projectId: key.projectId });
}
