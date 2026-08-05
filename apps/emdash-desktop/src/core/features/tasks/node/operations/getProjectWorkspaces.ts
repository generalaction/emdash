import { and, eq, isNull } from 'drizzle-orm';
import type { TaskSessionManager } from '@core/features/tasks/api/node/task-session-manager';
import {
  createWorkspaceRegistry,
  liveWorkspaces,
  workspaceRegistryTable as workspaces,
} from '@core/features/workspaces/api/node/registry';
import { getProvisionedWorkspaceBranch } from '@core/features/workspaces/api/node/workspace-branch';
import type { ProjectWorkspace } from '@core/primitives/workspaces/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { projects, tasks } from '@core/services/app-db/node/schema';

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
    taskSessions: Pick<TaskSessionManager, 'getTask'>;
  },
  projectId: string
): Promise<ProjectWorkspace[]> {
  const { db, taskSessions } = dependencies;
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
      wsPath: workspaces.path,
      wsConfig: workspaces.config,
      wsObservedGit: workspaces.observedGit,
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
        liveWorkspaces()
      )
    );

  // 3. If repositoryWorkspaceId exists, load it separately so we always have it
  //    even when no task points to it yet.
  let repoWsRow: typeof workspaces.$inferSelect | undefined;
  if (repositoryWorkspaceId) {
    repoWsRow = createWorkspaceRegistry(db).getLive(repositoryWorkspaceId);
  }

  // 4. Count how many non-archived tasks link to each workspace.
  const wsTaskCount = new Map<string, number>();
  for (const row of taskWsRows) {
    wsTaskCount.set(row.wsId, (wsTaskCount.get(row.wsId) ?? 0) + 1);
  }
  // A workspace is live when any linked task has an active session.
  const liveWorkspaceIds = new Set(
    taskWsRows.filter((row) => !!taskSessions.getTask(row.taskId)).map((row) => row.wsId)
  );

  // 5. Build the result set, deduplicating by workspace ID.
  const seen = new Set<string>();
  const result: ProjectWorkspace[] = [];

  // Project-root workspace comes first.
  if (repoWsRow) {
    seen.add(repoWsRow.id);
    result.push({
      id: repoWsRow.id,
      kind: repoWsRow.kind ?? 'repository',
      path: repoWsRow.path,
      branchName: getProvisionedWorkspaceBranch(repoWsRow),
      config: repoWsRow.config,
      // Mirror diff stats; untracked files' lines count as additions.
      linesAdded: repoWsRow.observedGit?.diffStats?.added ?? null,
      linesDeleted: repoWsRow.observedGit?.diffStats?.deleted ?? null,
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
      kind: row.wsKind ?? 'worktree',
      path: row.wsPath,
      branchName: getProvisionedWorkspaceBranch({ kind: row.wsKind, config: row.wsConfig }),
      config: row.wsConfig,
      linesAdded: row.wsObservedGit?.diffStats?.added ?? null,
      linesDeleted: row.wsObservedGit?.diffStats?.deleted ?? null,
      taskId: row.taskId,
      taskName: row.taskName,
      isLive: liveWorkspaceIds.has(row.wsId),
      linkedTaskCount: wsTaskCount.get(row.wsId) ?? 0,
    });
  }

  return result;
}
