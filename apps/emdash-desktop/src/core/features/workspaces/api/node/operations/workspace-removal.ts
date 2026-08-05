import { randomUUID } from 'node:crypto';
import {
  formatHostRef,
  hostRefFromParts,
  type SerializedHostRef,
} from '@emdash/core/primitives/host/api';
import { err, ok, type Result } from '@emdash/shared';
import { and, eq, isNull } from 'drizzle-orm';
import {
  hostDeleteConversationOperation,
  type HostDeleteConversationInput,
} from '@core/features/conversations/api/node/host-delete-conversation-operation';
import { compileConversationDeletionInput } from '@core/features/conversations/api/node/operations/conversation-removal';
import {
  createConversationRegistry,
  conversationRegistryTable as conversationRows,
  liveConversations,
} from '@core/features/conversations/api/node/registry';
import {
  hostRemoveWorktreeOperation,
  type HostRemoveWorktreeInput,
} from '@core/features/workspaces/api/node/host-outbox-operations';
import { operationHostRef } from '@core/features/workspaces/api/node/operation-host-ref';
import {
  createWorkspaceRegistry,
  workspaceRegistryTable as workspaces,
} from '@core/features/workspaces/api/node/registry';
import { getProvisionedWorkspaceBranch } from '@core/features/workspaces/api/node/workspace-branch';
import type { AppDb, DrizzleTx } from '@core/services/app-db/node/db';
import { appDbPokes } from '@core/services/app-db/node/pokes';
import { projects, tasks, type WorkspaceRow } from '@core/services/app-db/node/schema';
import { enqueueTombstoned, type OperationSubmitter } from '@core/services/operations/api/node';
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

export async function enqueueDeleteWorkspace(
  operations: OperationSubmitter,
  workspaceId: string,
  options: { deleteBranch?: boolean; deleteConversations?: boolean } = {}
) {
  const workspace = createWorkspaceRegistry(operations.db).getLive(workspaceId);
  if (!workspace) {
    return err({ type: 'workspace-not-found', message: `Workspace ${workspaceId} was not found` });
  }
  if (workspace.kind === 'repository') {
    return err({ type: 'root-refused', message: 'Repository root cannot be deleted.' });
  }
  const [task] = await operations.db
    .select()
    .from(tasks)
    .where(eq(tasks.workspaceId, workspaceId))
    .limit(1);
  const [project] = task ? await getProjectRemovalRow(operations.db, task.projectId) : [];
  return enqueueWorkspaceRemoval(operations, {
    workspace,
    workspacePath: workspace.path ?? undefined,
    branchName: getProvisionedWorkspaceBranch(workspace) ?? undefined,
    projectId: project?.id,
    projectName: project?.name,
    repoPath: project?.repositoryPath ?? (await parentRepoPath(operations.db, workspace)),
    hostRef: formatHostRef(
      operationHostRef({
        workspace,
        repository: project && {
          location: project.repositoryLocation,
          sshConnectionId: project.repositorySshConnectionId,
        },
      })
    ),
    requireUnused: true,
    deleteBranch: options.deleteBranch ?? false,
    deleteConversations: options.deleteConversations ?? false,
  });
}

export async function enqueueDeleteWorkspacePath(
  operations: OperationSubmitter,
  input: ArchiveWorkspaceInput,
  options: { deleteConversations?: boolean } = {}
) {
  return enqueueWorkspacePathRemoval(operations, input, {
    requireUnused: true,
    deleteConversations: options.deleteConversations ?? false,
  });
}

export async function enqueueArchiveWorkspace(
  operations: OperationSubmitter,
  input: ArchiveWorkspaceInput
) {
  return enqueueWorkspacePathRemoval(operations, input, { requireUnused: false });
}

async function enqueueWorkspacePathRemoval(
  operations: OperationSubmitter,
  input: ArchiveWorkspaceInput,
  options: { requireUnused: boolean; deleteConversations?: boolean }
) {
  const [project] = await getProjectRemovalRow(operations.db, input.projectId, {
    liveOnly: true,
  });
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
    repoPath: project.repositoryPath ?? undefined,
    hostRef: formatHostRef(
      operationHostRef({
        workspace,
        repository: {
          location: project.repositoryLocation,
          sshConnectionId: project.repositorySshConnectionId,
        },
      })
    ),
    requireUnused: options.requireUnused && input.workspaceId !== undefined,
    deleteConversations: options.deleteConversations ?? false,
  });
}

async function enqueueWorkspaceRemoval(
  operations: OperationSubmitter,
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
    deleteConversations?: boolean;
  }
) {
  const createdAt = Date.now();
  const registry = createWorkspaceRegistry(operations.db, {
    now: () => new Date(createdAt).toISOString(),
  });
  const workspaceId = params.workspace?.id;
  // Only git worktrees map onto the `removeWorktree` verb; directory rows
  // (and rows without a row at all when path-addressed) are untracked only.
  const hostRemovable = !params.workspace || params.workspace.kind === 'worktree';
  // Opt-in only (spec §7.1): removal defaults to archive semantics — records survive with
  // dangling paths and stay resumable if the path is recreated. The `removeWorktree` verb
  // itself never touches conversation records; the coupling is these explicit per-record
  // requests, snapshot-compiled at enqueue time.
  const conversationDeletions = params.deleteConversations
    ? snapshotWorkspaceConversationDeletions(operations.db, {
        workspacePath: params.workspacePath,
        hostRef: params.hostRef,
        createdAt,
      })
    : [];
  const conversationIds = conversationDeletions.map((deletion) => deletion.conversationId);
  const conversationRegistry = createConversationRegistry(operations.db);

  // Nothing to remove on the host: untrack the row inline.
  if (!params.workspacePath || !params.repoPath || !hostRemovable) {
    if (!workspaceId) {
      return err({ type: 'workspace-not-found', message: 'Workspace has no path to remove.' });
    }
    const untracked = untrackWorkspaceInline(operations.db, {
      workspaceId,
      requireUnused: params.requireUnused,
      createdAt,
      conversationIds,
    });
    if (!untracked.success) return untracked;
    await submitConversationDeletions(operations, params.projectId, conversationDeletions);
    appDbPokes.workspaces.poke({ projectId: params.projectId });
    return ok({});
  }

  const result = await enqueueTombstoned(operations, {
    definition: hostRemoveWorktreeOperation,
    load: () => params,
    notFound: () => ({ type: 'workspace-not-found', message: 'Workspace was not found.' }),
    buildInput: (): HostRemoveWorktreeInput => ({
      version: '1',
      source: 'user',
      hostOperationId: randomUUID(),
      hostRef: params.hostRef,
      repoPath: params.repoPath!,
      projectId: params.projectId,
      workspaceId,
      entityName: params.workspacePath,
      hostLabel: params.projectName,
      workspacePath: params.workspacePath!,
      branchName: params.branchName,
      deleteBranch: params.deleteBranch ?? false,
      deactivateConsumers: 'all',
      prediction: compileRemoveWorktreePrediction({
        now: createdAt,
        workspacePath: params.workspacePath!,
        branchName: params.branchName,
        deleteBranch: params.deleteBranch ?? false,
        observed: params.workspace,
      }),
      createdAt,
    }),
    precondition: (tx) =>
      workspacePrecondition(tx, {
        projectId: params.projectId,
        workspaceId,
        requireUnused: params.requireUnused,
      }),
    tombstone: (tx) => {
      const changes = workspaceId
        ? registry.untrack([workspaceId], new Date(createdAt).toISOString(), undefined, tx)
        : 1;
      if (changes > 0) {
        conversationRegistry.untrack(conversationIds, new Date(createdAt).toISOString(), tx);
      }
      return changes;
    },
    revert: (tx) => {
      if (workspaceId) registry.revertUntrack([workspaceId], tx);
      conversationRegistry.revertUntrack(conversationIds, tx);
    },
    poke: () => appDbPokes.workspaces.poke({ projectId: params.projectId }),
  });
  if (result.success) {
    await submitConversationDeletions(operations, params.projectId, conversationDeletions);
  }
  return result;
}

/**
 * Snapshot-compiles per-record delete requests for the workspace's cached conversation
 * records: same observed path, same host. Compiled before any tombstone so identity rides
 * the operation inputs.
 */
function snapshotWorkspaceConversationDeletions(
  db: AppDb,
  params: { workspacePath: string | undefined; hostRef: SerializedHostRef; createdAt: number }
): HostDeleteConversationInput[] {
  if (!params.workspacePath) return [];
  const rows = db
    .select()
    .from(conversationRows)
    .where(and(eq(conversationRows.workspacePath, params.workspacePath), liveConversations()))
    .all();
  return rows
    .filter((row) => {
      try {
        return (
          formatHostRef(hostRefFromParts(row.location, row.sshConnectionId)) === params.hostRef
        );
      } catch {
        return false;
      }
    })
    .map((row) => compileConversationDeletionInput(row, params.createdAt));
}

async function submitConversationDeletions(
  operations: OperationSubmitter,
  projectId: string | undefined,
  deletions: readonly HostDeleteConversationInput[]
): Promise<void> {
  for (const deletion of deletions) {
    await operations.submit(hostDeleteConversationOperation, deletion);
  }
  if (deletions.length > 0) {
    appDbPokes.conversations.poke({ projectId });
  }
}

function untrackWorkspaceInline(
  db: AppDb,
  input: {
    workspaceId: string;
    requireUnused: boolean;
    createdAt: number;
    conversationIds?: readonly string[];
  }
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
    if (input.conversationIds?.length) {
      createConversationRegistry(db).untrack(
        input.conversationIds,
        new Date(input.createdAt).toISOString(),
        tx
      );
    }
  });
  return failure ? err(failure) : ok({});
}

/** Project name + repository-workspace host identity, for removal routing. */
function getProjectRemovalRow(db: AppDb, projectId: string, options: { liveOnly?: boolean } = {}) {
  return db
    .select({
      id: projects.id,
      name: projects.name,
      repositoryPath: workspaces.path,
      repositoryLocation: workspaces.location,
      repositorySshConnectionId: workspaces.sshConnectionId,
    })
    .from(projects)
    .leftJoin(workspaces, eq(workspaces.id, projects.repositoryWorkspaceId))
    .where(
      options.liveOnly
        ? and(eq(projects.id, projectId), isNull(projects.deletedAt))
        : eq(projects.id, projectId)
    )
    .limit(1);
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
