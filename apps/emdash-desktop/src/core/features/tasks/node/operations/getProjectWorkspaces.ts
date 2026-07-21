import { sshConnectionIdOf } from '@emdash/core/primitives/host/api';
import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import { and, eq, isNull } from 'drizzle-orm';
import { resolveWorkspaceKind } from '@core/features/workspaces/api/node/resolve-workspace-kind';
import type { WorkspaceIdentityService } from '@core/features/workspaces/api/node/workspace-identity-service';
import { hostFileRefFromNativePath } from '@core/primitives/desktop-runtime/api';
import type { ProjectWorkspace } from '@core/primitives/workspaces/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { projects, tasks, workspaces } from '@core/services/app-db/node/schema';

/**
 * Returns all workspaces for a project:
 * - The project-root workspace (from `projects.repositoryWorkspaceId`)
 * - All worktree workspaces linked through non-archived tasks
 *
 * Deduplicates by workspace ID (tasks pointing at the project-root workspace
 * are covered by the project-root entry).
 */
export async function getProjectWorkspaces(
  dependencies: {
    db: AppDb;
    runtimes: RuntimeBroker;
    workspaceIdentity: WorkspaceIdentityService;
  },
  projectId: string
): Promise<ProjectWorkspace[]> {
  const { db, runtimes, workspaceIdentity } = dependencies;
  // 1. Resolve the repository workspace ID for this project.
  const [projectRow] = await db
    .select({ repositoryWorkspaceId: projects.repositoryWorkspaceId })
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);

  const repositoryWorkspaceId = projectRow?.repositoryWorkspaceId ?? null;

  // 2. Load all workspaces linked through non-archived tasks for this project,
  //    joining task name for display purposes.
  const taskWsRows = await db
    .select({
      wsId: workspaces.id,
      wsKind: workspaces.kind,
      wsType: workspaces.type,
      wsPath: workspaces.path,
      wsBranchName: workspaces.branchName,
      wsConfig: workspaces.config,
      wsLinesAdded: workspaces.linesAdded,
      wsLinesDeleted: workspaces.linesDeleted,
      taskId: tasks.id,
      taskName: tasks.name,
    })
    .from(tasks)
    .innerJoin(workspaces, eq(tasks.workspaceId, workspaces.id))
    .where(
      and(
        eq(tasks.projectId, projectId),
        isNull(tasks.archivedAt),
        isNull(tasks.deletedAt),
        isNull(workspaces.deletedAt)
      )
    );

  // 3. If repositoryWorkspaceId exists, load it separately so we always have it
  //    even when no task points to it yet.
  let repoWsRow: typeof workspaces.$inferSelect | undefined;
  if (repositoryWorkspaceId) {
    const [row] = await db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.id, repositoryWorkspaceId), isNull(workspaces.deletedAt)))
      .limit(1);
    repoWsRow = row;
  }

  // 4. Count how many non-archived tasks link to each workspace.
  const wsTaskCount = new Map<string, number>();
  for (const row of taskWsRows) {
    wsTaskCount.set(row.wsId, (wsTaskCount.get(row.wsId) ?? 0) + 1);
  }
  const workspaceIds = new Set(taskWsRows.map((row) => row.wsId));
  if (repoWsRow) workspaceIds.add(repoWsRow.id);
  const liveWorkspaceIds = new Set(
    (
      await Promise.all(
        Array.from(workspaceIds, async (workspaceId) =>
          (await workspaceHasConsumers(runtimes, workspaceIdentity, workspaceId))
            ? workspaceId
            : null
        )
      )
    ).filter((workspaceId): workspaceId is string => workspaceId !== null)
  );

  // 5. Build the result set, deduplicating by workspace ID.
  const seen = new Set<string>();
  const result: ProjectWorkspace[] = [];

  // Project-root workspace comes first.
  if (repoWsRow) {
    seen.add(repoWsRow.id);
    result.push({
      id: repoWsRow.id,
      kind: resolveWorkspaceKind(repoWsRow),
      path: repoWsRow.path,
      branchName: repoWsRow.branchName,
      config: repoWsRow.config,
      linesAdded: repoWsRow.linesAdded,
      linesDeleted: repoWsRow.linesDeleted,
      taskId: null,
      taskName: null,
      isLive: liveWorkspaceIds.has(repoWsRow.id),
      linkedTaskCount: wsTaskCount.get(repoWsRow.id) ?? 0,
    });
  }

  for (const row of taskWsRows) {
    if (seen.has(row.wsId)) continue;
    seen.add(row.wsId);
    result.push({
      id: row.wsId,
      kind: resolveWorkspaceKind({ kind: row.wsKind, type: row.wsType, path: row.wsPath }),
      path: row.wsPath,
      branchName: row.wsBranchName,
      config: row.wsConfig,
      linesAdded: row.wsLinesAdded,
      linesDeleted: row.wsLinesDeleted,
      taskId: row.taskId,
      taskName: row.taskName,
      isLive: liveWorkspaceIds.has(row.wsId),
      linkedTaskCount: wsTaskCount.get(row.wsId) ?? 0,
    });
  }

  return result;
}

async function workspaceHasConsumers(
  runtimes: RuntimeBroker,
  workspaceIdentity: WorkspaceIdentityService,
  workspaceId: string
): Promise<boolean> {
  const identity = await workspaceIdentity.resolve(workspaceId);
  if (!identity) return false;
  const lease = runtimes.session(identity.host);
  try {
    const runtime = await lease.ready();
    if (!runtime.success) return false;
    const workspace = hostFileRefFromNativePath(identity.path, sshConnectionIdOf(identity.host));
    const snapshot = await runtime.data.workspace.workspace
      .state(workspace, 'state')
      .asLiveSource()
      .snapshot();
    const state = snapshot.data as { consumers?: readonly unknown[] };
    return (state.consumers?.length ?? 0) > 0;
  } finally {
    await lease.release();
  }
}
