import { and, eq, isNull } from 'drizzle-orm';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { db } from '@main/db/client';
import { projects, tasks, workspaces } from '@main/db/schema';
import type { ProjectWorkspace } from '@shared/core/workspaces/project-workspace';
import { resolveWorkspaceKind } from '../../workspaces/resolve-workspace-kind';

/**
 * Returns all workspaces for a project:
 * - The project-root workspace (from `projects.repositoryWorkspaceId`)
 * - All worktree workspaces linked through non-archived tasks
 *
 * Deduplicates by workspace ID (tasks pointing at the project-root workspace
 * are covered by the project-root entry).
 */
export async function getProjectWorkspaces(projectId: string): Promise<ProjectWorkspace[]> {
  // 1. Resolve the repository workspace ID for this project.
  const [projectRow] = await db
    .select({ repositoryWorkspaceId: projects.repositoryWorkspaceId })
    .from(projects)
    .where(eq(projects.id, projectId))
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
    .where(and(eq(tasks.projectId, projectId), isNull(tasks.archivedAt)));

  // 3. If repositoryWorkspaceId exists, load it separately so we always have it
  //    even when no task points to it yet.
  let repoWsRow: typeof workspaces.$inferSelect | undefined;
  if (repositoryWorkspaceId) {
    const [row] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, repositoryWorkspaceId))
      .limit(1);
    repoWsRow = row;
  }

  // 4. Build the result set, deduplicating by workspace ID.
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
      isLive: !!workspaceRegistry.get(repoWsRow.id),
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
      isLive: !!workspaceRegistry.get(row.wsId),
    });
  }

  return result;
}
