import { z } from 'zod';
import type { CommandDef } from '@core/primitives/commands/api';
import { defineViewScope } from '@core/primitives/view-scopes/api';
import { WORKBENCH_COMMAND_DEFS } from './commands';

/**
 * The manifest composition root supplies commands owned by other slices. This
 * keeps feature contribution modules from importing each other.
 */
export function defineWindowScope<const TAdditional extends readonly CommandDef[]>(
  additionalCommands: TAdditional
) {
  return defineViewScope({
    id: 'window',
    params: z.object({}),
    commands: [...WORKBENCH_COMMAND_DEFS, ...additionalCommands] as const,
    activation: 'logical',
  });
}
