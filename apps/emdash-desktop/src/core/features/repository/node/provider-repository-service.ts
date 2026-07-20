import { err, Result } from '@emdash/shared/result';
import { match } from 'ts-pattern';
import type { ProviderRepositoryResult } from '@core/primitives/repository/api';
import { githubRepositoryResolver } from '@main/core/github/services/github-repository-resolver';
import { projectManager } from '@main/core/projects/project-manager';

export class ProviderRepositoryService {
  async resolveProject(projectId: string): Promise<ProviderRepositoryResult> {
    const project = projectManager.getProject(projectId);
    if (!project) return err({ type: 'no_remote' });

    const remoteState = await project.getRemoteState();
    if (!remoteState.hasRemote) return err({ type: 'no_remote' });
    if (!remoteState.selectedRemoteUrl) return err({ type: 'invalid_remote' });

    return Result.fromAsync(githubRepositoryResolver.resolve(remoteState.selectedRemoteUrl))
      .map((repo) => ({
        provider: 'github' as const,
        host: repo.host,
        repositoryUrl: repo.repositoryUrl,
        nameWithOwner: repo.nameWithOwner,
        capabilities: { pullRequests: true, issues: true },
      }))
      .mapErr((e) =>
        match(e)
          .with({ type: 'not_parseable' }, () => ({ type: 'invalid_remote' as const }))
          .with({ type: 'not_github' }, (x) => ({
            type: 'unsupported_provider' as const,
            host: x.host,
            reason: x.reason,
          }))
          .with({ type: 'host_unreachable' }, (x) => ({
            type: 'host_unreachable' as const,
            host: x.host,
            reason: x.reason,
          }))
          .with({ type: 'host_error' }, (x) => ({
            type: 'host_error' as const,
            host: x.host,
            reason: x.reason,
          }))
          .exhaustive()
      );
  }
}

export const providerRepositoryService = new ProviderRepositoryService();
