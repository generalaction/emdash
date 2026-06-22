import { log } from '@main/lib/logger';
import { createRPCController } from '@shared/lib/ipc/rpc';
import { cloneProjectRepository, initializeProjectRepository } from './repository-setup';

export const projectSetupController = createRPCController({
  cloneRepository: async (repoUrl: string, targetPath: string, connectionId?: string) => {
    try {
      return await cloneProjectRepository({
        repositoryUrl: repoUrl,
        targetPath,
        connectionId,
      });
    } catch (error) {
      log.error('Failed to clone repository:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Clone failed',
      };
    }
  },
  initializeRepository: async (params: {
    targetPath: string;
    name: string;
    description?: string;
    connectionId?: string;
  }) => {
    try {
      return await initializeProjectRepository(params);
    } catch (error) {
      log.error('Failed to initialize repository:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Initialize failed',
      };
    }
  },
});
