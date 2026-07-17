import type {
  MigrateProjectConfigRequest,
  ProjectSettings,
  ProjectSettingsPatch,
  WriteProjectConfigRequest,
} from '@core/primitives/project-settings/api';
import { createProject, inspectProjectPath } from './operations/createProject';
import { deleteProject } from './operations/deleteProject';
import { getProjects } from './operations/getProjects';
import { openProject } from './operations/openProject';
import { updateProjectConnection } from './operations/updateProjectConnection';
import { countProjectsUsingGithubAccount } from './settings/count-projects-using-github-account';
import { projectSettingsService } from './settings/project-settings-service';

export const projectOperations = {
  createProject,
  inspectProjectPath,
  getProjects,
  deleteProject,
  getProjectSettingsPage: (projectId: string) =>
    projectSettingsService.getProjectSettingsPage(projectId),
  updateProjectSettings: (projectId: string, settings: ProjectSettings) =>
    projectSettingsService.updateProjectSettings(projectId, settings),
  patchProjectSettings: (projectId: string, patch: ProjectSettingsPatch) =>
    projectSettingsService.patchProjectSettings(projectId, patch),
  shareProjectSettingsToConfig: (projectId: string, request: WriteProjectConfigRequest) =>
    projectSettingsService.shareProjectSettingsToConfig(projectId, request),
  migrateProjectConfig: (projectId: string, request: MigrateProjectConfigRequest) =>
    projectSettingsService.migrateProjectConfig(projectId, request),
  countProjectsUsingGithubAccount,
  updateProjectConnection,
  openProject,
};
