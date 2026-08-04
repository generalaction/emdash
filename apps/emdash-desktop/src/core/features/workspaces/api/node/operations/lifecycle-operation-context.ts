import { eq } from 'drizzle-orm';
import type { ProjectSessionManager } from '@core/features/projects/api/node/project-manager';
import { workspaceRegistryTable as workspaces } from '@core/features/workspaces/api/node/registry';
import { getProvisionedWorkspaceBranch } from '@core/features/workspaces/api/node/workspace-branch';
import type { AppDb } from '@core/services/app-db/node/db';
import {
  projects,
  tasks,
  type ProjectRow,
  type TaskRow,
  type WorkspaceRow,
} from '@core/services/app-db/node/schema';
import type { LifecycleOperationParams } from '@core/services/operations/node';

export type LifecycleOperationContext = {
  task?: TaskRow;
  workspace?: WorkspaceRow;
  project?: ProjectRow;
  projectPath?: string;
  workspacePath?: string;
  workspaceKind?: WorkspaceRow['kind'];
  branchName?: string;
  preservePatterns: string[];
};

export type LifecycleOperationContextDependencies = {
  projects: Pick<ProjectSessionManager, 'getProject'>;
};

export async function resolveLifecycleOperationContext(
  dependencies: LifecycleOperationContextDependencies,
  db: AppDb,
  operation: LifecycleOperationParams,
  options: { resolveRuntimeConfig?: boolean } = {}
): Promise<LifecycleOperationContext> {
  const [task] = operation.taskId
    ? await db.select().from(tasks).where(eq(tasks.id, operation.taskId)).limit(1)
    : [];
  const workspaceId = operation.workspaceId ?? task?.workspaceId;
  const [workspace] = workspaceId
    ? await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1)
    : [];
  const projectId = operation.projectId ?? task?.projectId;
  const [project] = projectId
    ? await db.select().from(projects).where(eq(projects.id, projectId)).limit(1)
    : [];
  const [repository] = project?.repositoryWorkspaceId
    ? await db
        .select({ path: workspaces.path })
        .from(workspaces)
        .where(eq(workspaces.id, project.repositoryWorkspaceId))
        .limit(1)
    : [];
  const provider = projectId ? dependencies.projects.getProject(projectId) : undefined;
  const settings = options.resolveRuntimeConfig ? await provider?.settings.get() : undefined;
  const workspacePath = workspace?.path ?? operation.payload.workspacePath;

  return {
    task,
    workspace,
    project,
    projectPath: repository?.path ?? undefined,
    workspacePath,
    workspaceKind: workspace?.kind ?? (operation.payload.workspacePath ? 'worktree' : undefined),
    branchName:
      (workspace ? getProvisionedWorkspaceBranch(workspace) : undefined) ??
      operation.payload.branchName,
    preservePatterns: settings?.preservePatterns ?? [],
  };
}
