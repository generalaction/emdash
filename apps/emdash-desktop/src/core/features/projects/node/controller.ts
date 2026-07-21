import type { ProjectSessionManager } from '@core/features/projects/api/node/project-manager';
import type { ProjectSettingsService } from '@core/features/projects/api/node/settings/project-settings-service';
import type { WorkspacePlacementResolver } from '@core/features/workspaces/api/node/placement/workspace-placement-resolver';
import type {
  MigrateProjectConfigRequest,
  ProjectSettings,
  ProjectSettingsPatch,
  WriteProjectConfigRequest,
} from '@core/primitives/project-settings/api';
import type { OperationsEngine } from '@core/services/operations/node';
import type { WorkspaceRuntimeClient } from '@core/services/runtime-broker/api/clients';
import type { LocalProjectOperationDependencies } from './operations/create-local-project';
import { createProject, inspectProjectPath } from './operations/createProject';
import { deleteProject } from './operations/deleteProject';
import { getProjects } from './operations/getProjects';
import { openProject } from './operations/openProject';
import { resolveRepositoryDestination } from './operations/resolve-repository-destination';
import { updateProjectConnection } from './operations/updateProjectConnection';
import { countProjectsUsingGithubAccount } from './settings/count-projects-using-github-account';

export type ProjectOperationDependencies = LocalProjectOperationDependencies & {
  operations: OperationsEngine;
  getWorkspaceRuntimeClient(): Promise<WorkspaceRuntimeClient>;
  placement: WorkspacePlacementResolver;
  projectSettings: ProjectSettingsService;
  projects: Pick<ProjectSessionManager, 'openProject'>;
};

export function createProjectOperations(dependencies: ProjectOperationDependencies) {
  const { db, operations, placement, projectSettings, projects } = dependencies;
  return {
    createProject: (params: Parameters<typeof createProject>[1]) =>
      createProject(dependencies, params),
    inspectProjectPath: (params: Parameters<typeof inspectProjectPath>[1]) =>
      inspectProjectPath(dependencies, params),
    resolveRepositoryDestination: (input: Parameters<typeof resolveRepositoryDestination>[1]) =>
      resolveRepositoryDestination(placement, input),
    getProjects: () => getProjects(db),
    deleteProject: (projectId: string) => deleteProject(operations, projectId),
    getProjectSettingsPage: (projectId: string) =>
      projectSettings.getProjectSettingsPage(projectId),
    updateProjectSettings: (projectId: string, settings: ProjectSettings) =>
      projectSettings.updateProjectSettings(projectId, settings),
    patchProjectSettings: (projectId: string, patch: ProjectSettingsPatch) =>
      projectSettings.patchProjectSettings(projectId, patch),
    shareProjectSettingsToConfig: (projectId: string, request: WriteProjectConfigRequest) =>
      projectSettings.shareProjectSettingsToConfig(projectId, request),
    migrateProjectConfig: (projectId: string, request: MigrateProjectConfigRequest) =>
      projectSettings.migrateProjectConfig(projectId, request),
    countProjectsUsingGithubAccount: (accountId: string) =>
      countProjectsUsingGithubAccount(db, accountId),
    updateProjectConnection: (projectId: string, connectionId: string) =>
      updateProjectConnection(db, projectId, connectionId),
    openProject: (projectId: string) => openProject(db, projects, projectId),
  };
}
