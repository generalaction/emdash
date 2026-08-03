import {
  claimsCollide,
  displayStatus,
  isTerminalStatus,
  operationTreeView,
  type AnyOperationDefinition,
  type ConflictPolicy,
  type InputOf,
  type OperationHandler,
  type OperationRecord,
  type OperationTreeNode,
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
  rollupStatus,
  type OperationConfirmationReason,
  type OperationDisplayState,
  type OperationMutationError,
  type OperationTree,
  type OperationTreeKey,
  type OperationTreeList,
} from '@emdash/core/primitives/operations/api';
import { err, ok, type Result } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import type { Logger } from '@emdash/shared/logger';
import { systemClock, type Clock } from '@emdash/shared/scheduling';
import { family, query, type Family, type Query } from '@emdash/wire';
import type { OperationPayload } from '@core/primitives/operations/api';
import type { AppDb } from '@core/services/app-db/node/db';
import {
  matchOperationProject,
  operationsPokes,
  type OperationTreePoke,
} from '@core/services/operations/node/pokes';
import type {
  OperationDefinition,
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
  private readonly progress = new Map<string, OperationProgressSummary>();
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
    const interval = setInterval(() => {
      void this.sweep().catch((error: unknown) => {
        this.logger.warn('operations reconciler sweep failed', { error: String(error) });
      });
    }, RECONCILER_INTERVAL_MS);
    this.scope.add(() => clearInterval(interval));
    await this.sweep();
    this.refreshOperationTrees();
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
    const descriptor = this.definitions.get(record.name);
    if (!descriptor) {
      return err({ type: 'operation-not-found', message: `Operation ${record.name} is unknown` });
    }
    const parsed = descriptor.definition.input.safeParse(record.input);
    if (parsed.status !== 'ok') {
      return err({
        type: 'operation-input-invalid',
        message: `Operation ${record.name} input is invalid`,
      });
    }
    const confirmation = needsConfirmation(record);
    const confirmed = confirmation
      ? descriptor.confirmedInput(
          parsed.data,
          this.clock.now(),
          confirmation.reason as OperationConfirmationReason
        )
      : parsed.data;
    const submitted = await this.kernel.submit(descriptor.definition, confirmed, {
      initiator: { kind: 'user', action: 'retry-operation' },
    });
    if (!submitted.success) return err(admissionError(submitted.error));
    const oldRecords = await this.collectSubtree(record.id);
    const terminalIds = oldRecords
      .filter((oldRecord) => isTerminalStatus(oldRecord.status))
      .map((oldRecord) => oldRecord.id);
    void this.pruneTerminalRecordsWhenIdle(terminalIds, descriptor.projectId(confirmed));
    this.refreshOperationTrees(descriptor.projectId(confirmed));
    return ok({ operationId: submitted.data.id });
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

    const submitted = await this.kernel.submit(definition, input, {
      initiator: opts.initiator,
    });
    if (!submitted.success) {
      if (opts.revertOnReject && opts.options.revertTombstone) {
        this.db.transaction((tx) => opts.options.revertTombstone?.(tx));
      }
      return err(admissionError(submitted.error));
    }
    this.maybePublishProposalNotification(submitted.data.id, definition, input);
    this.refreshOperationTrees(descriptor.projectId(input));
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
        if (update.stages.length > 0) {
          const current = update.stages.at(-1);
          this.progress.set(update.operationId, {
            currentStep: current?.id,
            completedSteps: update.stages.filter((stage) => stage.status === 'succeeded').length,
            totalSteps: update.stages.length,
          });
        }
        void this.refreshOperationTreeForRecord(update.operationId);
      },
      end: (operationId) => {
        this.progress.delete(operationId);
        void this.refreshOperationTreeForRecord(operationId);
      },
    };
  }

  private async loadOperationTrees(key: OperationTreeKey): Promise<OperationTreeList> {
    const records = (await this.kernel.query({})).records.filter((record) => {
      if (
        isTerminalStatus(record.status) &&
        record.status !== 'failed' &&
        record.status !== 'rejected' &&
        record.updatedAt < this.clock.now() - RECENT_SETTLED_WINDOW_MS
      ) {
        return false;
      }
      const descriptor = this.definitions.get(record.name);
      if (!descriptor) return false;
      const parsed = descriptor.definition.input.safeParse(record.input);
      if (parsed.status !== 'ok') return false;
      return key.projectId === undefined || descriptor.projectId(parsed.data) === key.projectId;
    });

    const nodes = operationTreeView(records).filter((node) => this.shouldRetainTree(node));
    return Object.fromEntries(
      nodes.map((node) => {
        const root = this.toDisplayState(node.record);
        const children = flattenTreeChildren(node).map((child) => this.toDisplayState(child));
        const allNodes = [root, ...children];
        const tree: OperationTree = {
          root,
          children,
          rollup: {
            total: allNodes.length,
            done: allNodes.filter((item) => item.status === 'succeeded').length,
            status: rollupStatus(allNodes),
          },
        };
        return [root.operationId, tree];
      })
    );
  }

  private toDisplayState(record: OperationRecord): OperationDisplayState {
    const descriptor = this.definitions.get(record.name);
    if (!descriptor) {
      return fallbackDisplay(record);
    }
    const parsed = descriptor.definition.input.safeParse(record.input);
    if (parsed.status !== 'ok') {
      return fallbackDisplay(record);
    }
    const description = descriptor.describe(parsed.data);
    const progress = this.progress.get(record.id);
    const status = displayStatus(record, this.kernel.lastDispatchReport());
    const rejected = needsConfirmation(record);
    const base = {
      operationId: record.id,
      operationKind: record.name,
      entityId: record.key,
      entityKind: descriptor.entityKind,
      projectId: descriptor.projectId(parsed.data),
      entityName: description.entityName,
      hostRef: descriptor.hostRef(parsed.data),
      hostLabel: description.hostLabel,
      workspacePath: description.workspacePath,
      branchName: description.branchName,
      createdAt: record.createdAt,
      attempt: record.attempt,
      currentStep: progress?.currentStep,
      completedSteps: progress?.completedSteps,
      totalSteps: progress?.totalSteps,
      error: record.error?.message,
    };
    if (rejected) {
      return {
        ...base,
        status: 'awaiting-confirmation',
        confirmationReason: rejected.reason as OperationConfirmationReason,
        error: rejected.message,
      };
    }
    if (status.kind === 'deferred' && status.reason === 'gated') {
      return { ...base, status: 'blocked-host-offline' };
    }
    if (status.kind === 'waiting') return { ...base, status: 'waiting' };
    if (status.kind === 'running') return { ...base, status: 'running' };
    if (status.kind === 'waiting-children') return { ...base, status: 'waiting-children' };
    if (status.kind === 'succeeded') return { ...base, status: 'succeeded' };
    if (status.kind === 'failed' || status.kind === 'rejected') {
      return { ...base, status: 'failed', error: base.error ?? 'Operation failed' };
    }
    return { ...base, status: 'queued' };
  }

  private refreshOperationTrees(projectId?: string): void {
    const poke: OperationTreePoke = projectId ? { projectId } : {};
    operationsPokes.trees.poke(poke);
  }

  private hostIsOnline(hostRef: string): boolean {
    return hostRef === 'local' || this.sshManager.isConnected(hostRef);
  }

  private hostRefFromRecord(record: OperationRecord): string {
    const descriptor = this.definitions.get(record.name);
    const parsed = descriptor?.definition.input.safeParse(record.input);
    return parsed?.status === 'ok' && descriptor ? descriptor.hostRef(parsed.data) : 'local';
  }

  private async refreshOperationTreeForRecord(operationId: string): Promise<void> {
    const record = await this.kernel.get(operationId);
    if (!record) {
      this.refreshOperationTrees();
      return;
    }
    const descriptor = this.definitions.get(record.name);
    const parsed = descriptor?.definition.input.safeParse(record.input);
    if (!descriptor || parsed?.status !== 'ok') {
      this.refreshOperationTrees();
      return;
    }
    this.refreshOperationTrees(descriptor.projectId(parsed.data));
  }

  private shouldRetainTree(node: OperationTreeNode): boolean {
    return flattenTreeRecords(node).some((record) => {
      if (!isTerminalStatus(record.status)) return true;
      return record.status === 'failed' || record.status === 'rejected';
    });
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
    const descriptor = this.definitions.get(record.name);
    if (!descriptor?.purge) return;
    const parsed = descriptor.definition.input.safeParse(record.input);
    if (parsed.status !== 'ok') return;
    await descriptor.purge({ input: parsed.data, record, db: this.db, clock: this.clock });
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
        const descriptor = this.definitions.get(record.name);
        const parsed = descriptor?.definition.input.safeParse(record.input);
        if (parsed?.status !== 'ok') return true;
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
    if (!descriptor || definition.name === 'cleanup-sessions') return;
    const description = descriptor.describe(input);
    const payload: OperationPayload = {
      version: '2',
      source: 'reconciler',
      entityName: description.entityName,
      workspacePath: description.workspacePath,
      branchName: description.branchName,
      hostLabel: description.hostLabel,
    };
    this.notifications.publishPendingCleanup({
      operationId,
      payload,
      hostRef: descriptor.hostRef(input),
      reason: 'reconciler-proposed',
    });
  }
}

type OperationProgressSummary = {
  currentStep?: string;
  completedSteps: number;
  totalSteps: number;
};

function needsConfirmation(
  record: OperationRecord
): { reason: string; message?: string } | undefined {
  if (record.status !== 'rejected') return undefined;
  const error = record.rejectedError;
  if (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    error.type === 'needs-confirmation' &&
    'reason' in error &&
    typeof error.reason === 'string'
  ) {
    return {
      reason: error.reason,
      message: 'message' in error && typeof error.message === 'string' ? error.message : undefined,
    };
  }
  return undefined;
}

function isReconcilerInput(input: unknown): input is { source: 'reconciler' } {
  return (
    typeof input === 'object' &&
    input !== null &&
    'source' in input &&
    input.source === 'reconciler'
  );
}

function fallbackDisplay(record: OperationRecord): OperationDisplayState {
  return {
    operationId: record.id,
    operationKind: record.name,
    entityId: record.key,
    entityKind: 'project',
    hostRef: 'local',
    createdAt: record.createdAt,
    attempt: record.attempt,
    status:
      record.status === 'failed' || record.status === 'rejected'
        ? 'failed'
        : record.status === 'succeeded'
          ? 'succeeded'
          : 'queued',
    error: record.error?.message ?? 'Operation failed',
  };
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

function flattenTreeRecords(node: OperationTreeNode): OperationRecord[] {
  return [node.record, ...node.children.flatMap(flattenTreeRecords)];
}

function flattenTreeChildren(node: OperationTreeNode): OperationRecord[] {
  return node.children.flatMap(flattenTreeRecords);
}
