import {
  deleteAutomationOperationContribution,
  type DeleteAutomationOperationDependencies,
} from '@core/features/automations/node/operations/delete-automation-definition';
import {
  deleteProjectOperationContribution,
  type DeleteProjectOperationDependencies,
} from '@core/features/projects/node/operations/delete-project-definition';
import {
  deleteTaskOperationContribution,
  type DeleteTaskOperationDependencies,
} from '@core/features/tasks/node/operations/delete-task-definition';
import {
  cleanupSessionsOperationContribution,
  type CleanupSessionsDependencies,
} from '@core/features/workspaces/node/operations/cleanup-sessions-definition';
import {
  archiveWorkspaceOperationContribution,
  deleteWorkspaceOperationContribution,
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
    createDefinition(deleteTaskOperationContribution, options.deleteTask),
    createDefinition(deleteAutomationOperationContribution, options.deleteAutomation),
    createDefinition(deleteWorkspaceOperationContribution, options.workspaceLifecycle),
    createDefinition(archiveWorkspaceOperationContribution, options.workspaceLifecycle),
    createDefinition(deleteProjectOperationContribution, options.deleteProject),
    createDefinition(cleanupSessionsOperationContribution, options.cleanupSessions),
  ];
}

function createDefinition<TDeps>(
  contribution: {
    payload: OperationDefinition['payloadSchema'];
    create(dependencies: TDeps): OperationDefinition;
  },
  dependencies: TDeps
): OperationDefinition {
  const definition = contribution.create(dependencies);
  return { ...definition, payloadSchema: contribution.payload };
}
