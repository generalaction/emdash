import { randomUUID } from 'node:crypto';
import {
  createOperationHandler,
  defineConflictPolicy,
  defineOperation,
  displayStatus,
  isTerminalStatus,
  operationTreeView,
  type AnyOperationDefinition,
  type OperationHandler,
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
  operationClaimResourceKey,
  type OperationConfirmationReason,
  rollupStatus,
  type OperationClaimResource,
  type OperationDisplayState,
  type OperationMutationError,
  type OperationTree,
  type OperationTreeKey,
  type OperationTreeList,
} from '@emdash/core/primitives/operations/api';
import { defineVersionedSchema } from '@emdash/core/primitives/versioned-schema/api';
import { err, ok, type Result } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import { systemClock, type Clock } from '@emdash/shared/scheduling';
import { family, query, type Family, type Query } from '@emdash/wire';
import { z } from 'zod';
import type { AppDb } from '@core/services/app-db/node/db';
import {
  operationsPokes,
  type OperationTreePoke,
  matchOperationProject,
} from '@core/services/operations/node/pokes';
import type {
  OperationDefinition,
  OperationDraftInput,
  OperationInsertOptions,
  OperationProgress,
  OperationSubmission,
  OperationSubmit,
  OperationsNotificationPublisher,
  OperationsSshManager,
} from './definition';
import type { LifecycleOperationRow } from './lifecycle-operation';

const legacyOperationInputSchema = defineVersionedSchema()
  .unversioned(
    z.custom<LegacyOperationInput>((value) => typeof value === 'object' && value !== null)
  )
  .build();
const legacyOperationResultSchema = z.object({ ok: z.boolean() });
const legacyOperationErrorSchema = z.object({
  type: z.string(),
  reason: z.string().optional(),
  message: z.string().optional(),
  code: z.string().optional(),
  retryable: z.boolean().optional(),
});

type OperationMutationResult = Result<{ operationId?: string }, OperationMutationError>;

export type OperationsEngineDeps = {
  db: AppDb;
  scope: Scope;
  store: SqliteOperationStore;
  sshManager: OperationsSshManager;
  notifications: OperationsNotificationPublisher;
  definitions: OperationDefinition[];
  initiatedBy?: string;
  clock?: Clock;
};

export interface LegacyOperationInput {
  draft: OperationDraftInput & { id: string; createdAt: number };
  claims: ResourceClaim[];
  parentForgetPolicy?: 'abandon-children' | 'orphan-children';
}

export class OperationsEngine {
  private readonly db: AppDb;
  private readonly scope: Scope;
  private readonly store: SqliteOperationStore;
  private readonly sshManager: OperationsSshManager;
  private readonly definitions: Map<string, OperationDefinition>;
  private readonly kernelDefinitions: Map<string, AnyOperationDefinition>;
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
    this.clock = deps.clock ?? systemClock;
    this.initiatedBy = deps.initiatedBy;
    this.definitions = new Map(deps.definitions.map((definition) => [definition.kind, definition]));
    const registry = this.createRegistry(deps.definitions);
    this.kernelDefinitions = new Map(
      registry.definitions.map((definition) => [definition.name, definition])
    );
    this.kernel = createOperationEngine({
      store: deps.store,
      registry,
      progress: this.createProgressSink(),
      clock: {
        now: () => this.clock.now(),
        setTimeout: (callback, ms) => setTimeout(callback, ms),
      },
      dispatchGate: (record) => this.hostIsOnline(hostRefFromRecord(record)),
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
    this.refreshOperationTrees();
  }

  readonly submit: OperationSubmit = async (prepare) => {
    const prepared = await prepare({ db: this.db, clock: this.clock });
    if (!prepared.success) return prepared;
    if (prepared.data.outcome === 'existing') {
      return ok({ operationId: prepared.data.operationId });
    }

    try {
      return await this.enqueueSubmission(prepared.data);
    } catch (error) {
      return err({
        type: 'operation-submit-failed',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  async retry(operationId: string): Promise<OperationMutationResult> {
    const record = await this.getRoot(operationId);
    if (!record) {
      return err({
        type: 'operation-not-found',
        message: `Operation ${operationId} was not found`,
      });
    }
    const definition = this.kernelDefinitions.get(record.name);
    if (!definition) {
      return err({ type: 'operation-not-found', message: `Operation ${record.name} is unknown` });
    }

    const input = cloneLegacyInput(record.input);
    const rejected = needsConfirmation(record);
    if (rejected) {
      input.draft.confirmedAt = this.clock.now();
      input.draft.confirmationReason = rejected.reason;
    }
    const submitted = await this.kernel.submit(definition, input, {
      initiator: { kind: 'user', action: 'retry-operation' },
    });
    if (!submitted.success) {
      return err(admissionError(submitted.error));
    }
    this.refreshOperationTrees(input.draft.projectId ?? undefined);
    return ok({ operationId: submitted.data.id });
  }

  async forget(operationId: string): Promise<OperationMutationResult> {
    await this.cancelTree(operationId);
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

  async waitForIdle(): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const active = (await this.kernel.query({ active: true })).records;
      if (active.length === 0) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  async hasClaimConflict(resources: readonly OperationClaimResource[]): Promise<boolean> {
    const keys = resources.map((resource) => operationClaimResourceKey(resource));
    for (const key of keys) {
      const page = await this.kernel.query({ resource: { key }, active: true, limit: 1 });
      if (page.records.length > 0) {
        return true;
      }
    }
    return false;
  }

  async shutdown(): Promise<void> {
    await this.kernel.shutdown();
    this.store.close();
  }

  private async enqueueSubmission(
    submission: Extract<OperationSubmission, { outcome: 'enqueue' }>
  ) {
    const members = [submission, ...(submission.related ?? [])];
    for (const member of members) {
      const error = await this.applyPreconditionAndTombstone(member.draft, member.options);
      if (error) {
        return err(error);
      }
    }

    const parentInput = this.inputFromDraft(submission.draft, submission.options);
    const relatedInputs = (submission.related ?? []).map((related) =>
      this.inputFromDraft(related.draft, related.options)
    );
    const parentDefinition = this.definitionForInput(parentInput);
    if (!parentDefinition) {
      return err({
        type: 'operation-not-found',
        message: `Operation ${parentInput.draft.kind} is unknown`,
      });
    }

    if (relatedInputs.length === 0) {
      const submitted = await this.kernel.submit(parentDefinition, parentInput, {
        initiator: { kind: 'user', action: parentInput.draft.kind },
      });
      if (!submitted.success) {
        return err(admissionError(submitted.error));
      }
      this.refreshOperationTrees(parentInput.draft.projectId ?? undefined);
      return ok({ operationId: submitted.data.id });
    }

    const batch = [
      { definition: parentDefinition, input: parentInput },
      ...relatedInputs.flatMap((input) => {
        const definition = this.definitionForInput(input);
        return definition ? [{ definition, input, parent: 0, adoptExisting: true }] : [];
      }),
    ];
    const submitted = await this.kernel.submitBatch(batch, {
      initiator: { kind: 'user', action: parentInput.draft.kind },
      propagation: 'fail-parent',
    });
    if (!submitted.success) {
      return err(admissionError(submitted.error));
    }
    this.refreshOperationTrees(parentInput.draft.projectId ?? undefined);
    return ok({ operationId: submitted.data.handles[0]?.id });
  }

  private async applyPreconditionAndTombstone(
    draft: OperationDraftInput,
    options: OperationInsertOptions | undefined
  ): Promise<OperationMutationError | undefined> {
    if (options?.precondition) {
      const error = this.db.transaction((tx) => options.precondition?.(tx));
      if (error) return error;
    }
    if (options?.tombstone) {
      const changed = this.db.transaction((tx) => options.tombstone?.(tx) ?? 1);
      if (changed === 0) {
        return {
          type: 'operation-duplicate',
          message: `Operation already exists for ${draft.entityKey ?? draft.id}`,
        };
      }
    }
    return undefined;
  }

  private inputFromDraft(
    draftInput: OperationDraftInput,
    options: OperationInsertOptions | undefined
  ): LegacyOperationInput {
    const now = this.clock.now();
    const draft = {
      ...draftInput,
      id: draftInput.id ?? randomUUID(),
      createdAt: draftInput.createdAt ?? now,
      initiatedBy: draftInput.initiatedBy ?? this.initiatedBy,
    };
    return {
      draft,
      claims: (options?.claims ?? []).map((claim) => legacyClaimToKernel(claim)),
      parentForgetPolicy: options?.parentForgetPolicy,
    };
  }

  private definitionForInput(input: LegacyOperationInput): AnyOperationDefinition | undefined {
    return this.kernelDefinitions.get(input.draft.kind);
  }

  private createRegistry(definitions: readonly OperationDefinition[]): OperationRegistry {
    const pairs = definitions.map((definition) => {
      const kernelDefinition = defineOperation({
        name: definition.kind,
        input: legacyOperationInputSchema,
        result: legacyOperationResultSchema,
        error: legacyOperationErrorSchema,
        key: (input) => `${input.draft.kind}:${input.draft.entityKey ?? input.draft.id}`,
        claims: (input) => input.claims,
        describe: (input) =>
          input.draft.payload.entityName ?? input.draft.entityKey ?? input.draft.id,
        retry: { maxAttempts: 1, backoff: { kind: 'fixed', baseMs: 0 } },
      }) as AnyOperationDefinition;
      const handler = createOperationHandler(kernelDefinition, async (ctx) => {
        const input = ctx.input as LegacyOperationInput;
        const operation = rowFromInput(ctx.operationId, input, ctx.attempt, 'running');
        const result = await definition.run({
          operation,
          db: this.db,
          signal: ctx.signal,
          clock: this.clock,
          reportProgress: (progress) => {
            this.progress.set(ctx.operationId, progress);
            this.refreshOperationTrees(operation.projectId ?? undefined);
          },
        });
        if (!result.success) {
          if (result.error.type === 'awaiting-confirmation') {
            ctx.reject({
              type: 'needs-confirmation',
              reason: result.error.reason,
              message: result.error.message,
            });
          }
          if (result.error.type === 'failed') {
            throw Object.assign(new Error(result.error.message), {
              code: result.error.code,
              retryable: result.error.retryable,
            });
          }
          throw new Error(result.error.message ?? 'Operation failed');
        }
        return { ok: true };
      }) as OperationHandler<AnyOperationDefinition>;
      return { definition: kernelDefinition, handler };
    });

    const policy = defineConflictPolicy((on) => {
      for (const incoming of pairs) {
        for (const existing of pairs) {
          on(incoming.definition, existing.definition).queue();
        }
      }
    });

    return {
      definitions: pairs.map((pair) => pair.definition),
      handlers: pairs.map((pair) => pair.handler),
      conflictPolicies: [policy],
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
        this.refreshOperationTrees();
      },
      end: (operationId) => {
        this.progress.delete(operationId);
        this.refreshOperationTrees();
      },
    };
  }

  private async loadOperationTrees(key: OperationTreeKey): Promise<OperationTreeList> {
    const records = (await this.kernel.query({ limit: 500 })).records.filter((record) => {
      const input = legacyInput(record);
      if (!input) return false;
      if (key.projectId !== undefined && input.draft.projectId !== key.projectId) return false;
      return (
        !isTerminalStatus(record.status) ||
        record.status === 'failed' ||
        record.status === 'rejected'
      );
    });
    const nodes = operationTreeView(records);
    return Object.fromEntries(
      nodes.map((node) => {
        const root = this.toDisplayState(node.record);
        const children = node.children.map((child) => this.toDisplayState(child.record));
        const tree: OperationTree = {
          root,
          children,
          rollup: {
            total: 1 + children.length,
            done: [root, ...children].filter((item) => item.status !== 'failed').length,
            status: rollupStatus([root, ...children]),
          },
        };
        return [root.operationId, tree];
      })
    );
  }

  private toDisplayState(record: OperationRecord): OperationDisplayState {
    const input = cloneLegacyInput(record.input);
    const progress = this.progress.get(record.id);
    const status = displayStatus(record, this.kernel.lastDispatchReport());
    const rejected = needsConfirmation(record);
    const base = {
      operationId: record.id,
      operationKind: record.name,
      entityId:
        input.draft.entityKey ??
        input.draft.taskId ??
        input.draft.workspaceId ??
        input.draft.projectId ??
        record.id,
      entityKind: this.definitions.get(record.name)?.entityKind ?? 'project',
      projectId: input.draft.projectId ?? undefined,
      entityName: input.draft.payload.entityName,
      hostRef: input.draft.hostRef,
      hostLabel: input.draft.payload.hostLabel,
      workspacePath: input.draft.payload.workspacePath,
      branchName: input.draft.payload.branchName,
      createdAt: input.draft.createdAt,
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
    if (status.kind === 'waiting') {
      return { ...base, status: 'waiting' };
    }
    if (status.kind === 'running') {
      return { ...base, status: progress?.waiting ? 'waiting' : 'running' };
    }
    if (status.kind === 'waiting-children') {
      return { ...base, status: 'waiting-children' };
    }
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

  private async getRoot(operationId: string): Promise<OperationRecord | undefined> {
    let current = await this.kernel.get(operationId);
    while (current?.parentId) {
      const parent = await this.kernel.get(current.parentId);
      if (!parent) break;
      current = parent;
    }
    return current;
  }

  private async cancelTree(operationId: string): Promise<void> {
    const root = await this.kernel.get(operationId);
    if (!root) return;
    await this.kernel.cancel(operationId);
    for (const child of (await this.kernel.query({ parentId: operationId, active: true }))
      .records) {
      const transitions = await this.store.listTransitions(child.id);
      if (transitions.some((transition) => transition.cause === 'adoption')) {
        continue;
      }
      await this.cancelTree(child.id);
    }
  }
}

function rowFromInput(
  id: string,
  input: LegacyOperationInput,
  attempt: number,
  status: LifecycleOperationRow['status']
): LifecycleOperationRow {
  return {
    id,
    kind: input.draft.kind,
    status,
    projectId: input.draft.projectId ?? null,
    taskId: input.draft.taskId ?? null,
    workspaceId: input.draft.workspaceId ?? null,
    entityKey: input.draft.entityKey ?? null,
    parentOperationId: input.draft.parentOperationId ?? null,
    parentForgetPolicy: input.parentForgetPolicy ?? null,
    initiatedBy: input.draft.initiatedBy ?? null,
    hostRef: input.draft.hostRef,
    payload: input.draft.payload,
    confirmedAt: input.draft.confirmedAt ?? null,
    confirmationReason: input.draft.confirmationReason ?? null,
    attempt,
    createdAt: input.draft.createdAt,
    finishedAt: null,
  };
}

function legacyClaimToKernel(resource: OperationClaimResource): ResourceClaim {
  return {
    resource: resource.kind,
    key: operationClaimResourceKey(resource),
    mode: 'exclusive',
    implicit: false,
  };
}

function hostRefFromRecord(record: OperationRecord): string {
  return legacyInput(record)?.draft.hostRef ?? 'local';
}

function legacyInput(record: OperationRecord): LegacyOperationInput | undefined {
  return isLegacyOperationInput(record.input) ? record.input : undefined;
}

function cloneLegacyInput(input: unknown): LegacyOperationInput {
  if (!isLegacyOperationInput(input)) {
    throw new Error('Stored operation input is not a legacy operation input');
  }
  return {
    draft: { ...input.draft, payload: { ...input.draft.payload } },
    claims: input.claims.map((claim) => ({ ...claim })),
    parentForgetPolicy: input.parentForgetPolicy,
  };
}

function isLegacyOperationInput(input: unknown): input is LegacyOperationInput {
  return (
    typeof input === 'object' &&
    input !== null &&
    'draft' in input &&
    typeof input.draft === 'object' &&
    input.draft !== null &&
    'kind' in input.draft &&
    'hostRef' in input.draft
  );
}

function needsConfirmation(
  record: OperationRecord
): { reason: string; message?: string } | undefined {
  if (record.status !== 'rejected') {
    return undefined;
  }
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

function admissionError(error: { kind: string; conflicts?: OperationRecord[]; name?: string }) {
  if (error.kind === 'conflict') {
    return {
      type: 'resource-claimed',
      message: `Operation conflicts with ${error.conflicts?.[0]?.name ?? 'another operation'}`,
    };
  }
  return {
    type: error.kind,
    message: error.name ? `Operation ${error.name} cannot be submitted` : 'Operation failed',
  };
}

function operationTreeKey(key: OperationTreeKey): string {
  return JSON.stringify({ projectId: key.projectId });
}
