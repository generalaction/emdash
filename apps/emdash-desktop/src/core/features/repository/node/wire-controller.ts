import { createController, type Controller } from '@emdash/wire/api';
import type { ProjectSessionManager } from '@core/features/projects/api/node/project-manager';
import { repositoryContract } from '../api';
import { ProviderRepositoryService } from './provider-repository-service';

export function createRepositoryWireController(
  projects: Pick<ProjectSessionManager, 'getProject'>
): Controller {
  const providerRepositoryService = new ProviderRepositoryService(projects);
  return createController(repositoryContract, {
    resolveProvider: ({ projectId }) => providerRepositoryService.resolveProject(projectId),
  });
}
