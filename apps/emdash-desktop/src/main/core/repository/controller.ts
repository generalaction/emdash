import { createRPCController } from '@shared/lib/ipc/rpc';
import { providerRepositoryService } from './provider-repository-service';

export const repositoryController = createRPCController({
  resolveProvider: (projectId: string) => providerRepositoryService.resolveProject(projectId),
});
