import {
  createDeleteAutomationOperationDefinition,
  type DeleteAutomationOperationDependencies,
} from '@core/features/automations/node/operations/delete-automation-definition';
import {
  createDeleteProjectOperationDefinition,
  type DeleteProjectOperationDependencies,
} from '@core/features/projects/node/operations/delete-project-definition';
import {
  createDeleteTaskOperationDefinition,
  type DeleteTaskOperationDependencies,
} from '@core/features/tasks/node/operations/delete-task-definition';
import {
  createCleanupSessionsOperationDefinition,
  type CleanupSessionsDependencies,
} from '@core/features/workspaces/node/operations/cleanup-sessions-definition';
import {
  createArchiveWorkspaceOperationDefinition,
  createDeleteWorkspaceOperationDefinition,
  type WorkspaceLifecycleDependencies,
} from '@core/features/workspaces/node/operations/workspace-lifecycle-definitions';
import type { OperationDefinition } from '@core/services/operations/node';

export type OperationDefinitionOptions = {
  deleteAutomation: DeleteAutomationOperationDependencies;
  deleteProject: DeleteProjectOperationDependencies;
  deleteTask: DeleteTaskOperationDependencies;
  workspaceLifecycle: WorkspaceLifecycleDependencies;
  cleanupSessions: CleanupSessionsDependencies;
};

export function createOperationDefinitions(
  options: OperationDefinitionOptions
): OperationDefinition[] {
  return [
    createDeleteTaskOperationDefinition(options.deleteTask),
    createDeleteAutomationOperationDefinition(options.deleteAutomation),
    createDeleteWorkspaceOperationDefinition(options.workspaceLifecycle),
    createArchiveWorkspaceOperationDefinition(options.workspaceLifecycle),
    createDeleteProjectOperationDefinition(options.deleteProject),
    createCleanupSessionsOperationDefinition(options.cleanupSessions),
  ];
}
