import type { ComponentType } from 'react';
import type { CommandDef } from '@core/primitives/commands/api';
import type { Chord } from '@core/primitives/keybindings/api';
import type { PaletteItemDef } from '@core/primitives/palette/api';
import type { BoundCommand } from '@core/primitives/view-scopes/api';

export interface PaletteRendererProps<TCommand extends CommandDef = CommandDef> {
  readonly item: PaletteItemDef<TCommand>;
  readonly bound: BoundCommand<TCommand>;
  readonly chord: Chord | null;
  readonly onSelect: () => void;
}

export type PaletteRenderer<TCommand extends CommandDef = CommandDef> = ComponentType<
  PaletteRendererProps<TCommand>
>;

const renderers = new Map<CommandDef, PaletteRenderer>();

export function registerPaletteRenderer<TCommand extends CommandDef>(
  command: TCommand,
  renderer: PaletteRenderer<TCommand>
): void {
  if (renderers.has(command)) {
    throw new Error(`Duplicate palette renderer: ${command.id}`);
  }
  renderers.set(command, renderer as PaletteRenderer);
}

export function getPaletteRenderer<TCommand extends CommandDef>(
  command: TCommand
): PaletteRenderer<TCommand> | undefined {
  return renderers.get(command) as PaletteRenderer<TCommand> | undefined;
}

export function unregisterPaletteRenderer(command: CommandDef): void {
  renderers.delete(command);
}
