import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import { createController, type Controller } from '@emdash/wire/api';
import type { ProjectSessionManager } from '@core/features/projects/api/node/project-manager';
import type { WorkspaceIdentityService } from '@core/features/workspaces/api/node/workspace-identity-service';
import { projectSettingsContract, projectWorkspacesContract } from '../api';
import { createProjectSettingsOperations } from './project-settings-controller';
import {
  createProjectWorkspaceOperations,
  type ProjectWorkspaceOperationDependencies,
} from './project-workspaces-controller';

export function createProjectSettingsWireController(dependencies: {
  projects: Pick<ProjectSessionManager, 'getProject'>;
  runtimes: RuntimeBroker;
  workspaceIdentity: WorkspaceIdentityService;
}): Controller {
  const projectSettingsOperations = createProjectSettingsOperations(dependencies);
  return createController(projectSettingsContract, {
    getSettings: ({ workspaceId }) => projectSettingsOperations.getSettings(workspaceId),
  });
}

export function createProjectWorkspacesWireController(
  dependencies: ProjectWorkspaceOperationDependencies
): Controller {
  const projectWorkspaceOperations = createProjectWorkspaceOperations(dependencies);
  return createController(projectWorkspacesContract, {
    listProjectWorkspaces: ({ projectId }) =>
      projectWorkspaceOperations.listProjectWorkspaces(projectId),
    measureProjectWorkspaces: (input) => projectWorkspaceOperations.measureProjectWorkspaces(input),
    deleteProjectWorkspaces: (input) => projectWorkspaceOperations.deleteProjectWorkspaces(input),
  });
}
