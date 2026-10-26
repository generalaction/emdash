import { createController, type Controller } from '@emdash/wire/rpc';
import type { ProjectAttachmentManager } from '@core/features/projects/api/node/project-attachment-manager';
import { repositoryContract } from '../api';
import type { GitLabRepositoryService } from './gitlab-repository-service';
import { ProviderRepositoryService } from './provider-repository-service';

export function createRepositoryWireController(dependencies: {
  projects: Pick<ProjectAttachmentManager, 'requireAttached'>;
  loadProject(projectId: string): Promise<unknown | undefined>;
  gitlab: GitLabRepositoryService;
}): Controller {
  const providerRepositoryService = new ProviderRepositoryService({
    projects: dependencies.projects,
    loadProject: dependencies.loadProject,
  });
  return createController(repositoryContract, {
    resolveProvider: ({ projectId }) => providerRepositoryService.resolveProject(projectId),
    gitLabOwners: async ({ accountId }) => {
      try {
        const result = await dependencies.gitlab.getOwners(accountId);
        return result.success
          ? { success: true, owners: result.data }
          : { success: false, error: result.error.message };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    gitLabCreate: async (input) => {
      try {
        const result = await dependencies.gitlab.createRepository(input);
        return result.success
          ? {
              success: true,
              cloneUrl: result.data.cloneUrl,
              nameWithOwner: result.data.nameWithOwner,
            }
          : { success: false, error: result.error.message };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    gitLabDelete: async (input) => {
      try {
        const result = await dependencies.gitlab.deleteRepository(input);
        return result.success ? { success: true } : { success: false, error: result.error.message };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  });
}
