import { TASK_PALETTE_ITEMS } from '@core/features/tasks/contributions/palette';
import { WORKBENCH_PALETTE_ITEMS } from '@core/features/workbench/contributions/palette';
import { definePaletteCatalog } from '@core/primitives/palette/api';
import { COMMAND_CATALOG } from './command-catalog';

const items = [...WORKBENCH_PALETTE_ITEMS, ...TASK_PALETTE_ITEMS] as const;

for (const item of items) {
  if (COMMAND_CATALOG.byId(item.command.id) !== item.command) {
    throw new Error(`Palette command is not in COMMAND_CATALOG: ${item.command.id}`);
  }
}

export const PALETTE_CATALOG = definePaletteCatalog(items);

export type PaletteCommandId = (typeof PALETTE_CATALOG.items)[number]['command']['id'];
