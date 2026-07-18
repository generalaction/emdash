import {
  TASK_COMMAND_DEFS,
  TASK_LIST_COMMAND_DEFS,
} from '@core/features/tasks/contributions/commands';
import { WORKBENCH_COMMAND_DEFS } from '@core/features/workbench/contributions/commands';
import { defineCommandCatalog } from '@core/primitives/commands/api';

export const COMMAND_CATALOG = defineCommandCatalog([
  ...WORKBENCH_COMMAND_DEFS,
  ...TASK_COMMAND_DEFS,
  ...TASK_LIST_COMMAND_DEFS,
] as const);

export type CommandId = (typeof COMMAND_CATALOG.defs)[number]['id'];
