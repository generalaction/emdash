import { createController, type Controller } from '@emdash/wire/api';
import { repositoryContract } from '../api';
import { providerRepositoryService } from './provider-repository-service';

export function createRepositoryWireController(): Controller {
  return createController(repositoryContract, {
    resolveProvider: ({ projectId }) => providerRepositoryService.resolveProject(projectId),
  });
}
