import { issuesPluginRegistry } from '@agent/plugins/issues';
import { pullRequestsPluginRegistry } from '@agent/plugins/pull-requests';
import { err, Result } from '@agent/shared';
import type { ProjectAttachmentManager } from '@core/features/projects/api/node/project-attachment-manager';
import type { ProviderRepositoryResult } from '../api';
import { repositoryRouter, type RepositoryRouter } from '../api/node/repository-router';

export class ProviderRepositoryService {
  constructor(
    private readonly dependencies: {
      projects: Pick<ProjectAttachmentManager, 'requireAttached'>;
      loadProject(projectId: string): Promise<unknown | undefined>;
      router?: Pick<RepositoryRouter, 'route'>;
    }
  ) {}

  async resolveProject(projectId: string): Promise<ProviderRepositoryResult> {
    const record = await this.dependencies.loadProject(projectId);
    if (!record) return err({ type: 'project-missing', projectId });
    const attached = this.dependencies.projects.requireAttached(projectId);
    if (!attached.success) return attached;
    const project = attached.data;

    const remoteState = await project.getRemoteState();
    if (!remoteState.hasRemote) return err({ type: 'no_remote' });
    if (!remoteState.selectedRemoteUrl) return err({ type: 'invalid_remote' });

    const router = this.dependencies.router ?? repositoryRouter;
    return Result.fromAsync(router.route(remoteState.selectedRemoteUrl)).map(
      ({ integrationId, repository }) => ({
        provider: integrationId,
        host: repository.host,
        repositoryUrl: repository.repositoryUrl,
        nameWithOwner: repository.nameWithOwner,
        capabilities: {
          pullRequests: pullRequestsPluginRegistry.get(integrationId) !== undefined,
          issues: issuesPluginRegistry.get(integrationId) !== undefined,
        },
      })
    );
  }
}
