import { err, ok } from '@emdash/shared';
import { telemetryService } from '@main/lib/telemetry';
import type { GitRepositorySnapshotResult } from '@shared/core/git/rpc';
import { createRPCController } from '@shared/lib/ipc/rpc';
import { projectManager } from '../../projects/project-manager';
import { providerRepositoryService } from '../../repository/provider-repository-service';
import { workspaceRegistry } from '../../workspaces/workspace-registry';

export const gitRepositoryController = createRPCController({
  getRepoSnapshot: async (projectId: string): Promise<GitRepositorySnapshotResult> => {
    const project = projectManager.getProject(projectId);
    if (!project) return err({ type: 'not_found' as const });
    try {
      return ok(await project.gitRepository.getSnapshot());
    } catch (e) {
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  getProjectRootHead: async (projectId: string) => {
    const project = projectManager.getProject(projectId);
    if (!project) return err({ type: 'not_found' as const });
    try {
      return ok({ head: await project.getProjectRootHead() });
    } catch (e) {
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  getDefaultBranch: async (projectId: string) => {
    const project = projectManager.getProject(projectId);
    if (!project) return err({ type: 'not_found' as const });
    try {
      return ok({ defaultBranch: await project.gitRepository.getDefaultBranch() });
    } catch (e) {
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  resolveProviderRepository: async (projectId: string) => {
    return providerRepositoryService.resolveProject(projectId);
  },

  addRemote: async (projectId: string, name: string, url: string) => {
    const project = projectManager.getProject(projectId);
    if (!project) return err({ type: 'not_found' as const });
    try {
      await project.gitRepository.addRemote(name, url);
      return ok();
    } catch (e) {
      return err({ type: 'git_error' as const, message: String(e) });
    }
  },

  fetch: async (projectId: string, workspaceId?: string) => {
    const project = projectManager.getProject(projectId);
    if (!project) return err({ type: 'not_found' as const });

    let result;
    if (workspaceId) {
      const ws = workspaceRegistry.get(workspaceId);
      result = ws ? await ws.gitRepositoryFetchService.fetch() : await project.fetch();
    } else {
      result = await project.fetch();
    }

    telemetryService.capture('vcs_fetch', {
      success: result.success,
      project_id: projectId,
      ...(result.success ? {} : { error_type: result.error.type }),
    });

    if (!result.success) return err(result.error);
    return result;
  },

  publishBranch: async (
    projectId: string,
    branchName: string,
    remote: string,
    workspaceId?: string
  ) => {
    const project = projectManager.getProject(projectId);
    if (!project) return err({ type: 'not_found' as const });
    const result = await project.gitRepository.publishBranch(branchName, remote);
    telemetryService.capture('vcs_branch_published', {
      success: result.success,
      project_id: projectId,
      ...(workspaceId ? { task_id: workspaceId } : {}),
      ...(result.success ? {} : { error_type: result.error.type }),
    });
    return result;
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
    const baseRemote = await project.gitRepository.getBaseRemote();
    const result = await project.gitRepository.fetchPrForReview(
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
