import type { TaskService } from '@core/features/tasks/api/node/task-service';
import type { OperationsEngine } from '@core/services/operations/node';
import { deleteProjectWorkspaces } from './operations/delete-project-workspaces';
import { getProjectWorkspaceGitStats } from './operations/get-project-workspace-git-stats';
import type { ListProjectWorkspacesDependencies } from './operations/list-project-workspaces';
import { listProjectWorkspaces } from './operations/list-project-workspaces';
import { measureProjectWorkspaces } from './operations/measure-project-workspaces';
import type { WorkspaceScanCache } from './workspace-scan-cache';

export type ProjectWorkspaceOperationDependencies = ListProjectWorkspacesDependencies & {
  operations: OperationsEngine;
  taskService: Pick<TaskService, 'deleteTask'>;
  workspaceScanCache: WorkspaceScanCache;
};

export function createProjectWorkspaceOperations(
  dependencies: ProjectWorkspaceOperationDependencies
) {
  return {
    listProjectWorkspaces: (projectId: string) =>
      dependencies.workspaceScanCache.getOrRefresh(projectId, () =>
        listProjectWorkspaces(dependencies, projectId)
      ),
    measureProjectWorkspaces: (input: Parameters<typeof measureProjectWorkspaces>[1]) =>
      measureProjectWorkspaces(dependencies, input),
    getProjectWorkspaceGitStats: (input: Parameters<typeof getProjectWorkspaceGitStats>[1]) =>
      getProjectWorkspaceGitStats(dependencies, input),
    deleteProjectWorkspaces: (input: Parameters<typeof deleteProjectWorkspaces>[1]) =>
      deleteProjectWorkspaces(dependencies, input),
    invalidateWorkspaceScanCache: (input: { projectId?: string; path?: string }) => {
      if (input.projectId) {
        dependencies.workspaceScanCache.evict(input.projectId, input.path);
      } else if (input.path) {
        dependencies.workspaceScanCache.evictPath(input.path);
      }
    },
  };
}
