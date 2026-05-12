import { createRPCController } from '@shared/ipc/rpc';
import { createProject, inspectProjectPath } from './operations/createProject';
import { deleteProject } from './operations/deleteProject';
import { getProjects } from './operations/getProjects';
import { openProject } from './operations/openProject';
import { setProjectArchived } from './operations/setProjectArchived';
import { updateProjectAppearance } from './operations/updateProjectAppearance';
import { updateProjectConnection } from './operations/updateProjectConnection';
import {
  getProjectSettingsPage,
  shareProjectSettingsToConfig,
  updateProjectSettings,
} from './settings/project-settings-service';

export const projectController = createRPCController({
  createProject,
  inspectProjectPath,
  getProjects,
  deleteProject,
  getProjectSettingsPage,
  updateProjectSettings,
  shareProjectSettingsToConfig,
  updateProjectConnection,
  openProject,
  setProjectArchived,
  updateProjectAppearance,
});
