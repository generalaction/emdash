import {
  defineConflictPolicy,
  type AnyOperationDefinition,
  type ConflictPolicy,
} from '@emdash/core/primitives/kernel/api';
import { systemClock, type Clock } from '@emdash/shared/scheduling';
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
import type { AppDb } from '@core/services/app-db/node/db';
import type { OperationDefinition } from '@core/services/operations/node';

export type OperationDefinitionOptions = {
  db: AppDb;
  clock?: Clock;
  initiatedBy?: string;
  deleteAutomation: DeleteAutomationOperationDependencies;
  deleteProject: DeleteProjectOperationDependencies;
  deleteTask: DeleteTaskOperationDependencies;
  workspaceLifecycle: WorkspaceLifecycleDependencies;
  cleanupSessions: CleanupSessionsDependencies;
};

export type DesktopOperationDefinitions = {
  definitions: OperationDefinition[];
  conflictPolicies: readonly ConflictPolicy[];
};

export function createOperationDefinitions(
  options: OperationDefinitionOptions
): DesktopOperationDefinitions {
  const runtime = {
    db: options.db,
    clock: options.clock ?? systemClock,
    initiatedBy: options.initiatedBy,
  };
  const definitions = [
    ...deleteTaskOperationContribution.create(options.deleteTask, runtime),
    ...deleteAutomationOperationContribution.create(options.deleteAutomation, runtime),
    ...deleteWorkspaceOperationContribution.create(options.workspaceLifecycle, runtime),
    ...archiveWorkspaceOperationContribution.create(options.workspaceLifecycle, runtime),
    ...deleteProjectOperationContribution.create(options.deleteProject, runtime),
    ...cleanupSessionsOperationContribution.create(options.cleanupSessions, runtime),
  ];
  const policy = createDesktopConflictPolicy(
    definitions.map((definition) => definition.definition)
  );
  return { definitions, conflictPolicies: [policy] };
}

export function createDesktopConflictPolicy(definitions: readonly AnyOperationDefinition[]) {
  const byName = new Map(definitions.map((definition) => [definition.name, definition]));
  const get = (name: string) => {
    const definition = byName.get(name);
    if (!definition) throw new Error(`Missing operation definition '${name}'`);
    return definition;
  };
  return defineConflictPolicy((on) => {
    on(get('delete-task'), get('delete-task')).queue();
    on(get('delete-automation'), get('delete-automation')).queue();
    on(get('delete-workspace'), get('delete-workspace')).queue();
    on(get('archive-workspace'), get('archive-workspace')).queue();
    on(get('delete-project'), get('delete-project')).queue();
    on(get('cleanup-sessions'), get('cleanup-sessions')).queue();
    on(get('delete-task'), get('cleanup-sessions')).supersede();
    on(get('cleanup-sessions'), get('delete-task')).reject();
    on(get('delete-workspace'), get('delete-task')).queue();
    on(get('delete-task'), get('delete-workspace')).queue();
    on(get('archive-workspace'), get('delete-task')).queue();
    on(get('delete-task'), get('archive-workspace')).queue();
    on(get('archive-workspace'), get('delete-workspace')).queue();
    on(get('delete-workspace'), get('archive-workspace')).queue();
    on(get('delete-project'), get('delete-task')).queue();
    on(get('delete-task'), get('delete-project')).queue();
    on(get('delete-project'), get('delete-workspace')).queue();
    on(get('delete-workspace'), get('delete-project')).queue();
    on(get('delete-project'), get('archive-workspace')).queue();
    on(get('archive-workspace'), get('delete-project')).queue();
    on(get('delete-project'), get('cleanup-sessions')).queue();
    on(get('cleanup-sessions'), get('delete-project')).queue();
    on(get('delete-workspace'), get('cleanup-sessions')).queue();
    on(get('cleanup-sessions'), get('delete-workspace')).queue();
    on(get('archive-workspace'), get('cleanup-sessions')).queue();
    on(get('cleanup-sessions'), get('archive-workspace')).queue();
    on(get('delete-project'), get('delete-automation')).queue();
    on(get('delete-automation'), get('delete-project')).queue();
    on(get('cleanup-sessions'), get('delete-automation')).queue();
    on(get('delete-automation'), get('cleanup-sessions')).queue();
  });
}
