import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { nextTaskCommand, previousTaskCommand } from '@core/features/tasks/contributions/commands';
import {
  navigateBackCommand,
  navigateForwardCommand,
  toggleThemeCommand,
} from '@core/features/workbench/contributions/commands';
import { defineCommand, defineCommandCatalog } from '@core/primitives/commands/api';
import {
  defineCommandPaletteCatalog,
  defineCommandPaletteItem,
  definePaletteCatalog,
  definePaletteItem,
} from '@core/primitives/palette/api';
import { COMMAND_CATALOG } from './command-catalog';
import { COMMAND_PALETTE_CATALOG } from './command-palette-catalog';
import { PALETTE_CATALOG } from './palette-catalog';

describe('PALETTE_CATALOG', () => {
  it('contains only commands from COMMAND_CATALOG', () => {
    for (const item of PALETTE_CATALOG.items) {
      expect(COMMAND_CATALOG.byId(item.command.id)).toBe(item.command);
      expect(PALETTE_CATALOG.byCommandId(item.command.id)).toBe(item);
    }
  });

  it('excludes keyboard-only navigation commands', () => {
    for (const command of [
      navigateBackCommand,
      navigateForwardCommand,
      nextTaskCommand,
      previousTaskCommand,
    ]) {
      expect(PALETTE_CATALOG.byCommandId(command.id), command.id).toBeUndefined();
    }
  });
});

describe('definePaletteCatalog', () => {
  const command = defineCommand({
    id: 'test.palette',
    title: 'Palette test',
    category: 'Test',
  });

  it('rejects duplicate command ids', () => {
    const item = definePaletteItem({ command });
    expect(() => definePaletteCatalog([item, item])).toThrowError(
      'Duplicate palette command id: test.palette'
    );
  });

  it('rejects commands that require input', () => {
    const inputCommand = defineCommand({
      id: 'test.paletteInput',
      title: 'Palette input test',
      category: 'Test',
      input: z.string(),
    });
    expect(() => definePaletteCatalog([definePaletteItem({ command: inputCommand })])).toThrowError(
      'Palette command must accept undefined input: test.paletteInput'
    );
  });
});

describe('COMMAND_PALETTE_CATALOG', () => {
  it('contains only the registered command identities', () => {
    for (const item of COMMAND_PALETTE_CATALOG.items) {
      expect(COMMAND_CATALOG.byId(item.command.id)).toBe(item.command);
      expect(COMMAND_PALETTE_CATALOG.byCommandId(item.command.id)).toBe(item);
    }
  });

  it('contributes Toggle Theme appearance aliases', () => {
    expect(COMMAND_PALETTE_CATALOG.byCommandId(toggleThemeCommand.id)?.aliases).toEqual([
      'appearance',
      'color scheme',
      'dark mode',
      'light mode',
    ]);
  });
});

describe('defineCommandPaletteCatalog', () => {
  const command = defineCommand({
    id: 'test.commandPalette',
    title: 'Command palette test',
    category: 'Test',
  });
  const commands = defineCommandCatalog([command]);

  it('rejects duplicate command ids', () => {
    const item = defineCommandPaletteItem({ command });
    expect(() => defineCommandPaletteCatalog(commands, [item, item])).toThrowError(
      'Duplicate command palette command id: test.commandPalette'
    );
  });

  it('rejects a different command identity with a registered id', () => {
    const foreignCommand = defineCommand({
      id: command.id,
      title: 'Foreign command',
      category: 'Test',
    });

    expect(() =>
      defineCommandPaletteCatalog(commands, [defineCommandPaletteItem({ command: foreignCommand })])
    ).toThrowError('Command palette command is not in command catalog: test.commandPalette');
  });

  it('rejects commands that require input', () => {
    const inputCommand = defineCommand({
      id: 'test.commandPaletteInput',
      title: 'Command palette input test',
      category: 'Test',
      input: z.string(),
    });
    const inputCommands = defineCommandCatalog([inputCommand]);

    expect(() =>
      defineCommandPaletteCatalog(inputCommands, [
        defineCommandPaletteItem({ command: inputCommand }),
      ])
    ).toThrowError('Command palette command must accept undefined input: test.commandPaletteInput');
  });
});
