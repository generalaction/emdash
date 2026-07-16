import { randomUUID } from 'node:crypto';
import { err, ok, type PendingLease, type Result } from '@emdash/shared';
import { createResourceCache, type Scope } from '@emdash/shared/concurrency';
import { systemClock, type Clock } from '@emdash/shared/scheduling';
import { ComputedLiveState, type LiveSource } from '@emdash/wire';
import { notificationService } from '@services/notifications/node';
import { and, desc, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import { appScope } from '@main/app/app-scope';
import { checkoutSelector } from '@main/core/git/runtime-client';
import { projectManager } from '@main/core/projects/project-manager';
import { sshConnectionManager } from '@main/core/ssh/lifecycle/production-ssh-connection-manager';
import { db, type DrizzleTx } from '@main/db/client';
import {
  lifecycleOperations,
  projects,
  tasks,
  workspaces,
  type LifecycleOperationRow,
} from '@main/db/schema';
import { log } from '@main/lib/logger';
import type {
  DeletionEntityKind,
  DeletionList,
  DeletionMutationError,
  DeletionState,
} from '@shared/core/operations/deletion';
import type { OperationPayload } from '@shared/core/operations/operation-payload';
import { nonTerminalOperationStatuses } from '@shared/core/operations/operation-types';
import { purgeProjectLocalState, purgeTaskLocalState } from './local-cleanup';
import { resolveOperationContext, type OperationContext } from './operation-context';
import { workspaceInUseError } from './operation-errors';
import type { ExecutableOperationPlan, OperationProgress } from './operation-plan';
import { runOperationPlan } from './plan-runner';
import { compileOperationPlan } from './plans/compile-operation-plan';

const STALE_AFTER_MS = 24 * 60 * 60 * 1_000;
const RESUME_AGE_MS = 10 * 60 * 1_000;
// Path-only orphan cleanup needs a worktree ref, but HEAD is never marked as Emdash-created.
const UNKNOWN_BRANCH_SENTINEL = 'HEAD';
const reconcilerDedupeStatuses = [...nonTerminalOperationStatuses, 'abandoned'] as const;

type OperationMutationResult = Result<{ operationId?: string }, DeletionMutationError>;

type DeleteTaskInput = {
  taskId: string;
  deleteWorktree?: boolean;
  deleteBranch?: boolean;
};

type OperationDraft = Pick<
  LifecycleOperationRow,
  | 'id'
  | 'kind'
  | 'status'
  | 'projectId'
  | 'taskId'
  | 'workspaceId'
  | 'entityKey'
  | 'hostRef'
  | 'payload'
  | 'createdAt'
>;

type OperationDraftInput = Pick<
  OperationDraft,
  'kind' | 'status' | 'entityKey' | 'hostRef' | 'payload'
> &
  Partial<Pick<OperationDraft, 'id' | 'projectId' | 'taskId' | 'workspaceId' | 'createdAt'>>;

type InsertOperationOptions = {
  dedupeStatuses?: readonly LifecycleOperationRow['status'][];
  precondition?: (tx: DrizzleTx) => DeletionMutationError | undefined;
  tombstone?: (tx: DrizzleTx) => number;
};

type InsertOperationOutcome =
  | { outcome: 'inserted' }
  | { outcome: 'duplicate' }
  | { outcome: 'precondition-failed'; error: DeletionMutationError };

export type OperationsServiceOptions = {
  clock?: Clock;
  scope?: Scope;
};

type DeletionStateKey = {
  kind: DeletionEntityKind;
  entityId?: string;
};

export type ReconcilerSessionCleanupInput = {
  entityId: string;
  projectId?: string;
  workspacePath?: string;
  hostRef?: string;
  acpConversationIds?: string[];
  tuiConversationIds?: string[];
  terminalSessionIds?: string[];
  tmuxSessionNames?: string[];
};

export type ReconcilerWorkspaceCleanupInput = {
  projectId: string;
  workspaceId?: string;
  workspacePath: string;
  branchName?: string;
};

export type ArchiveWorkspaceInput = {
  projectId: string;
  workspaceId?: string;
  workspacePath: string;
  branchName?: string;
};

export class OperationsService {
  private readonly clock: Clock;
  private readonly scope: Scope;
  private initialized = false;
  private drainRequested = false;
  private drainPromise: Promise<void> | undefined;
  private readonly progress = new Map<string, OperationProgress>();
  private readonly deletionStateKeys = new Map<string, DeletionStateKey>();
  private readonly deletionStates: ReturnType<
    typeof createResourceCache<DeletionStateKey, ComputedLiveState<DeletionList>>
  >;

  constructor(options: OperationsServiceOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.scope = options.scope ?? appScope.child('lifecycle-operations');
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

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    await db
      .update(lifecycleOperations)
      .set({ status: 'pending', error: null })
      .where(eq(lifecycleOperations.status, 'running'));
    const onConnection = (event: { type: string }) => {
      void this.refreshDeletionStates();
      if (event.type === 'connected' || event.type === 'reconnected') this.poke();
    };
    sshConnectionManager.on('connection-event', onConnection);
    this.scope.add(() => {
      sshConnectionManager.off('connection-event', onConnection);
    });
    this.scope.add(async () => {
      await db
        .update(lifecycleOperations)
        .set({ status: 'pending' })
        .where(eq(lifecycleOperations.status, 'running'));
    });
    await this.refreshDeletionStates();
    this.poke();
  }

  async enqueueDeleteTask(input: DeleteTaskInput): Promise<OperationMutationResult> {
    const [task] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, input.taskId), isNull(tasks.deletedAt)))
      .limit(1);
    if (!task) {
      const existing = await this.latestOperation('task', input.taskId);
      return existing
        ? ok({ operationId: existing.id })
        : err({ type: 'task-not-found', message: `Task ${input.taskId} was not found` });
    }

    const [workspace] = task.workspaceId
      ? await db.select().from(workspaces).where(eq(workspaces.id, task.workspaceId)).limit(1)
      : [];
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, task.projectId))
      .limit(1);
    const operationId = randomUUID();
    const createdAt = this.clock.now();
    const payload: OperationPayload = {
      version: '1',
      source: 'user',
      entityName: task.name,
      hostLabel: project?.sshConnectionId ? project.name : undefined,
      deleteWorktree: input.deleteWorktree ?? true,
      deleteBranch: input.deleteBranch ?? false,
    };
    const hostRef = workspace?.sshConnectionId ?? project?.sshConnectionId ?? 'local';
    const draft = this.buildOperationDraft({
      id: operationId,
      kind: 'delete-task',
      status: 'pending',
      projectId: task.projectId,
      taskId: task.id,
      workspaceId: task.workspaceId,
      entityKey: task.id,
      hostRef,
      payload,
      createdAt,
    });

    const insertion = db.transaction((tx) =>
      this.insertOperation(tx, draft, {
        dedupeStatuses: nonTerminalOperationStatuses,
        tombstone: (transaction) =>
          transaction
            .update(tasks)
            .set({ deletedAt: new Date(createdAt).toISOString() })
            .where(and(eq(tasks.id, task.id), isNull(tasks.deletedAt)))
            .run().changes,
      })
    );

    if (insertion.outcome === 'precondition-failed') return err(insertion.error);
    if (insertion.outcome === 'duplicate') {
      return this.existingOperationResult('task', input.taskId);
    }
    await this.refreshDeletionStates();
    this.poke();
    return ok({ operationId });
  }

  async enqueueDeleteWorkspace(workspaceId: string): Promise<OperationMutationResult> {
    const [workspace] = await db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)))
      .limit(1);
    if (!workspace) {
      const existing = await this.latestOperation('workspace', workspaceId);
      return existing
        ? ok({ operationId: existing.id })
        : err({ type: 'workspace-not-found', message: `Workspace ${workspaceId} was not found` });
    }
    const [task] = await db.select().from(tasks).where(eq(tasks.workspaceId, workspaceId)).limit(1);
    const [project] = task
      ? await db.select().from(projects).where(eq(projects.id, task.projectId)).limit(1)
      : [];
    const operationId = randomUUID();
    const createdAt = this.clock.now();
    const draft = this.buildOperationDraft({
      id: operationId,
      kind: 'delete-workspace',
      status: 'pending',
      projectId: project?.id,
      taskId: task?.id,
      workspaceId,
      entityKey: workspaceId,
      hostRef: workspace.sshConnectionId ?? project?.sshConnectionId ?? 'local',
      payload: {
        version: '1',
        source: 'user',
        entityName: workspace.path ?? undefined,
        deleteWorktree: true,
        deleteBranch: false,
      },
      createdAt,
    });
    const insertion = db.transaction((tx) =>
      this.insertOperation(tx, draft, {
        dedupeStatuses: nonTerminalOperationStatuses,
        precondition: (transaction) =>
          workspaceHasLiveTaskInTransaction(transaction, workspaceId)
            ? workspaceInUseError()
            : undefined,
        tombstone: (transaction) =>
          transaction
            .update(workspaces)
            .set({ deletedAt: new Date(createdAt).toISOString() })
            .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)))
            .run().changes,
      })
    );
    if (insertion.outcome === 'precondition-failed') return err(insertion.error);
    if (insertion.outcome === 'duplicate') {
      return this.existingOperationResult('workspace', workspaceId);
    }
    await this.refreshDeletionStates();
    this.poke();
    return ok({ operationId });
  }

  async enqueueDeleteWorkspacePath(input: {
    projectId: string;
    workspaceId?: string;
    workspacePath: string;
    branchName?: string;
  }): Promise<OperationMutationResult> {
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);
    if (!project) {
      return err({
        type: 'project-not-found',
        message: `Project ${input.projectId} was not found`,
      });
    }
    const operationId = randomUUID();
    const entityKey = input.workspaceId ?? `workspace-path:${input.workspacePath}`;
    const createdAt = this.clock.now();
    const draft = this.buildOperationDraft({
      id: operationId,
      kind: 'delete-workspace',
      status: 'pending',
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      entityKey,
      hostRef: project.sshConnectionId ?? 'local',
      payload: {
        version: '1',
        source: 'user',
        entityName: input.workspacePath,
        workspacePath: input.workspacePath,
        branchName: input.branchName ?? UNKNOWN_BRANCH_SENTINEL,
        hostLabel: project.name,
        deleteWorktree: true,
        deleteBranch: false,
      },
      createdAt,
    });
    const insertion = db.transaction((tx) =>
      this.insertOperation(tx, draft, {
        dedupeStatuses: nonTerminalOperationStatuses,
        precondition: input.workspaceId
          ? (transaction) =>
              workspaceHasLiveTaskInTransaction(transaction, input.workspaceId!)
                ? workspaceInUseError()
                : undefined
          : undefined,
        tombstone: input.workspaceId
          ? (transaction) =>
              transaction
                .update(workspaces)
                .set({ deletedAt: new Date(createdAt).toISOString() })
                .where(and(eq(workspaces.id, input.workspaceId!), isNull(workspaces.deletedAt)))
                .run().changes
          : undefined,
      })
    );
    if (insertion.outcome === 'precondition-failed') return err(insertion.error);
    if (insertion.outcome === 'duplicate') {
      return this.existingOperationResult('workspace', entityKey);
    }
    await this.refreshDeletionStates();
    this.poke();
    return ok({ operationId });
  }

  async enqueueArchiveWorkspace(input: ArchiveWorkspaceInput): Promise<OperationMutationResult> {
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, input.projectId), isNull(projects.deletedAt)))
      .limit(1);
    if (!project) {
      return err({
        type: 'project-not-found',
        message: `Project ${input.projectId} was not found`,
      });
    }

    const [workspace] = input.workspaceId
      ? await db
          .select()
          .from(workspaces)
          .where(and(eq(workspaces.id, input.workspaceId), isNull(workspaces.deletedAt)))
          .limit(1)
      : [];
    if (input.workspaceId && !workspace) {
      return err({
        type: 'workspace-not-found',
        message: `Workspace ${input.workspaceId} was not found`,
      });
    }

    const entityKey = input.workspaceId ?? `workspace-path:${input.workspacePath}`;
    const draft = this.buildOperationDraft({
      kind: 'archive-workspace',
      status: 'pending',
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      entityKey,
      hostRef: workspace?.sshConnectionId ?? project.sshConnectionId ?? 'local',
      payload: {
        version: '1',
        source: 'user',
        entityName: input.workspacePath,
        workspacePath: input.workspacePath,
        branchName: input.branchName,
        hostLabel: project.name,
      },
    });
    const insertion = db.transaction((tx) =>
      this.insertOperation(tx, draft, { dedupeStatuses: nonTerminalOperationStatuses })
    );
    if (insertion.outcome === 'precondition-failed') return err(insertion.error);
    if (insertion.outcome === 'duplicate') {
      return this.existingOperationResult('workspace', entityKey);
    }

    await this.refreshDeletionStates();
    this.poke();
    return ok({ operationId: draft.id });
  }

  async proposeReconcilerTaskCleanup(taskId: string): Promise<void> {
    if (await this.latestOperation('task', taskId)) return;
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!task) return;
    const [workspace] = task.workspaceId
      ? await db.select().from(workspaces).where(eq(workspaces.id, task.workspaceId)).limit(1)
      : [];
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, task.projectId))
      .limit(1);
    const operationId = randomUUID();
    const createdAt = this.clock.now();
    const hostRef = workspace?.sshConnectionId ?? project?.sshConnectionId ?? 'local';
    const payload: OperationPayload = {
      version: '1',
      source: 'reconciler',
      entityName: task.name,
      hostLabel: project?.name,
      deleteWorktree: true,
      deleteBranch: false,
      confirmationReason: 'reconciler-proposed',
    };
    const draft = this.buildOperationDraft({
      id: operationId,
      kind: 'delete-task',
      status: 'awaiting-confirmation',
      projectId: task.projectId,
      taskId: task.id,
      workspaceId: task.workspaceId,
      entityKey: task.id,
      hostRef,
      payload,
      createdAt,
    });
    const insertion = db.transaction((tx) =>
      this.insertOperation(tx, draft, {
        dedupeStatuses: reconcilerDedupeStatuses,
        tombstone: (transaction) => {
          transaction
            .update(tasks)
            .set({ deletedAt: task.deletedAt ?? new Date(createdAt).toISOString() })
            .where(eq(tasks.id, task.id))
            .run();
          return 1;
        },
      })
    );
    if (insertion.outcome !== 'inserted') return;
    await this.refreshDeletionStates();
    publishReconcilerNotification(operationId, payload, hostRef);
  }

  async proposeReconcilerSessionCleanup(input: ReconcilerSessionCleanupInput): Promise<void> {
    if (await this.latestOperation('task', input.entityId)) return;
    const operationId = randomUUID();
    const draft = this.buildOperationDraft({
      id: operationId,
      kind: 'cleanup-sessions',
      status: 'pending',
      projectId: input.projectId,
      entityKey: input.entityId,
      hostRef: input.hostRef ?? 'local',
      payload: {
        version: '1',
        source: 'reconciler',
        entityName: 'Orphaned session',
        workspacePath: input.workspacePath,
        acpConversationIds: input.acpConversationIds,
        tuiConversationIds: input.tuiConversationIds,
        terminalSessionIds: input.terminalSessionIds,
        tmuxSessionNames: input.tmuxSessionNames,
      },
    });
    const insertion = db.transaction((tx) =>
      this.insertOperation(tx, draft, { dedupeStatuses: reconcilerDedupeStatuses })
    );
    if (insertion.outcome !== 'inserted') return;
    await this.refreshDeletionStates();
    this.poke();
  }

  async proposeReconcilerWorkspaceCleanup(input: ReconcilerWorkspaceCleanupInput): Promise<void> {
    const entityId = input.workspaceId ?? `workspace-path:${input.workspacePath}`;
    if (await this.latestOperation('workspace', entityId)) return;
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);
    if (!project) return;
    const operationId = randomUUID();
    const createdAt = this.clock.now();
    const payload: OperationPayload = {
      version: '1',
      source: 'reconciler',
      entityName: input.workspacePath,
      workspacePath: input.workspacePath,
      branchName: input.branchName ?? UNKNOWN_BRANCH_SENTINEL,
      hostLabel: project.name,
      deleteWorktree: true,
      deleteBranch: false,
      confirmationReason: 'reconciler-proposed',
    };
    const draft = this.buildOperationDraft({
      id: operationId,
      kind: 'delete-workspace',
      status: 'awaiting-confirmation',
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      entityKey: entityId,
      hostRef: project.sshConnectionId ?? 'local',
      payload,
      createdAt,
    });
    const insertion = db.transaction((tx) =>
      this.insertOperation(tx, draft, {
        dedupeStatuses: reconcilerDedupeStatuses,
        tombstone: input.workspaceId
          ? (transaction) => {
              transaction
                .update(workspaces)
                .set({ deletedAt: new Date(createdAt).toISOString() })
                .where(eq(workspaces.id, input.workspaceId!))
                .run();
              return 1;
            }
          : undefined,
      })
    );
    if (insertion.outcome !== 'inserted') return;
    await this.refreshDeletionStates();
    publishReconcilerNotification(operationId, payload, project.sshConnectionId ?? 'local');
  }

  async proposeReconcilerProjectCleanup(projectId: string): Promise<void> {
    if (await this.latestOperation('project', projectId)) return;
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project?.deletedAt) return;
    const operationId = randomUUID();
    const payload: OperationPayload = {
      version: '1',
      source: 'reconciler',
      entityName: project.name,
      confirmationReason: 'reconciler-proposed',
    };
    const draft = this.buildOperationDraft({
      id: operationId,
      kind: 'delete-project',
      status: 'awaiting-confirmation',
      projectId,
      entityKey: projectId,
      hostRef: 'local',
      payload,
    });
    const insertion = db.transaction((tx) =>
      this.insertOperation(tx, draft, { dedupeStatuses: reconcilerDedupeStatuses })
    );
    if (insertion.outcome !== 'inserted') return;
    await this.refreshDeletionStates();
    publishReconcilerNotification(operationId, payload, 'local');
  }

  async enqueueDeleteProject(projectId: string): Promise<OperationMutationResult> {
    const [project] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1);
    if (!project) {
      const existing = await this.latestOperation('project', projectId);
      return existing
        ? ok({ operationId: existing.id })
        : err({ type: 'project-not-found', message: `Project ${projectId} was not found` });
    }
    const taskRows = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt)));
    const workspaceIds = taskRows
      .map((task) => task.workspaceId)
      .filter((id): id is string => !!id);
    const workspaceRows =
      workspaceIds.length > 0
        ? await db.select().from(workspaces).where(inArray(workspaces.id, workspaceIds))
        : [];
    const workspaceById = new Map(workspaceRows.map((row) => [row.id, row]));
    const createdAt = this.clock.now();
    const taskInputs = taskRows.map((task) => ({
      task,
      draft: this.buildOperationDraft({
        kind: 'delete-task',
        status: 'pending',
        projectId,
        taskId: task.id,
        workspaceId: task.workspaceId,
        entityKey: task.id,
        hostRef:
          (task.workspaceId ? workspaceById.get(task.workspaceId)?.sshConnectionId : undefined) ??
          project.sshConnectionId ??
          'local',
        payload: {
          version: '1',
          source: 'user',
          entityName: task.name,
          hostLabel: project.name,
          deleteWorktree: true,
          deleteBranch: false,
        },
        createdAt,
      }),
    }));
    const projectOperationId = randomUUID();
    const projectDraft = this.buildOperationDraft({
      id: projectOperationId,
      kind: 'delete-project',
      status: 'pending',
      projectId,
      entityKey: projectId,
      hostRef: 'local',
      payload: {
        version: '1',
        source: 'user',
        entityName: project.name,
      },
      createdAt,
    });
    const insertion = db.transaction((tx) => {
      const projectInsertion = this.insertOperation(tx, projectDraft, {
        tombstone: (transaction) =>
          transaction
            .update(projects)
            .set({ deletedAt: new Date(createdAt).toISOString() })
            .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
            .run().changes,
      });
      if (projectInsertion.outcome !== 'inserted') return projectInsertion;
      for (const input of taskInputs) {
        const { task, draft } = input;
        this.insertOperation(tx, draft, {
          tombstone: (transaction) =>
            transaction
              .update(tasks)
              .set({ deletedAt: new Date(createdAt).toISOString() })
              .where(and(eq(tasks.id, task.id), isNull(tasks.deletedAt)))
              .run().changes,
        });
      }
      return projectInsertion;
    });
    if (insertion.outcome === 'precondition-failed') return err(insertion.error);
    if (insertion.outcome === 'duplicate') {
      return this.existingOperationResult('project', projectId);
    }
    await this.refreshDeletionStates();
    this.poke();
    return ok({ operationId: projectOperationId });
  }

  async retryDelete(kind: DeletionEntityKind, entityId: string): Promise<OperationMutationResult> {
    const operation = await this.latestOperation(kind, entityId);
    if (!operation) {
      return err({ type: 'operation-not-found', message: 'No pending cleanup was found' });
    }
    const operations =
      kind === 'project'
        ? await db
            .select()
            .from(lifecycleOperations)
            .where(
              and(
                eq(lifecycleOperations.projectId, entityId),
                inArray(lifecycleOperations.status, [...nonTerminalOperationStatuses])
              )
            )
        : [operation];
    const confirmedAt = this.clock.now();
    db.transaction((tx) => {
      for (const item of operations) {
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
      }
    });
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
    const purgeDatabaseRows = async (): Promise<void> => {
      db.transaction((tx) => {
        const operationWhere =
          kind === 'project'
            ? and(
                eq(lifecycleOperations.projectId, entityId),
                inArray(lifecycleOperations.status, [...nonTerminalOperationStatuses])
              )
            : eq(lifecycleOperations.id, operation.id);
        tx.update(lifecycleOperations)
          .set({ status: 'abandoned', finishedAt: this.clock.now(), error: null })
          .where(operationWhere)
          .run();
        if (kind === 'task' && operation.kind === 'delete-task') {
          tx.delete(tasks).where(eq(tasks.id, entityId)).run();
        }
        if (kind === 'workspace' && operation.kind === 'delete-workspace') {
          tx.delete(workspaces).where(eq(workspaces.id, entityId)).run();
        }
        if (kind === 'project') {
          const workspaceRows = tx
            .select({ id: tasks.workspaceId })
            .from(tasks)
            .where(eq(tasks.projectId, entityId))
            .all();
          tx.delete(tasks).where(eq(tasks.projectId, entityId)).run();
          const workspaceIds = workspaceRows
            .map((row) => row.id)
            .filter((id): id is string => id !== null);
          if (workspaceIds.length > 0) {
            tx.delete(workspaces)
              .where(
                and(
                  inArray(workspaces.id, workspaceIds),
                  or(ne(workspaces.kind, 'project-root'), isNull(workspaces.kind))
                )
              )
              .run();
          }
          tx.delete(projects).where(eq(projects.id, entityId)).run();
        }
      });
    };

    if (kind === 'project') {
      await purgeProjectLocalState(entityId, purgeDatabaseRows);
    } else {
      await purgeDatabaseRows();
    }
    if (kind === 'task' && operation.kind === 'delete-task') {
      await purgeTaskLocalState({
        projectId: operation.projectId,
        taskId: entityId,
      });
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
    if (!this.initialized || this.scope.disposed) return;
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
      .catch((error) => log.error('lifecycle operations drain failed', error))
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
    await this.initialize();

    const operations = await db
      .select()
      .from(lifecycleOperations)
      .where(
        and(
          eq(lifecycleOperations.projectId, input.projectId),
          inArray(lifecycleOperations.status, [...nonTerminalOperationStatuses])
        )
      );
    for (const operation of operations) {
      if (operation.kind === 'delete-project') return false;
      if (input.workspaceId !== undefined && operation.workspaceId === input.workspaceId) {
        return false;
      }
      if (input.branchName !== undefined) {
        const context = await resolveOperationContext(operation);
        if (context.branchName === input.branchName) return false;
      }
    }
    return true;
  }

  async dispose(): Promise<void> {
    await this.scope.dispose(new Error('Application shutdown'));
    await db
      .update(lifecycleOperations)
      .set({ status: 'pending' })
      .where(eq(lifecycleOperations.status, 'running'));
  }

  private async drain(signal: AbortSignal): Promise<void> {
    let madeProgress = true;
    while (madeProgress && !signal.aborted) {
      madeProgress = false;
      const operations = await db
        .select()
        .from(lifecycleOperations)
        .where(inArray(lifecycleOperations.status, ['pending', 'running']))
        .orderBy(lifecycleOperations.createdAt);
      for (const operation of operations) {
        if (signal.aborted) return;
        if (operation.kind === 'delete-project' && (await this.hasPendingChildren(operation))) {
          continue;
        }
        if (!this.hostIsOnline(operation.hostRef)) continue;
        const plan = await compileOperationPlan(operation);
        if (plan.preconditionFailure) {
          await db
            .update(lifecycleOperations)
            .set({
              status: 'failed',
              error: `${plan.preconditionFailure.type}: ${plan.preconditionFailure.message}`,
            })
            .where(eq(lifecycleOperations.id, operation.id));
          await this.refreshDeletionStates();
          madeProgress = true;
          continue;
        }
        if (this.isStale(operation) && plan.steps.some((step) => step.destructive)) {
          await this.awaitConfirmation(operation, 'stale');
          madeProgress = true;
          continue;
        }
        if (
          this.isResumed(operation) &&
          !operation.payload.confirmedAt &&
          plan.steps.some(
            (step) => step.kind === 'teardown-workspace' || step.kind === 'clean-artifacts'
          ) &&
          (await this.workspaceIsDirty(operation))
        ) {
          await this.awaitConfirmation(operation, 'workspace-modified');
          madeProgress = true;
          continue;
        }
        await this.run(operation, plan, signal);
        madeProgress = true;
      }
    }
    await this.refreshDeletionStates();
  }

  private async run(
    operation: LifecycleOperationRow,
    plan: ExecutableOperationPlan,
    signal: AbortSignal
  ): Promise<void> {
    await db
      .update(lifecycleOperations)
      .set({
        status: 'running',
        attempt: operation.attempt + 1,
        error: null,
      })
      .where(eq(lifecycleOperations.id, operation.id));
    await this.refreshDeletionStates();
    const current = {
      ...operation,
      status: 'running' as const,
      attempt: operation.attempt + 1,
    };
    const result = await runOperationPlan(current, plan, {
      signal,
      clock: this.clock,
      onProgress: (progress) => {
        this.progress.set(operation.id, progress);
        void this.refreshDeletionStates();
      },
    });
    this.progress.delete(operation.id);
    if (result.success) {
      await db
        .update(lifecycleOperations)
        .set({ status: 'succeeded', finishedAt: this.clock.now(), error: null })
        .where(eq(lifecycleOperations.id, operation.id));
    } else if (!signal.aborted) {
      await db
        .update(lifecycleOperations)
        .set({ status: 'failed', error: result.error.message })
        .where(eq(lifecycleOperations.id, operation.id));
    }
    await this.refreshDeletionStates();
  }

  private async awaitConfirmation(
    operation: LifecycleOperationRow,
    reason: 'stale' | 'workspace-modified' | 'reconciler-proposed'
  ): Promise<void> {
    await db
      .update(lifecycleOperations)
      .set({
        status: 'awaiting-confirmation',
        payload: {
          ...operation.payload,
          confirmationReason: reason,
        },
      })
      .where(eq(lifecycleOperations.id, operation.id));
    publishPendingCleanupNotification(operation.id, operation.payload, operation.hostRef, reason);
    await this.refreshDeletionStates();
  }

  private hostIsOnline(hostRef: string): boolean {
    return hostRef === 'local' || sshConnectionManager.isConnected(hostRef);
  }

  private isStale(operation: LifecycleOperationRow): boolean {
    return (
      this.clock.now() - (operation.payload.confirmedAt ?? operation.createdAt) > STALE_AFTER_MS
    );
  }

  private isResumed(operation: LifecycleOperationRow): boolean {
    return operation.attempt > 0 || this.clock.now() - operation.createdAt > RESUME_AGE_MS;
  }

  private async workspaceIsDirty(operation: LifecycleOperationRow): Promise<boolean> {
    const context = await resolveOperationContext(operation);
    if (!operation.projectId || !context.workspacePath) return false;
    const project = projectManager.getProject(operation.projectId);
    if (!project) return false;
    try {
      const status = (
        await project.git.checkout.model
          .state(checkoutSelector(context.workspacePath), 'status')
          .snapshot()
      ).data;
      const hasWorkingChanges =
        status.kind === 'too-many-files' ||
        (status.kind === 'ok' &&
          (status.summary.staged > 0 ||
            status.summary.unstaged > 0 ||
            status.summary.untracked > 0));
      if (hasWorkingChanges) return true;

      const latestCommit = await project.git.checkout.getLog({
        ...checkoutSelector(context.workspacePath),
        options: { limit: 1 },
      });
      if (!latestCommit.success) return true;
      const commitDate = latestCommit.data.commits[0]?.date;
      return commitDate !== undefined && Date.parse(commitDate) > operation.createdAt;
    } catch {
      return true;
    }
  }

  private async hasPendingChildren(operation: LifecycleOperationRow): Promise<boolean> {
    if (!operation.projectId) return false;
    const [child] = await db
      .select({ id: lifecycleOperations.id })
      .from(lifecycleOperations)
      .where(
        and(
          eq(lifecycleOperations.projectId, operation.projectId),
          ne(lifecycleOperations.id, operation.id),
          inArray(lifecycleOperations.status, [...nonTerminalOperationStatuses])
        )
      )
      .limit(1);
    return !!child;
  }

  private buildOperationDraft(input: OperationDraftInput): OperationDraft {
    return {
      id: input.id ?? randomUUID(),
      kind: input.kind,
      status: input.status,
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
    options: InsertOperationOptions = {}
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
    statuses: readonly LifecycleOperationRow['status'][]
  ): boolean {
    const existing = tx
      .select({ id: lifecycleOperations.id })
      .from(lifecycleOperations)
      .where(
        and(
          eq(lifecycleOperations.entityKey, entityKey),
          inArray(lifecycleOperations.status, [...statuses])
        )
      )
      .limit(1)
      .get();
    return existing !== undefined;
  }

  private async existingOperationResult(
    kind: DeletionEntityKind,
    entityId: string
  ): Promise<OperationMutationResult> {
    const existing = await this.latestOperation(kind, entityId);
    return existing
      ? ok({ operationId: existing.id })
      : err({ type: `${kind}-not-found`, message: `${kind} ${entityId} was not found` });
  }

  private async latestOperation(
    kind: DeletionEntityKind,
    entityId: string
  ): Promise<LifecycleOperationRow | undefined> {
    const [operation] = await db
      .select()
      .from(lifecycleOperations)
      .where(
        and(
          eq(lifecycleOperations.entityKey, entityId),
          inArray(lifecycleOperations.kind, operationKindsForEntity(kind)),
          inArray(lifecycleOperations.status, [...nonTerminalOperationStatuses])
        )
      )
      .orderBy(desc(lifecycleOperations.createdAt))
      .limit(1);
    return operation;
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
    const rows = await db
      .select()
      .from(lifecycleOperations)
      .where(
        and(
          inArray(lifecycleOperations.kind, operationKindsForEntity(kind)),
          inArray(lifecycleOperations.status, [...nonTerminalOperationStatuses]),
          entityId === undefined ? undefined : eq(lifecycleOperations.entityKey, entityId)
        )
      );
    const list: DeletionList = {};
    for (const row of rows) {
      const context = await resolveOperationContext(row);
      const entry = toDeletionState(
        row,
        this.hostIsOnline(row.hostRef),
        context,
        this.progress.get(row.id)
      );
      if (!entry || entry.entityKind !== kind) continue;
      list[entry.entityId] = entry;
    }
    return list;
  }
}

function toDeletionState(
  operation: LifecycleOperationRow,
  hostOnline: boolean,
  context: OperationContext,
  progress?: OperationProgress
): DeletionState | undefined {
  const entity = entityFor(operation);
  if (!entity) return undefined;
  const base = {
    operationId: operation.id,
    operationKind: operation.kind,
    entityId: entity.id,
    entityKind: entity.kind,
    projectId: operation.projectId ?? undefined,
    entityName:
      operation.payload.entityName ??
      context.task?.name ??
      context.project?.name ??
      context.workspacePath,
    hostRef: operation.hostRef,
    hostLabel: operation.payload.hostLabel,
    workspacePath: context.workspacePath,
    branchName: context.branchName,
    createdAt: operation.createdAt,
    attempt: operation.attempt,
    currentStep: progress?.currentStep,
    completedSteps: progress?.completedSteps,
    totalSteps: progress?.totalSteps,
  };
  switch (operation.status) {
    case 'pending':
      if (!hostOnline) return { ...base, status: 'blocked-host-offline' };
      return { ...base, status: 'cleaning' };
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

function entityFor(
  operation: LifecycleOperationRow
): { kind: DeletionEntityKind; id: string } | undefined {
  if (!operation.entityKey) return undefined;
  if (operation.kind === 'delete-task' || operation.kind === 'cleanup-sessions') {
    return { kind: 'task', id: operation.entityKey };
  }
  if (operation.kind === 'delete-workspace' || operation.kind === 'archive-workspace') {
    return { kind: 'workspace', id: operation.entityKey };
  }
  if (operation.kind === 'delete-project') {
    return { kind: 'project', id: operation.entityKey };
  }
  return undefined;
}

function operationKindsForEntity(kind: DeletionEntityKind): Array<LifecycleOperationRow['kind']> {
  if (kind === 'task') return ['delete-task', 'cleanup-sessions'];
  if (kind === 'workspace') return ['delete-workspace', 'archive-workspace'];
  return ['delete-project'];
}

function deletionStateKey(key: DeletionStateKey): string {
  return `${key.kind}:${key.entityId ?? '*'}`;
}

function workspaceHasLiveTaskInTransaction(tx: DrizzleTx, workspaceId: string): boolean {
  return (
    tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.workspaceId, workspaceId), isNull(tasks.deletedAt)))
      .limit(1)
      .get() !== undefined
  );
}

function publishReconcilerNotification(
  operationId: string,
  payload: OperationPayload,
  hostRef: string
): void {
  publishPendingCleanupNotification(operationId, payload, hostRef, 'reconciler-proposed');
}

function publishPendingCleanupNotification(
  operationId: string,
  payload: OperationPayload,
  hostRef: string,
  reason: 'stale' | 'workspace-modified' | 'reconciler-proposed'
): void {
  notificationService.publish({
    kind: 'pending-cleanup',
    groupKey: `pending-cleanup:${hostRef}`,
    dedupeKey: `pending-cleanup:${operationId}:${reason}`,
    title: 'Pending cleanup needs review',
    body: `${payload.entityName ?? 'A workspace'} is waiting for cleanup review.`,
    sound: 'needs_attention',
    target: { kind: 'none' },
    source: { kind: 'app' },
  });
}

export const operationsService = new OperationsService();
