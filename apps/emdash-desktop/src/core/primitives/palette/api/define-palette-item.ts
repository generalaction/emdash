import type { CommandDef } from '@core/primitives/commands/api';

export interface PaletteItemDef<TCommand extends CommandDef = CommandDef> {
  readonly command: TCommand;
  readonly group?: string;
  readonly keywords?: readonly string[];
  readonly rank?: number;
}

export interface DefinePaletteItemOptions<TCommand extends CommandDef> {
  readonly command: TCommand;
  readonly group?: string;
  readonly keywords?: readonly string[];
  readonly rank?: number;
}

export function definePaletteItem<TCommand extends CommandDef>(
  options: DefinePaletteItemOptions<TCommand>
): PaletteItemDef<TCommand> {
  return Object.freeze({
    command: options.command,
    group: options.group,
    keywords: Object.freeze([...(options.keywords ?? [])]),
    rank: options.rank ?? 0,
  });
}
