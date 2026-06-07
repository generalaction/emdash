import { githubRepositoryResolver } from '@main/core/github/services/github-repository-resolver';
import { projectManager } from '@main/core/projects/project-manager';
import { err, ok } from '@shared/lib/result';
import type { ProviderRepositoryResult } from '@shared/provider-repository';

export class ProviderRepositoryService {
  async resolveProject(projectId: string): Promise<ProviderRepositoryResult> {
    const project = projectManager.getProject(projectId);
    if (!project) return err({ type: 'no_remote' });

    const remoteState = await project.getRemoteState();
    if (!remoteState.hasRemote) return err({ type: 'no_remote' });
    if (!remoteState.selectedRemoteUrl) return err({ type: 'invalid_remote' });

    const repository = await githubRepositoryResolver.resolve(remoteState.selectedRemoteUrl);
    if (repository.success) {
      return ok({
        provider: 'github',
        host: repository.data.host,
        repositoryUrl: repository.data.repositoryUrl,
        nameWithOwner: repository.data.nameWithOwner,
        capabilities: {
          pullRequests: true,
          issues: true,
        },
      });
    }

    switch (repository.error.type) {
      case 'host_unreachable':
        return err({
          type: 'host_unreachable',
          host: repository.error.host,
          reason: repository.error.reason,
        });
      case 'host_error':
        return err({
          type: 'host_error',
          host: repository.error.host,
          reason: repository.error.reason,
        });
      case 'not_parseable':
        return err({ type: 'invalid_remote' });
      case 'not_github':
        return err({
          type: 'unsupported_provider',
          host: repository.error.host,
          reason: repository.error.reason,
        });
    }
  }
}

export const providerRepositoryService = new ProviderRepositoryService();
