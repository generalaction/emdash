import { createRPCController } from '@shared/ipc/rpc';
import { projectManager } from '../projects/project-manager';

export const repositoryController = createRPCController({
  getBranches: async (projectId: string) => {
    const project = projectManager.getProject(projectId);
    if (!project) {
      throw new Error('Project not found');
    }
    return project.git.getBranches();
  },
  getDefaultBranch: async (projectId: string) => {
    const project = projectManager.getProject(projectId);
    if (!project) {
      throw new Error('Project not found');
    }
    const [name, remote] = await Promise.all([
      project.settings.getDefaultBranch(),
      project.settings.getRemote(),
    ]);
    return { name, remote, existsLocally: true };
  },
  getRemotes: async (projectId: string) => {
    const project = projectManager.getProject(projectId);
    if (!project) {
      throw new Error('Project not found');
    }
    return project.git.getRemotes();
  },
});
