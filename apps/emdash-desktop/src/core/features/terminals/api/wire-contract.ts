import { terminalKeySchema } from '@emdash/core/runtimes/terminals/api';
import {
  terminalErrorSchema,
  terminalSizeSchema,
} from '@emdash/core/services/script-workflows/api';
import { defineContract, fallible } from '@emdash/wire';
import { z } from 'zod';
import { TERMINAL_SHELL_IDS } from '@core/primitives/terminals/api';

const terminalShellIdSchema = z.enum(TERMINAL_SHELL_IDS);

export const terminalRecordSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  taskId: z.string(),
  ssh: z.boolean().optional(),
  shellId: terminalShellIdSchema,
  name: z.string(),
});

export const terminalCreateInputSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  taskId: z.string(),
  name: z.string(),
  shell: terminalShellIdSchema.optional(),
  initialSize: terminalSizeSchema.optional(),
});

export const terminalTaskInputSchema = z.object({
  projectId: z.string(),
  taskId: z.string(),
});

export const terminalDeleteInputSchema = terminalTaskInputSchema.extend({
  terminalId: z.string(),
});

export const terminalHydrateInputSchema = terminalDeleteInputSchema.extend({
  initialSize: terminalSizeSchema.optional(),
});

export const terminalRenameInputSchema = z.object({
  terminalId: z.string(),
  name: z.string(),
});

export const terminalHydrateResultSchema = z.object({
  key: terminalKeySchema,
});

export const terminalCreateResultSchema = z.object({
  terminal: terminalRecordSchema,
  key: terminalKeySchema,
});

export const terminalShellAvailabilitySchema = z.object({
  id: terminalShellIdSchema,
  label: z.string(),
  isSystemDefault: z.boolean(),
  available: z.boolean(),
  reason: z.string().optional(),
});

export const terminalTabsWireContract = defineContract({
  list: fallible({
    input: terminalTaskInputSchema,
    data: z.array(terminalRecordSchema),
    error: terminalErrorSchema,
  }),
  create: fallible({
    input: terminalCreateInputSchema,
    data: terminalCreateResultSchema,
    error: terminalErrorSchema,
  }),
  delete: fallible({
    input: terminalDeleteInputSchema,
    data: z.void(),
    error: terminalErrorSchema,
  }),
  rename: fallible({
    input: terminalRenameInputSchema,
    data: z.void(),
    error: terminalErrorSchema,
  }),
  hydrate: fallible({
    input: terminalHydrateInputSchema,
    data: terminalHydrateResultSchema,
    error: terminalErrorSchema,
  }),
  getShellAvailability: fallible({
    input: z.void().optional(),
    data: z.array(terminalShellAvailabilitySchema),
    error: terminalErrorSchema,
  }),
});

export type TerminalTabsWireContract = typeof terminalTabsWireContract;
export type TerminalCreateResult = z.infer<typeof terminalCreateResultSchema>;
export type TerminalHydrateResult = z.infer<typeof terminalHydrateResultSchema>;
