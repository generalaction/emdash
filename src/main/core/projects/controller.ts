import { createRPCController } from '@shared/ipc/rpc';
import { createLocalProject, createSshProject } from './operations/createProject';
import { deleteProject } from './operations/deleteProject';
import { getProjectBootstrapStatus } from './operations/getProjectBootstrapStatus';
import { getLocalProjectByPath, getProjects, getSshProjectByPath } from './operations/getProjects';
import { getProjectSettings } from './operations/getProjectSettings';
import { openProject } from './operations/openProject';
import { updateProjectSettings } from './operations/updateProjectSettings';

export const projectController = createRPCController({
  createLocalProject,
  createSshProject,
  getProjects,
  deleteProject,
  getLocalProjectByPath,
  getSshProjectByPath,
  getProjectSettings,
  updateProjectSettings,
  getProjectBootstrapStatus,
  openProject,
});
