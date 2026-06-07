import { events } from '@main/lib/events';
import { telemetryService } from '@main/lib/telemetry';
import { gitRefChangedChannel } from '@shared/core/git/gitEvents';
import type { BranchesPayload, LocalBranchesPayload, RemoteBranchesPayload } from '@shared/git';
import { createRPCController } from '@shared/lib/ipc/rpc';
import { err, ok } from '@shared/lib/result';
import type { GitRepositoryService } from '../git/repository-service';
import { projectManager } from '../projects/project-manager';
import { workspaceRegistry } from '../workspaces/workspace-registry';
import { providerRepositoryService } from './provider-repository-service';

function resolveRepository(projectId: string, workspaceId?: string): GitRepositoryService {
  const project = projectManager.getProject(projectId);
  if (!project) throw new Error('Project not found');
  if (workspaceId) {
    const ws = workspaceRegistry.get(workspaceId);
    if (ws) return ws.repository;
  }
  return project.repository;
}

export const repositoryController = createRPCController({
  getBranches: async (projectId: string): Promise<BranchesPayload> => {
    const project = projectManager.getProject(projectId);
    if (!project) {
      throw new Error('Project not found');
    }
    return project.repository.getBranchesPayload();
  },

  getLocalBranches: async (
    projectId: string,
    workspaceId?: string
  ): Promise<LocalBranchesPayload> => {
    return resolveRepository(projectId, workspaceId).getLocalBranchesPayload();
  },

  getRemoteBranches: async (
    projectId: string,
    workspaceId?: string
  ): Promise<RemoteBranchesPayload> => {
    return resolveRepository(projectId, workspaceId).getRemoteBranchesPayload();
  },

  getRemotes: async (projectId: string) => {
    const project = projectManager.getProject(projectId);
    if (!project) {
      throw new Error('Project not found');
    }
    return project.repository.getRemotes();
  },

  resolveProviderRepository: async (projectId: string) => {
    return providerRepositoryService.resolveProject(projectId);
  },

  addRemote: async (projectId: string, name: string, url: string) => {
    const project = projectManager.getProject(projectId);
    if (!project) return err({ type: 'not_found' as const });
    try {
      await project.repository.addRemote(name, url);
      return ok();
    } catch (e) {
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  renameBranch: async (projectId: string, oldBranch: string, newBranch: string) => {
    const project = projectManager.getProject(projectId);
    if (!project) return err({ type: 'not_found' as const });
    const result = await project.repository.renameBranch(oldBranch, newBranch);
    if (!result.success) return err(result.error);
    return ok();
  },

  fetch: async (projectId: string, workspaceId?: string) => {
    const project = projectManager.getProject(projectId);
    if (!project) return err({ type: 'not_found' as const });

    let result;
    if (workspaceId) {
      const ws = workspaceRegistry.get(workspaceId);
      result = ws ? await ws.fetchService.fetch() : await project.fetch();
    } else {
      result = await project.fetch();
    }

    telemetryService.capture('vcs_fetch', {
      success: result.success,
      project_id: projectId,
      ...(result.success ? {} : { error_type: result.error.type }),
    });

    if (!result.success) return err(result.error);

    if (workspaceId) {
      events.emit(gitRefChangedChannel, { projectId, workspaceId, kind: 'remote-refs' });
    }

    return ok();
  },

  fetchPrForReview: async (
    projectId: string,
    prNumber: number,
    headRefName: string,
    headRepositoryUrl: string,
    isFork: boolean
  ) => {
    const project = projectManager.getProject(projectId);
    if (!project) return err({ type: 'not_found' as const });
    const baseRemote = await project.repository.getBaseRemote();
    const result = await project.repository.fetchPrForReview(
      prNumber,
      headRefName,
      headRepositoryUrl,
      headRefName,
      isFork,
      baseRemote
    );
    if (!result.success) return err(result.error);
    return ok({ localBranch: headRefName });
  },
});
