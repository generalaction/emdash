import { projectManager } from '@main/core/projects/project-manager';
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

async function resolveBootstrap(params: {
  projectId: string;
  taskId: string;
}): Promise<WorkspaceResolution> {
  const provider = loadProvider(params.projectId);
  return workspaceBootstrapService.resolveBootstrap(params.taskId, toCtx(provider));
}

async function adoptWorktree(params: {
  projectId: string;
  taskId: string;
  candidatePath: string;
}): Promise<void> {
  const provider = loadProvider(params.projectId);
  await workspaceBootstrapService.adoptPath(params.taskId, params.candidatePath, toCtx(provider));
}

async function createWorktree(params: { projectId: string; taskId: string }): Promise<void> {
  const provider = loadProvider(params.projectId);
  await workspaceBootstrapService.createWorktreeForTask(params.taskId, toCtx(provider));
}

export const workspaceController = createRPCController({
  resolveBootstrap,
  adoptWorktree,
  createWorktree,
});
