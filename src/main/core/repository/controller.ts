import { createRPCController } from '@shared/ipc/rpc';
import { projectManager } from '../projects/project-manager';

export const repositoryController = createRPCController({
  getBranches: async (projectId: string) => {
    const project = projectManager.getProject(projectId);
    if (!project) {
      throw new Error('Project not found');
    }
    return await project.git.getBranches();
  },
  getDefaultBranch: async (projectId: string) => {
    const project = projectManager.getProject(projectId);
    if (!project) {
      throw new Error('Project not found');
    }
    return await project.git.getDefaultBranch();
  },
});
