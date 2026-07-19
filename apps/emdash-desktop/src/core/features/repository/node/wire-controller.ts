import { createController, type Controller } from '@emdash/wire/api';
import { repositoryOperations } from '@main/core/repository/controller';
import { repositoryContract } from '../api';

export function createRepositoryWireController(): Controller {
  return createController(repositoryContract, {
    resolveProvider: ({ projectId }) => repositoryOperations.resolveProvider(projectId),
  });
}
