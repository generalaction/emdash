import { eq } from 'drizzle-orm';
import { projectManager } from '@main/core/projects/project-manager';
import { buildInstanceResources } from '@main/core/tasks/instance-workspace-builder';
import { db } from '@main/db/client';
import { tasks, workspaces } from '@main/db/schema';
import { createRPCController } from '@shared/ipc/rpc';
import type { WorkspaceResolution } from '@shared/workspaces';
import type { ProjectProvider } from '../projects/project-provider';
import { workspaceBootstrapService, type WorktreeContext } from './workspace-bootstrap-service';

function toCtx(provider: ProjectProvider): WorktreeContext {
  return {
    connectionId:
      provider.defaultWorkspaceType.kind === 'ssh'
        ? provider.defaultWorkspaceType.connectionId
        : undefined,
    repoPath: provider.repoPath,
    worktreeService: provider.worktreeService,
  };
}

function loadProvider(projectId: string): ProjectProvider {
  const provider = projectManager.getProject(projectId);
  if (!provider) throw new Error(`Project not found: ${projectId}`);
  return provider;
}

/**
 * Resolves the correct WorktreeContext for a task. When the task's workspace
 * is linked to a secondary RepoInstance, builds resources for that instance
 * instead of using the primary project's transport.
 */
async function toCtxForTask(provider: ProjectProvider, taskId: string): Promise<WorktreeContext> {
  const [taskRow] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!taskRow?.workspaceId) return toCtx(provider);

  const [workspaceRow] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, taskRow.workspaceId));

  if (!workspaceRow?.repoInstanceId) return toCtx(provider);

  const resources = await buildInstanceResources(workspaceRow.repoInstanceId);
  return {
    connectionId: resources.connectionId,
    repoPath: resources.projectPath,
    worktreeService: resources.worktreeService,
  };
}

async function resolveBootstrap(params: {
  projectId: string;
  taskId: string;
}): Promise<WorkspaceResolution> {
  const provider = loadProvider(params.projectId);
  const ctx = await toCtxForTask(provider, params.taskId);
  return workspaceBootstrapService.resolveBootstrap(params.taskId, ctx);
}

async function adoptWorktree(params: {
  projectId: string;
  taskId: string;
  candidatePath: string;
}): Promise<void> {
  const provider = loadProvider(params.projectId);
  const ctx = await toCtxForTask(provider, params.taskId);
  await workspaceBootstrapService.adoptPath(params.taskId, params.candidatePath, ctx);
}

async function createWorktree(params: { projectId: string; taskId: string }): Promise<void> {
  const provider = loadProvider(params.projectId);
  const ctx = await toCtxForTask(provider, params.taskId);
  await workspaceBootstrapService.createWorktreeForTask(params.taskId, ctx);
}

export const workspaceController = createRPCController({
  resolveBootstrap,
  adoptWorktree,
  createWorktree,
});
