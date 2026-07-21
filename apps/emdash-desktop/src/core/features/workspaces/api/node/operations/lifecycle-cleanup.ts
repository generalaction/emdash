import type { HostAbsolutePath } from '@emdash/core/primitives/path/api';
import { workspaceContract } from '@emdash/core/runtimes/workspace/api';
import { and, eq, isNull, ne, or } from 'drizzle-orm';
import type { ProjectSessionManager } from '@core/features/projects/api/node/project-manager';
import type { LifecycleOperationContext } from '@core/features/workspaces/api/node/operations/lifecycle-operation-context';
import {
  hostFileRefFromNativePath,
  hostPathFromNative,
} from '@core/primitives/desktop-runtime/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { tasks, workspaces, type LifecycleOperationRow } from '@core/services/app-db/node/schema';
import type { WorkspaceRuntimeClient } from '@core/services/runtime-broker/api/clients';
import { checkoutSelector } from '@core/services/runtime-broker/node/git';
import { runRuntimeLiveJob } from '@core/services/runtime-clients/node/live-job';

export type LifecycleCleanupDependencies = {
  getWorkspaceRuntimeClient(): Promise<WorkspaceRuntimeClient>;
  projects: Pick<ProjectSessionManager, 'getProject'>;
  unregisterFileSearchRoot(path: HostAbsolutePath): Promise<void> | void;
};

export async function deactivateLifecycleWorkspace(
  dependencies: Pick<LifecycleCleanupDependencies, 'getWorkspaceRuntimeClient'>,
  operation: LifecycleOperationRow,
  context: LifecycleOperationContext
): Promise<void> {
  if (!context.workspacePath) return;
  const workspace = hostFileRefFromNativePath(
    context.workspacePath,
    operation.hostRef === 'local' ? undefined : operation.hostRef
  );
  const client = await dependencies.getWorkspaceRuntimeClient();
  const consumerIds =
    operation.kind === 'archive-workspace'
      ? await client.workspace
          .state(workspace, 'state')
          .snapshot()
          .then((snapshot) => snapshot.data.consumers.map((consumer) => consumer.id))
          .catch(() => [])
      : [operation.taskId ?? operation.id];
  const resolvedConsumerIds = consumerIds.length > 0 ? consumerIds : [operation.id];

  for (const consumerId of resolvedConsumerIds) {
    const result = await runRuntimeLiveJob(workspaceContract.deactivate, client.deactivate, {
      workspace,
      consumerId,
      strategy: 'stop',
      automation: context.automation,
    });
    if (!result.success && !isMissingError(result.error)) {
      throw new Error(result.error.message);
    }
  }
}

export async function cleanLifecycleWorkspaceArtifacts(
  dependencies: Pick<LifecycleCleanupDependencies, 'getWorkspaceRuntimeClient'>,
  operation: LifecycleOperationRow,
  context: LifecycleOperationContext
): Promise<void> {
  if (!context.workspacePath || !context.projectPath) return;
  const client = await dependencies.getWorkspaceRuntimeClient();
  const hostId = operation.hostRef === 'local' ? undefined : operation.hostRef;
  const result = await runRuntimeLiveJob(workspaceContract.cleanArtifacts, client.cleanArtifacts, {
    workspace: hostFileRefFromNativePath(context.workspacePath, hostId),
    repoPath: hostFileRefFromNativePath(context.projectPath, hostId),
    preservePatterns: context.preservePatterns,
  });
  if (!result.success && !isMissingError(result.error)) {
    throw new Error(result.error.message);
  }
}

export async function teardownLifecycleWorkspace(
  dependencies: Pick<LifecycleCleanupDependencies, 'getWorkspaceRuntimeClient'>,
  db: AppDb,
  operation: LifecycleOperationRow,
  context: LifecycleOperationContext
): Promise<void> {
  if (operation.workspaceId && !(await lifecycleWorkspaceIsUnused(db, operation.workspaceId))) {
    if (operation.kind === 'delete-task') return;
    if (operation.kind === 'delete-workspace') {
      throw new WorkspaceInUseError();
    }
  }
  if (
    operation.payload.deleteWorktree === false ||
    !context.workspacePath ||
    !context.projectPath ||
    context.workspaceKind === 'project-root'
  ) {
    return;
  }

  const lifecycleRef =
    context.workspaceKind === 'worktree'
      ? context.branchName
        ? {
            kind: 'worktree' as const,
            repoPath: context.projectPath,
            path: context.workspacePath,
            branchName: context.branchName,
          }
        : undefined
      : context.workspaceKind === 'byoi'
        ? { kind: 'directory' as const, path: context.workspacePath }
        : undefined;
  if (!lifecycleRef) return;

  const client = await dependencies.getWorkspaceRuntimeClient();
  const result = await runRuntimeLiveJob(workspaceContract.teardown, client.teardown, {
    workspace: hostFileRefFromNativePath(
      context.workspacePath,
      operation.hostRef === 'local' ? undefined : operation.hostRef
    ),
    force: true,
    lifecycle: {
      ref: lifecycleRef,
      context: {
        repoPath: context.projectPath,
        preservePatterns: context.preservePatterns,
      },
      deleteBranch: operation.payload.deleteBranch !== false,
    },
  });
  if (!result.success && !isMissingError(result.error)) {
    throw new Error(result.error.message);
  }
}

export async function purgeLifecycleWorkspaceRow(
  dependencies: Pick<LifecycleCleanupDependencies, 'unregisterFileSearchRoot'>,
  db: AppDb,
  operation: LifecycleOperationRow,
  context: LifecycleOperationContext
): Promise<void> {
  if (!operation.workspaceId) return;
  if (!(await lifecycleWorkspaceIsUnused(db, operation.workspaceId))) return;
  if (context.workspacePath) {
    await dependencies.unregisterFileSearchRoot(hostPathFromNative(context.workspacePath));
  }
  await db
    .delete(workspaces)
    .where(
      and(
        eq(workspaces.id, operation.workspaceId),
        or(ne(workspaces.kind, 'project-root'), isNull(workspaces.kind))
      )
    );
}

export async function lifecycleWorkspaceIsUnused(db: AppDb, workspaceId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.workspaceId, workspaceId), isNull(tasks.deletedAt)))
    .limit(1);
  return !row;
}

export async function lifecycleWorkspaceIsDirty(
  dependencies: Pick<LifecycleCleanupDependencies, 'projects'>,
  operation: LifecycleOperationRow,
  context: LifecycleOperationContext
): Promise<boolean> {
  if (!operation.projectId || !context.workspacePath) return false;
  const project = dependencies.projects.getProject(operation.projectId);
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
        (status.summary.staged > 0 || status.summary.unstaged > 0 || status.summary.untracked > 0));
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

export class WorkspaceInUseError extends Error {
  readonly code = 'workspace-in-use';

  constructor() {
    super('Workspace is still referenced by an active task.');
  }
}

function isMissingError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('type' in error)) return false;
  const type = String(error.type);
  return type === 'not-found' || type === 'workspace-not-found' || type === 'missing-workspace';
}
