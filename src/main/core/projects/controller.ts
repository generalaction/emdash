import { createRPCController } from '@shared/ipc/rpc';
import { createProject, inspectProjectPath } from './operations/createProject';
import { deleteProject } from './operations/deleteProject';
import { getProjects } from './operations/getProjects';
import { openProject } from './operations/openProject';
import { updateProjectConnection } from './operations/updateProjectConnection';
import { projectSettingsService } from './settings/project-settings-service';

export const projectController = createRPCController({
  createProject,
  inspectProjectPath,
  getProjects,
  deleteProject,
  getProjectSettingsPage: (projectId: string) =>
    projectSettingsService.getProjectSettingsPage(projectId),
  updateProjectSettings: (projectId, settings) =>
    projectSettingsService.updateProjectSettings(projectId, settings),
  shareProjectSettingsToConfig: (projectId, request) =>
    projectSettingsService.shareProjectSettingsToConfig(projectId, request),
  migrateProjectConfig: (projectId, request) =>
    projectSettingsService.migrateProjectConfig(projectId, request),
  updateProjectConnection,
  openProject,
});
