import type { LegacyWorkspaceAutomation } from '@emdash/core/runtimes/workspace/api';
import { eq } from 'drizzle-orm';
import { projectManager } from '@main/core/projects/project-manager';
import { workspaceBootstrapService } from '@main/core/workspaces/workspace-bootstrap-service';
import { getProvisionedWorkspaceBranch } from '@main/core/workspaces/workspace-branch';
import { db } from '@main/db/client';
import {
  projects,
  tasks,
  workspaces,
  type LifecycleOperationRow,
  type ProjectRow,
  type TaskRow,
  type WorkspaceRow,
} from '@main/db/schema';

export type OperationContext = {
  task?: TaskRow;
  workspace?: WorkspaceRow;
  project?: ProjectRow;
  projectPath?: string;
  workspacePath?: string;
  workspaceKind?: WorkspaceRow['kind'];
  branchName?: string;
  preservePatterns: string[];
  automation?: LegacyWorkspaceAutomation;
};

export async function resolveOperationContext(
  operation: LifecycleOperationRow,
  options: { resolveRuntimeConfig?: boolean } = {}
): Promise<OperationContext> {
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
  const provider = projectId ? projectManager.getProject(projectId) : undefined;
  const settings = options.resolveRuntimeConfig ? await provider?.settings.get() : undefined;
  const workspacePath = workspace?.path ?? operation.payload.workspacePath;
  const automation =
    options.resolveRuntimeConfig && provider && workspacePath
      ? await workspaceBootstrapService
          .resolveLegacyAutomation(provider, workspacePath)
          .catch(() => undefined)
      : undefined;

  return {
    task,
    workspace,
    project,
    projectPath: project?.path,
    workspacePath,
    workspaceKind: workspace?.kind ?? (operation.payload.workspacePath ? 'worktree' : undefined),
    branchName:
      (workspace ? getProvisionedWorkspaceBranch(workspace) : undefined) ??
      operation.payload.branchName,
    preservePatterns: settings?.preservePatterns ?? [],
    automation,
  };
}
