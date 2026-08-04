import { randomUUID } from 'node:crypto';
import {
  formatHostRef,
  hostRef,
  LOCAL_HOST_REF,
  type SerializedHostRef,
} from '@emdash/core/primitives/host/api';
import type { InputOf } from '@emdash/core/primitives/kernel/api';
import { err, ok, type Result } from '@emdash/shared';
import { and, eq, isNull } from 'drizzle-orm';
import {
  hostRemoveWorktreeOperation,
  type HostRemoveWorktreeInput,
} from '@core/features/workspaces/api/node/host-outbox-operations';
import {
  createWorkspaceRegistry,
  workspaceRegistryTable as workspaces,
} from '@core/features/workspaces/api/node/registry';
import type { AppDb, DrizzleTx } from '@core/services/app-db/node/db';
import { appDbPokes } from '@core/services/app-db/node/pokes';
import { projects, tasks, type WorkspaceRow } from '@core/services/app-db/node/schema';
import type { OperationSubmitOptions } from '@core/services/operations/node';
import { compileRemoveWorktreePrediction } from './compile-host-outbox-prediction';

/**
 * Workspace removal enqueues: the desktop op is "untrack the registry row"
 * (immediate, offline-safe), the host work is a `removeWorktree` outbox entry.
 * Archive differs from delete only in the desktop annotation — host-side both
 * are `removeWorktree{deleteBranch: false}`.
 */

export type ArchiveWorkspaceInput = {
  projectId: string;
  workspaceId?: string;
  workspacePath: string;
  branchName?: string;
};

type OperationsEngineLike = {
  db: AppDb;
  submitWithTombstone(
    definition: typeof hostRemoveWorktreeOperation,
    input: InputOf<typeof hostRemoveWorktreeOperation>,
    options?: OperationSubmitOptions
  ): Promise<Result<{ operationId?: string }, { type: string; message: string }>>;
};

export async function enqueueDeleteWorkspace(
  operations: OperationsEngineLike,
  workspaceId: string,
  options: { deleteBranch?: boolean } = {}
) {
  const workspace = createWorkspaceRegistry(operations.db).getLive(workspaceId);
  if (!workspace) {
    return err({ type: 'workspace-not-found', message: `Workspace ${workspaceId} was not found` });
  }
  if (workspace.kind === 'repository' || workspace.kind === 'project-root') {
    return err({ type: 'root-refused', message: 'Repository root cannot be deleted.' });
  }
  const [task] = await operations.db
    .select()
    .from(tasks)
    .where(eq(tasks.workspaceId, workspaceId))
    .limit(1);
  const [project] = task
    ? await operations.db.select().from(projects).where(eq(projects.id, task.projectId)).limit(1)
    : [];
  return enqueueWorkspaceRemoval(operations, {
    workspace,
    workspacePath: workspace.path ?? undefined,
    branchName: workspace.branchName ?? undefined,
    projectId: project?.id,
    projectName: project?.name,
    repoPath: project?.path ?? (await parentRepoPath(operations.db, workspace)),
    hostRef: serializedOperationHostRef(workspace.sshConnectionId ?? project?.sshConnectionId),
    requireUnused: true,
    deleteBranch: options.deleteBranch ?? false,
  });
}

export async function enqueueDeleteWorkspacePath(
  operations: OperationsEngineLike,
  input: ArchiveWorkspaceInput
) {
  return enqueueWorkspacePathRemoval(operations, input, { requireUnused: true });
}

export async function enqueueArchiveWorkspace(
  operations: OperationsEngineLike,
  input: ArchiveWorkspaceInput
) {
  return enqueueWorkspacePathRemoval(operations, input, { requireUnused: false });
}

async function enqueueWorkspacePathRemoval(
  operations: OperationsEngineLike,
  input: ArchiveWorkspaceInput,
  options: { requireUnused: boolean }
) {
  const [project] = await operations.db
    .select()
    .from(projects)
    .where(and(eq(projects.id, input.projectId), isNull(projects.deletedAt)))
    .limit(1);
  if (!project) {
    return err({ type: 'project-not-found', message: `Project ${input.projectId} was not found` });
  }
  const workspace = input.workspaceId
    ? createWorkspaceRegistry(operations.db).getLive(input.workspaceId)
    : undefined;
  if (input.workspaceId && !workspace) {
    return err({
      type: 'workspace-not-found',
      message: `Workspace ${input.workspaceId} was not found`,
    });
  }
  return enqueueWorkspaceRemoval(operations, {
    workspace,
    workspacePath: input.workspacePath,
    branchName: input.branchName,
    projectId: project.id,
    projectName: project.name,
    repoPath: project.path,
    hostRef: serializedOperationHostRef(workspace?.sshConnectionId ?? project.sshConnectionId),
    requireUnused: options.requireUnused && input.workspaceId !== undefined,
  });
}

async function enqueueWorkspaceRemoval(
  operations: OperationsEngineLike,
  params: {
    workspace: WorkspaceRow | undefined;
    workspacePath: string | undefined;
    branchName: string | undefined;
    projectId: string | undefined;
    projectName: string | undefined;
    repoPath: string | undefined;
    hostRef: SerializedHostRef;
    requireUnused: boolean;
    deleteBranch?: boolean;
  }
) {
  const createdAt = Date.now();
  const registry = createWorkspaceRegistry(operations.db, {
    now: () => new Date(createdAt).toISOString(),
  });
  const workspaceId = params.workspace?.id;
  // Only git worktrees map onto the `removeWorktree` verb; byoi/directory rows
  // (and rows without a row at all when path-addressed) are untracked only.
  const hostRemovable = !params.workspace || params.workspace.kind === 'worktree';

  // Nothing to remove on the host: untrack the row inline.
  if (!params.workspacePath || !params.repoPath || !hostRemovable) {
    if (!workspaceId) {
      return err({ type: 'workspace-not-found', message: 'Workspace has no path to remove.' });
    }
    const untracked = untrackWorkspaceInline(operations.db, {
      workspaceId,
      requireUnused: params.requireUnused,
      createdAt,
    });
    if (!untracked.success) return untracked;
    appDbPokes.workspaces.poke({ projectId: params.projectId });
    return ok({});
  }

  const input: HostRemoveWorktreeInput = {
    version: '1',
    source: 'user',
    hostOperationId: randomUUID(),
    hostRef: params.hostRef,
    repoPath: params.repoPath,
    projectId: params.projectId,
    workspaceId,
    entityName: params.workspacePath,
    hostLabel: params.projectName,
    workspacePath: params.workspacePath,
    branchName: params.branchName,
    deleteBranch: params.deleteBranch ?? false,
    deactivateConsumers: 'all',
    prediction: compileRemoveWorktreePrediction({
      now: createdAt,
      workspacePath: params.workspacePath,
      branchName: params.branchName,
      deleteBranch: params.deleteBranch ?? false,
      observed: params.workspace,
    }),
    createdAt,
  };
  const result = await operations.submitWithTombstone(hostRemoveWorktreeOperation, input, {
    precondition: (tx) =>
      workspacePrecondition(tx, {
        projectId: params.projectId,
        workspaceId,
        requireUnused: params.requireUnused,
      }),
    tombstone: workspaceId
      ? (tx) => registry.untrack([workspaceId], new Date(createdAt).toISOString(), undefined, tx)
      : undefined,
    revertTombstone: workspaceId
      ? (tx) => void registry.revertUntrack([workspaceId], tx)
      : undefined,
  });
  if (result.success) appDbPokes.workspaces.poke({ projectId: params.projectId });
  return result;
}

function untrackWorkspaceInline(
  db: AppDb,
  input: { workspaceId: string; requireUnused: boolean; createdAt: number }
): Result<Record<string, never>, { type: string; message: string }> {
  const registry = createWorkspaceRegistry(db, {
    now: () => new Date(input.createdAt).toISOString(),
  });
  let failure: { type: string; message: string } | undefined;
  db.transaction((tx) => {
    failure = workspacePrecondition(tx, {
      workspaceId: input.workspaceId,
      requireUnused: input.requireUnused,
    });
    if (failure) return;
    registry.untrack([input.workspaceId], new Date(input.createdAt).toISOString(), undefined, tx);
  });
  return failure ? err(failure) : ok({});
}

async function parentRepoPath(db: AppDb, workspace: WorkspaceRow): Promise<string | undefined> {
  if (!workspace.parentId) return undefined;
  const [parent] = await db
    .select({ path: workspaces.path })
    .from(workspaces)
    .where(eq(workspaces.id, workspace.parentId))
    .limit(1);
  return parent?.path ?? undefined;
}

function workspacePrecondition(
  tx: DrizzleTx,
  input: { projectId?: string; workspaceId?: string; requireUnused: boolean }
) {
  if (input.projectId && projectIsDeletedInTransaction(tx, input.projectId)) {
    return { type: 'project-deleting', message: 'Project is being deleted.' };
  }
  if (
    input.requireUnused &&
    input.workspaceId &&
    workspaceHasLiveTaskInTransaction(tx, input.workspaceId)
  ) {
    return {
      type: 'workspace-in-use',
      message: 'Workspace is still referenced by an active task.',
    };
  }
  return undefined;
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

function projectIsDeletedInTransaction(tx: DrizzleTx, projectId: string): boolean {
  return (
    tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .limit(1)
      .get() === undefined
  );
}

function serializedOperationHostRef(connectionId: string | null | undefined): SerializedHostRef {
  return formatHostRef(connectionId ? hostRef('remote', connectionId) : LOCAL_HOST_REF);
}
