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
  hostOutboxOperationContribution,
  type HostOutboxDependencies,
} from '@core/features/workspaces/node/operations/host-outbox-definitions';
import type { AppDb } from '@core/services/app-db/node/db';
import type { OperationDefinition } from '@core/services/operations/node';

export type OperationDefinitionOptions = {
  db: AppDb;
  clock?: Clock;
  initiatedBy?: string;
  deleteAutomation: DeleteAutomationOperationDependencies;
  deleteProject: DeleteProjectOperationDependencies;
  deleteTask: DeleteTaskOperationDependencies;
  hostOutbox: HostOutboxDependencies;
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
    ...deleteProjectOperationContribution.create(options.deleteProject, runtime),
    ...hostOutboxOperationContribution.create(options.hostOutbox, runtime),
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
  const names = [
    'delete-task',
    'delete-automation',
    'delete-project',
    'host-remove-worktree',
    'host-create-worktree',
    'host-remove-repository',
  ] as const;
  return defineConflictPolicy((on) => {
    // Every colliding pair queues: desktop deletions are fast and outbox
    // entries serialize per resource, so FIFO ordering is always safe.
    for (const first of names) {
      for (const second of names) {
        on(get(first), get(second)).queue();
      }
    }
  });
}
