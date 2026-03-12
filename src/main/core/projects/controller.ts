import { createRPCController } from '@shared/ipc/rpc';
import { createLocalProject, createSshProject } from './operations/createProject';
import { deleteProject } from './operations/deleteProject';
import { getLocalProjectByPath, getProjects, getSshProjectByPath } from './operations/getProjects';
import { renameProject } from './operations/renameProject';

export const projectController = createRPCController({
  createLocalProject,
  createSshProject,
  getProjects,
  deleteProject,
  renameProject,
  getLocalProjectByPath,
  getSshProjectByPath,
});
