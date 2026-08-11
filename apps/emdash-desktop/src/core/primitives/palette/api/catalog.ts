import type { CommandDef } from '@core/primitives/commands/api';
import type { PaletteItemDef } from './define-palette-item';

export interface PaletteCatalog<TItems extends readonly PaletteItemDef[]> {
  readonly items: TItems;
  byCommandId(id: string): TItems[number] | undefined;
}

export function definePaletteCatalog<const TItems extends readonly PaletteItemDef[]>(
  definitions: TItems
): PaletteCatalog<TItems> {
  const byCommandId = new Map<string, TItems[number]>();

  for (const definition of definitions) {
    const { command } = definition;
    if (byCommandId.has(command.id)) {
      throw new Error(`Duplicate palette command id: ${command.id}`);
    }
    if (!acceptsUndefinedInput(command)) {
      throw new Error(`Palette command must accept undefined input: ${command.id}`);
    }
    byCommandId.set(command.id, definition);
  }

  const items = Object.freeze([...definitions]) as unknown as TItems;
  return Object.freeze({
    items,
    byCommandId: (id: string) => byCommandId.get(id),
  });
}

function acceptsUndefinedInput(command: CommandDef): boolean {
  return command.input.safeParse(undefined).success;
}
