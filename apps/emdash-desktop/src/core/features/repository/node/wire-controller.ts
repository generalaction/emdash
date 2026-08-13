import { createController, type Controller } from '@emdash/wire/rpc';
import type { ProjectAttachmentManager } from '@core/features/projects/api/node/project-attachment-manager';
import { repositoryContract } from '../api';
import { ProviderRepositoryService } from './provider-repository-service';

export function createRepositoryWireController(
  projects: Pick<ProjectAttachmentManager, 'getProject'>
): Controller {
  const providerRepositoryService = new ProviderRepositoryService(projects);
  return createController(repositoryContract, {
    resolveProvider: ({ projectId }) => providerRepositoryService.resolveProject(projectId),
  });
}
