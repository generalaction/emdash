import { eq } from 'drizzle-orm';
import { getProvisionedWorkspaceBranch } from '@main/core/workspaces/workspace-branch';
import { db } from '@main/db/client';
import { projects, tasks, workspaces } from '@main/db/schema';
import type { WorkspaceConfig } from '@shared/core/workspaces/workspace-config';

export type TaskStorageRow = {
  taskId: string;
  taskName: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  projectType: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastInteractedAt: string | null;
  archivedAt: string | null;
  workspaceId: string | null;
  workspaceType: 'local' | 'project-ssh' | 'byoi' | null;
  workspaceKind: 'worktree' | 'project-root' | 'byoi' | null;
  workspaceLocation: 'local' | 'remote' | null;
  workspacePath: string | null;
  workspaceBranchName: string | null;
  workspaceConfig: WorkspaceConfig | null;
};

export function isWorktreeRow(row: TaskStorageRow): boolean {
  return (
    row.workspaceKind === 'worktree' ||
    (!row.workspaceKind &&
      !!getProvisionedWorkspaceBranch({
        kind: row.workspaceKind,
        branchName: row.workspaceBranchName,
        config: row.workspaceConfig,
      }))
  );
}

export function isLocalTaskWorkspace(row: TaskStorageRow): boolean {
  if (row.projectType !== 'local') return false;
  if (row.workspaceLocation === 'remote') return false;
  if (row.workspaceType === 'project-ssh' || row.workspaceType === 'byoi') return false;
  return true;
}

export async function getTaskStorageRows(projectId?: string): Promise<TaskStorageRow[]> {
  const query = db
    .select({
      taskId: tasks.id,
      taskName: tasks.name,
      projectId: tasks.projectId,
      projectName: projects.name,
      projectPath: projects.path,
      projectType: projects.workspaceProvider,
      status: tasks.status,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
      lastInteractedAt: tasks.lastInteractedAt,
      archivedAt: tasks.archivedAt,
      workspaceId: workspaces.id,
      workspaceType: workspaces.type,
      workspaceKind: workspaces.kind,
      workspaceLocation: workspaces.location,
      workspacePath: workspaces.path,
      workspaceBranchName: workspaces.branchName,
      workspaceConfig: workspaces.config,
    })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .leftJoin(workspaces, eq(tasks.workspaceId, workspaces.id));

  const rows = projectId ? await query.where(eq(tasks.projectId, projectId)) : await query;
  return rows.sort((a, b) => {
    const projectCompare = a.projectName.localeCompare(b.projectName);
    if (projectCompare !== 0) return projectCompare;
    return b.updatedAt.localeCompare(a.updatedAt);
  }) as TaskStorageRow[];
}
