import {
  formatHostRef,
  hostRefFromParts,
  type HostRef,
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
import { operationHostRef } from '@core/features/workspaces/api/node/operation-host-ref';
import {
  createWorkspaceRegistry,
  workspaceRegistryTable as workspaces,
} from '@core/features/workspaces/api/node/registry';
import { tombstoneWorkspaceRow } from '@core/features/workspaces/api/node/registry/workspace-tombstones';
import type { AppDb, DrizzleTx } from '@core/services/app-db/node/db';
import { appDbPokes } from '@core/services/app-db/node/pokes';
import { projects, tasks, type WorkspaceRow } from '@core/services/app-db/node/schema';
import type { OperationSubmitter } from '@core/services/operations/api/node';
import { reconcileSweepTriggers } from '@core/services/reconcile-sweep/node/reconcile-sweep-triggers';

/**
 * Workspace removal through the host registry verbs (ADR 0005): one fail-fast
 * `deleteWorktree`/`deleteWorkspace` RPC against a reachable host, then the mirror
 * row is untracked. Against an unreachable host the deletion no longer refuses
 * (ADR 0006): the mirror row is marked with a durable tombstone — frozen options plus
 * the target record UUID — and the caller sees success. Nothing queues anywhere; the
 * tombstoned row stays visible as the pending state and the reconcile sweep executes
 * it once the host is reachable. Archive differs from delete only in the desktop
 * annotation; host-side both remove the worktree with `deleteBranch: false`.
 */

export type WorkspaceRemovalError = { type: string; message: string };
export type WorkspaceRemovalResult = Result<{ operationId?: string }, WorkspaceRemovalError>;

type DeleteVerbError = { type: string; message?: string };

/**
 * Structural slice of the runtime broker: just the two delete verbs this module
 * calls. The production `RuntimeBroker` satisfies it; tests fake it directly.
 */
export type WorkspaceRemovalBroker = {
  client(host: HostRef): Promise<
    Result<
      {
        workspaceRegistry: {
          deleteWorktree(input: {
            id: string;
            deleteBranch: boolean;
          }): Promise<Result<void, DeleteVerbError>>;
          deleteWorkspace(input: { id: string }): Promise<Result<void, DeleteVerbError>>;
        };
      },
      { type: string; message: string }
    >
  >;
};

export type ArchiveWorkspaceInput = {
  projectId: string;
  workspaceId?: string;
  workspacePath: string;
  branchName?: string;
};

export async function deleteWorkspaceThroughRegistry(
  operations: OperationSubmitter,
  runtimes: WorkspaceRemovalBroker,
  workspaceId: string,
  options: { deleteBranch?: boolean; deleteConversations?: boolean } = {}
): Promise<WorkspaceRemovalResult> {
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
  return removeWorkspaceThroughRegistry(operations, runtimes, {
    workspace,
    workspacePath: workspace.path ?? undefined,
    projectId: project?.id,
    host: operationHostRef({
      workspace,
      repository: project && {
        location: project.repositoryLocation,
        sshConnectionId: project.repositorySshConnectionId,
      },
    }),
    requireUnused: true,
    deleteBranch: options.deleteBranch ?? false,
    deleteConversations: options.deleteConversations ?? false,
  });
}

export async function deleteWorkspacePathThroughRegistry(
  operations: OperationSubmitter,
  runtimes: WorkspaceRemovalBroker,
  input: ArchiveWorkspaceInput,
  options: { deleteConversations?: boolean } = {}
): Promise<WorkspaceRemovalResult> {
  return removeWorkspacePathThroughRegistry(operations, runtimes, input, {
    requireUnused: true,
    deleteConversations: options.deleteConversations ?? false,
  });
}

export async function archiveWorkspaceThroughRegistry(
  operations: OperationSubmitter,
  runtimes: WorkspaceRemovalBroker,
  input: ArchiveWorkspaceInput
): Promise<WorkspaceRemovalResult> {
  return removeWorkspacePathThroughRegistry(operations, runtimes, input, { requireUnused: false });
}

async function removeWorkspacePathThroughRegistry(
  operations: OperationSubmitter,
  runtimes: WorkspaceRemovalBroker,
  input: ArchiveWorkspaceInput,
  options: { requireUnused: boolean; deleteConversations?: boolean }
): Promise<WorkspaceRemovalResult> {
  const [project] = await getProjectRemovalRow(operations.db, input.projectId, {
    liveOnly: true,
  });
  if (!project) {
    return err({ type: 'project-not-found', message: `Project ${input.projectId} was not found` });
  }
  const registry = createWorkspaceRegistry(operations.db);
  // Rows discovered by scan may arrive without a registry id; the mirror row for the
  // same path (kept complete by registry sync) carries the host record's identity.
  const workspace = input.workspaceId
    ? registry.getLive(input.workspaceId)
    : findLiveWorkspaceByPath(operations.db, input.workspacePath);
  if (input.workspaceId && !workspace) {
    return err({
      type: 'workspace-not-found',
      message: `Workspace ${input.workspaceId} was not found`,
    });
  }
  return removeWorkspaceThroughRegistry(operations, runtimes, {
    workspace,
    workspacePath: input.workspacePath,
    projectId: project.id,
    host: operationHostRef({
      workspace,
      repository: {
        location: project.repositoryLocation,
        sshConnectionId: project.repositorySshConnectionId,
      },
    }),
    requireUnused: options.requireUnused && input.workspaceId !== undefined,
    deleteConversations: options.deleteConversations ?? false,
  });
}

async function removeWorkspaceThroughRegistry(
  operations: OperationSubmitter,
  runtimes: WorkspaceRemovalBroker,
  params: {
    workspace: WorkspaceRow | undefined;
    workspacePath: string | undefined;
    projectId: string | undefined;
    host: HostRef;
    requireUnused: boolean;
    deleteBranch?: boolean;
    deleteConversations?: boolean;
  }
): Promise<WorkspaceRemovalResult> {
  const createdAt = Date.now();
  const workspaceId = params.workspace?.id;
  const serializedHost = formatHostRef(params.host);
  // Opt-in only (spec §7.1): removal defaults to archive semantics — records survive with
  // dangling paths and stay resumable if the path is recreated. The delete verbs never
  // touch conversation records; the coupling is these explicit per-record requests,
  // snapshot-compiled before the untrack.
  const conversationDeletions = params.deleteConversations
    ? snapshotWorkspaceConversationDeletions(operations.db, {
        workspacePath: params.workspacePath,
        hostRef: serializedHost,
        createdAt,
      })
    : [];
  const conversationIds = conversationDeletions.map((deletion) => deletion.conversationId);

  if (!workspaceId) {
    return err({ type: 'workspace-not-found', message: 'Workspace was not found.' });
  }
  const precondition = workspacePreconditionOutsideTx(operations.db, {
    projectId: params.projectId,
    workspaceId,
    requireUnused: params.requireUnused,
  });
  if (precondition) return err(precondition);

  // The host record is removed first, fail-fast: only a confirmed host-side removal
  // untracks the mirror row, so a failed call leaves everything intact. An unreachable
  // host diverts to the tombstone path instead of refusing (ADR 0006).
  if (params.workspace?.kind === 'worktree' || params.workspace?.kind === 'directory') {
    const workspace = params.workspace;
    const client = await runtimes.client(params.host);
    if (!client.success) {
      return tombstoneUnreachableRemoval(operations.db, workspace, params, createdAt, params.host);
    }
    const verb = client.data.workspaceRegistry;
    const removed =
      params.workspace.kind === 'worktree'
        ? await verb.deleteWorktree({ id: workspaceId, deleteBranch: params.deleteBranch ?? false })
        : await verb.deleteWorkspace({ id: workspaceId });
    if (!removed.success) {
      if (removed.error.type === 'host-unreachable') {
        return tombstoneUnreachableRemoval(
          operations.db,
          workspace,
          params,
          createdAt,
          params.host
        );
      }
      return err({
        type: 'delete-failed',
        message: describeDeleteVerbError(removed.error),
      });
    }
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

/**
 * The offline path (ADR 0006): the mirror row is marked with a durable tombstone
 * freezing the deletion options and the target record's UUID, and the caller sees
 * success — the row stays live as the visible pending state. Nothing queues anywhere;
 * conversation deletions ride the frozen `deleteConversations` option and are compiled
 * at sweep time. A duplicate write (zero rows updated) also returns success, so a UI
 * double-fire never surfaces an error or overwrites the first click's options.
 */
function tombstoneUnreachableRemoval(
  db: AppDb,
  workspace: WorkspaceRow,
  params: {
    projectId: string | undefined;
    requireUnused: boolean;
    deleteBranch?: boolean;
    deleteConversations?: boolean;
  },
  createdAt: number,
  host: HostRef
): WorkspaceRemovalResult {
  const written = tombstoneWorkspaceRow(db, {
    workspace,
    options: {
      deleteBranch: params.deleteBranch ?? false,
      deleteConversations: params.deleteConversations ?? false,
    },
    createdAt,
    precondition: (tx) =>
      workspacePrecondition(tx, {
        projectId: params.projectId,
        workspaceId: workspace.id,
        requireUnused: params.requireUnused,
      }),
  });
  if (!written.success) return err(written.error);
  appDbPokes.workspaces.poke({ projectId: params.projectId });
  // Tombstoned-while-reachable trigger (ADR 0006): reachability may have flapped
  // mid-call, so poke the reconcile sweep — a genuinely unreachable host makes the
  // sweep a no-op attempt with no backoff.
  reconcileSweepTriggers.poke(host);
  return ok({});
}

/**
 * Sweep-time conversation cascade for a tombstone's frozen `deleteConversations`
 * option (spec §7.1): compiles per-record delete requests for the workspace's cached
 * same-path, same-host conversation records, untracks their mirror rows, and submits
 * the host deletions — the same shape the reachable-host removal path uses. A later
 * slice replaces this with conversation deletion tombstones of their own.
 */
export async function cascadeTombstonedConversationDeletions(
  operations: OperationSubmitter,
  params: { workspacePath: string | undefined; host: HostRef; createdAt: number }
): Promise<void> {
  const deletions = snapshotWorkspaceConversationDeletions(operations.db, {
    workspacePath: params.workspacePath,
    hostRef: formatHostRef(params.host),
    createdAt: params.createdAt,
  });
  if (deletions.length === 0) return;
  createConversationRegistry(operations.db).untrack(
    deletions.map((deletion) => deletion.conversationId),
    new Date(params.createdAt).toISOString()
  );
  await submitConversationDeletions(operations, undefined, deletions);
}

function describeDeleteVerbError(error: DeleteVerbError): string {
  switch (error.type) {
    case 'not-a-worktree':
      return 'The record is not a worktree.';
    case 'remove-failed':
      return typeof error.message === 'string' ? error.message : 'Worktree removal failed.';
    default:
      return `Workspace deletion failed (${error.type}).`;
  }
}

function findLiveWorkspaceByPath(db: AppDb, workspacePath: string): WorkspaceRow | undefined {
  const [row] = db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.path, workspacePath), isNull(workspaces.untrackedAt)))
    .limit(1)
    .all();
  return row;
}

/**
 * Snapshot-compiles per-record delete requests for the workspace's cached conversation
 * records: same observed path, same host. Compiled before the untrack so identity rides
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

function workspacePreconditionOutsideTx(
  db: AppDb,
  input: { projectId?: string; workspaceId?: string; requireUnused: boolean }
): { type: string; message: string } | undefined {
  let failure: { type: string; message: string } | undefined;
  db.transaction((tx) => {
    failure = workspacePrecondition(tx, input);
  });
  return failure;
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
