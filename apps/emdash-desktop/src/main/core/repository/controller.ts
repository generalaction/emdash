import { providerRepositoryService } from './provider-repository-service';

export const repositoryOperations = {
  resolveProvider: (projectId: string) => providerRepositoryService.resolveProject(projectId),
};
