import {
  defineConflictPolicy,
  type AnyOperationDefinition,
  type ConflictPolicy,
} from '@emdash/core/primitives/kernel/api';
import { systemClock, type Clock } from '@emdash/shared/scheduling';
import {
  deleteAutomationOperation,
  deleteAutomationOperationContribution,
  type DeleteAutomationOperationDependencies,
} from '@core/features/automations/node/operations/delete-automation-definition';
import {
  deleteProjectOperation,
  deleteProjectOperationContribution,
  type DeleteProjectOperationDependencies,
} from '@core/features/projects/node/operations/delete-project-definition';
import { deleteTaskOperation } from '@core/features/tasks/api/node/delete-task-operation';
import {
  deleteTaskOperationContribution,
  type DeleteTaskOperationDependencies,
} from '@core/features/tasks/node/operations/delete-task-definition';
import {
  hostCreateWorktreeOperation,
  hostReprovisionWorktreeOperation,
  hostRemoveRepositoryOperation,
  hostRemoveWorktreeOperation,
} from '@core/features/workspaces/api/node/host-outbox-operations';
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
  const policy = createDesktopConflictPolicy(definitions);
  return { definitions, conflictPolicies: [policy] };
}

export function createDesktopConflictPolicy(descriptors: readonly OperationDefinition[]) {
  const byName = new Map(
    descriptors.map((descriptor) => [descriptor.definition.name, descriptor.definition])
  );
  const get = (definition: AnyOperationDefinition) => {
    const registered = byName.get(definition.name);
    if (!registered) throw new Error(`Missing operation definition '${definition.name}'`);
    return registered;
  };
  const definitions = [
    deleteTaskOperation,
    deleteAutomationOperation,
    deleteProjectOperation,
    hostRemoveWorktreeOperation,
    hostCreateWorktreeOperation,
    hostReprovisionWorktreeOperation,
    hostRemoveRepositoryOperation,
  ];
  return defineConflictPolicy((on) => {
    // Keep this pairwise matrix explicit: future pairs may dedupe or supersede.
    for (const first of definitions) {
      for (const second of definitions) {
        const pair = on(get(first), get(second));
        if (
          first === hostReprovisionWorktreeOperation &&
          second === hostReprovisionWorktreeOperation
        ) {
          pair.reject();
        } else {
          pair.queue();
        }
      }
    }
  });
}
