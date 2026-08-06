import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import type { Scope } from '@emdash/shared/concurrency';
import { createController, type Controller } from '@emdash/wire/rpc';
import { expose, family, query } from '@emdash/wire/state';
import type { ProjectSessionManager } from '@core/features/projects/api/node/project-manager';
import type { WorkspaceIdentityService } from '@core/features/workspaces/api/node/workspace-identity-service';
import type {
  HostWorkspaceGroupsData,
  ProjectWorkspacesResult,
} from '@core/primitives/workspaces/api';
import { appDbPokes, matchProject } from '@core/services/app-db/node/pokes';
import { projectSettingsContract, projectWorkspacesContract } from '../api';
import type { WorkspaceGroupsHostKey } from './operations/list-host-workspace-groups';
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

export type ProjectWorkspacesWireController = {
  controller: Controller;
  dispose(): Promise<void>;
};

/**
 * Mirror-served workspace lists as live models (planning ticket 09): the registry
 * sync pokes `appDbPokes.workspaces` on every applied snapshot, so both families
 * re-query the mirror and stream updates — the renderer never polls.
 */
export function createProjectWorkspacesWireController(
  dependencies: ProjectWorkspaceOperationDependencies
): ProjectWorkspacesWireController {
  const projectWorkspaceOperations = createProjectWorkspaceOperations(dependencies);

  const projectListFamily = family(
    ({ projectId }: { projectId: string }, scope) =>
      query<ProjectWorkspacesResult>({
        fetch: () => projectWorkspaceOperations.listProjectWorkspaces(projectId),
        pokes: [
          appDbPokes.workspaces.subscription(matchProject(projectId)),
          appDbPokes.tasks.subscription(matchProject(projectId)),
        ],
        scope,
      }),
    { name: 'project-workspace-list' }
  );
  const groupsFamily = family(
    ({ hostKey }: { hostKey: string }, scope) =>
      query<HostWorkspaceGroupsData>({
        fetch: () =>
          projectWorkspaceOperations.listHostWorkspaceGroups(hostKey as WorkspaceGroupsHostKey),
        pokes: [
          appDbPokes.workspaces.subscription(() => true),
          appDbPokes.tasks.subscription(() => true),
          appDbPokes.projects.subscription(() => true),
        ],
        scope,
      }),
    { name: 'workspace-groups' }
  );

  const projectListProvider = expose(projectWorkspacesContract.projectWorkspaceList, {
    list: (key: { projectId: string }, scope: Scope) => {
      scope.add(projectListFamily.retain(key));
      return projectListFamily(key);
    },
  });
  const groupsProvider = expose(projectWorkspacesContract.workspaceGroups, {
    list: (key: { hostKey: string }, scope: Scope) => {
      scope.add(groupsFamily.retain(key));
      return groupsFamily(key);
    },
  });

  return {
    controller: createController(projectWorkspacesContract, {
      projectWorkspaceList: projectListProvider,
      workspaceGroups: groupsProvider,
      measureProjectWorkspaces: (input) =>
        projectWorkspaceOperations.measureProjectWorkspaces(input),
      deleteProjectWorkspaces: (input) => projectWorkspaceOperations.deleteProjectWorkspaces(input),
    }),
    async dispose() {
      await projectListProvider.dispose();
      await groupsProvider.dispose();
      await projectListFamily.dispose();
      await groupsFamily.dispose();
    },
  };
}
