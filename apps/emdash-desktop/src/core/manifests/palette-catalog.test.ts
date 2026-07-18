import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { nextTaskCommand, previousTaskCommand } from '@core/features/tasks/contributions/commands';
import {
  navigateBackCommand,
  navigateForwardCommand,
} from '@core/features/workbench/contributions/commands';
import { COMMAND_CATALOG } from '@core/manifests/command-catalog';
import { defineCommand } from '@core/primitives/commands/api';
import { definePaletteCatalog, definePaletteItem } from '@core/primitives/palette/api';
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
