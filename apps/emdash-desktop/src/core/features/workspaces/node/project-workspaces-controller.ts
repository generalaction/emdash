import type { TaskService } from '@core/features/tasks/api/node/task-service';
import type { OperationsEngine } from '@core/services/operations/node';
import { deleteProjectWorkspaces } from './operations/delete-project-workspaces';
import type { ListProjectWorkspacesDependencies } from './operations/list-project-workspaces';
import { listProjectWorkspaces } from './operations/list-project-workspaces';
import { measureProjectWorkspaces } from './operations/measure-project-workspaces';

export type ProjectWorkspaceOperationDependencies = ListProjectWorkspacesDependencies & {
  operations: OperationsEngine;
  taskService: Pick<TaskService, 'deleteTask'>;
};

export function createProjectWorkspaceOperations(
  dependencies: ProjectWorkspaceOperationDependencies
) {
  return {
    listProjectWorkspaces: (projectId: string) => listProjectWorkspaces(dependencies, projectId),
    measureProjectWorkspaces: (input: Parameters<typeof measureProjectWorkspaces>[1]) =>
      measureProjectWorkspaces(dependencies, input),
    deleteProjectWorkspaces: (input: Parameters<typeof deleteProjectWorkspaces>[1]) =>
      deleteProjectWorkspaces(dependencies, input),
  };
}
