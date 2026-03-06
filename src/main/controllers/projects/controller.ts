import { createRPCController } from '../../../shared/ipc/rpc';
import { getProjects } from './getProjects';
import { type CreateLocalProjectParams, handleCreateLocalProject } from './handleCreateProject';

export const projectController = createRPCController({
  createProject: async (params: CreateLocalProjectParams) => {
    return handleCreateLocalProject(params);
  },
  getProjects,
});
