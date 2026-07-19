import { createController, type Controller } from '@emdash/wire/api';
import { projectSettingsOperations } from '@main/core/workspaces/project-settings-controller';
import { projectWorkspaceOperations } from '@main/core/workspaces/project-workspaces-controller';
import { projectSettingsContract, projectWorkspacesContract } from '../api';

export function createProjectSettingsWireController(): Controller {
  return createController(projectSettingsContract, {
    getSettings: ({ workspaceId }) => projectSettingsOperations.getSettings(workspaceId),
  });
}

export function createProjectWorkspacesWireController(): Controller {
  return createController(projectWorkspacesContract, {
    listProjectWorkspaces: ({ projectId }) =>
      projectWorkspaceOperations.listProjectWorkspaces(projectId),
    measureProjectWorkspaces: (input) => projectWorkspaceOperations.measureProjectWorkspaces(input),
    deleteProjectWorkspaces: (input) => projectWorkspaceOperations.deleteProjectWorkspaces(input),
  });
}
