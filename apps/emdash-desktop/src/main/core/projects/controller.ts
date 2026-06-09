import { createRPCController } from '@shared/lib/ipc/rpc';
import { createProject, inspectProjectPath } from './operations/createProject';
import { deleteProject } from './operations/deleteProject';
import { getProjects } from './operations/getProjects';
import { openProject } from './operations/openProject';
import { renameProject } from './operations/renameProject';
import { updateProjectConnection } from './operations/updateProjectConnection';
import { countProjectsUsingGithubAccount } from './settings/count-projects-using-github-account';
import { projectSettingsService } from './settings/project-settings-service';

export const projectController = createRPCController({
  createProject,
  inspectProjectPath,
  getProjects,
  deleteProject,
  renameProject,
  getProjectSettingsPage: (projectId: string) =>
    projectSettingsService.getProjectSettingsPage(projectId),
  updateProjectSettings: (projectId, settings) =>
    projectSettingsService.updateProjectSettings(projectId, settings),
  patchProjectSettings: (projectId, patch) =>
    projectSettingsService.patchProjectSettings(projectId, patch),
  shareProjectSettingsToConfig: (projectId, request) =>
    projectSettingsService.shareProjectSettingsToConfig(projectId, request),
  migrateProjectConfig: (projectId, request) =>
    projectSettingsService.migrateProjectConfig(projectId, request),
  countProjectsUsingGithubAccount,
  updateProjectConnection,
  openProject,
});
