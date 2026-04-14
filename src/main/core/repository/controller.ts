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
  getHeadState: async (projectId: string) => {
    const project = projectManager.getProject(projectId);
    if (!project) {
      throw new Error('Project not found');
    }
    return project.git.getHeadState();
  },
  getDefaultBranch: async (projectId: string) => {
    const project = projectManager.getProject(projectId);
    if (!project) {
      throw new Error('Project not found');
    }
    const [name, remote, branches] = await Promise.all([
      project.settings.getDefaultBranch(),
      project.settings.getRemote(),
      project.git.getBranches(),
    ]);
    const existsLocally = branches.some(
      (branch) => branch.type === 'local' && branch.branch === name
    );
    return { name, remote, existsLocally };
  },
  getRemotes: async (projectId: string) => {
    const project = projectManager.getProject(projectId);
    if (!project) {
      throw new Error('Project not found');
    }
    return project.git.getRemotes();
  },
});
