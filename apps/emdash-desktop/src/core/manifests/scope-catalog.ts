import { deleteSelectedTasksCommand } from '@core/features/tasks/contributions/commands';
import { taskViewScope } from '@core/features/tasks/contributions/scopes';
import { defineWindowScope } from '@core/features/workbench/contributions/scopes';
import { COMMAND_CATALOG } from './command-catalog';

export const windowScope = defineWindowScope([deleteSelectedTasksCommand] as const);

export const SCOPE_CATALOG = [windowScope, taskViewScope] as const;

const catalogCommands = new Set(COMMAND_CATALOG.defs);
for (const scope of SCOPE_CATALOG) {
  const unknownCommands = scope.commands.filter((command) => !catalogCommands.has(command));
  if (unknownCommands.length > 0) {
    throw new Error(
      `View scope ${scope.id} declares commands outside COMMAND_CATALOG: ${unknownCommands
        .map((command) => command.id)
        .join(', ')}`
    );
  }
}

export type ViewScopeId = (typeof SCOPE_CATALOG)[number]['id'];
