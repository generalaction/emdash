import { createRPCController } from '@shared/ipc/rpc';
import { clearProjectIcon } from './operations/clearProjectIcon';
import {
  createLocalProject,
  createSshProject,
  getLocalProjectPathStatus,
  getSshProjectPathStatus,
} from './operations/createProject';
import { deleteProject } from './operations/deleteProject';
import { getProjectBootstrapStatus } from './operations/getProjectBootstrapStatus';
import { getLocalProjectByPath, getProjects, getSshProjectByPath } from './operations/getProjects';
import { getProjectSettings } from './operations/getProjectSettings';
import { openProject } from './operations/openProject';
import { setProjectIcon } from './operations/setProjectIcon';
import { updateProjectConnection } from './operations/updateProjectConnection';
import { updateProjectSettings } from './operations/updateProjectSettings';

export const projectController = createRPCController({
  createLocalProject,
  createSshProject,
  getLocalProjectPathStatus,
  getSshProjectPathStatus,
  getProjects,
  deleteProject,
  getLocalProjectByPath,
  getSshProjectByPath,
  getProjectSettings,
  updateProjectSettings,
  updateProjectConnection,
  getProjectBootstrapStatus,
  openProject,
  setProjectIcon,
  clearProjectIcon,
});
