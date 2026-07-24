import { scriptWorkflowStateSchema } from '@emdash/core/runtimes/terminals/api';
import { runtimeResolveErrorSchema } from '@emdash/core/services/runtime-broker/api';
import {
  scriptWorkflowProgressSchema,
  scriptWorkflowResultSchema,
  terminalErrorSchema,
  terminalSizeSchema,
} from '@emdash/core/services/script-workflows/api';
import { defineContract, fallible, liveJob, liveLog, liveModel, liveState } from '@emdash/wire';
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
  key: z.object({
    workspaceId: z.string(),
    terminalId: z.string(),
  }),
});

export const terminalShellAvailabilitySchema = z.object({
  id: terminalShellIdSchema,
  label: z.string(),
  isSystemDefault: z.boolean(),
  available: z.boolean(),
  reason: z.string().optional(),
});

export const terminalCreateResultSchema = z.object({
  terminal: terminalRecordSchema,
  key: terminalHydrateResultSchema.shape.key,
});

export const terminalRuntimeKeySchema = terminalHydrateResultSchema.shape.key;

export const terminalRuntimeDataInputSchema = terminalRuntimeKeySchema.extend({
  data: z.string(),
});

export const terminalRuntimeResizeInputSchema = terminalRuntimeKeySchema.merge(terminalSizeSchema);

export const terminalWorkspaceInputSchema = z.object({
  workspaceId: z.string(),
});

export const runTerminalScriptWorkflowInputSchema = z.object({
  projectId: z.string(),
  taskId: z.string(),
  workspaceId: z.string(),
  type: z.enum(['prepare', 'setup', 'run', 'teardown']),
});

export const terminalSliceErrorSchema = z.union([runtimeResolveErrorSchema, terminalErrorSchema]);

export const terminalsContract = defineContract({
  list: fallible({
    input: terminalTaskInputSchema,
    data: z.array(terminalRecordSchema),
    error: terminalSliceErrorSchema,
  }),
  create: fallible({
    input: terminalCreateInputSchema,
    data: terminalCreateResultSchema,
    error: terminalSliceErrorSchema,
  }),
  delete: fallible({
    input: terminalDeleteInputSchema,
    data: z.void(),
    error: terminalSliceErrorSchema,
  }),
  rename: fallible({
    input: terminalRenameInputSchema,
    data: z.void(),
    error: terminalSliceErrorSchema,
  }),
  hydrate: fallible({
    input: terminalHydrateInputSchema,
    data: terminalHydrateResultSchema,
    error: terminalSliceErrorSchema,
  }),
  getShellAvailability: fallible({
    input: z.void().optional(),
    data: z.array(terminalShellAvailabilitySchema),
    error: terminalSliceErrorSchema,
  }),
  runScriptWorkflow: liveJob({
    input: runTerminalScriptWorkflowInputSchema,
    progress: scriptWorkflowProgressSchema,
    result: scriptWorkflowResultSchema,
    error: terminalSliceErrorSchema,
  }),
  workflows: liveModel({
    key: terminalWorkspaceInputSchema,
    states: {
      state: liveState({ data: scriptWorkflowStateSchema.nullable() }),
    },
  }),
  output: liveLog({
    key: terminalRuntimeKeySchema,
  }),
  sendInput: fallible({
    input: terminalRuntimeDataInputSchema,
    data: z.void(),
    error: terminalSliceErrorSchema,
  }),
  resize: fallible({
    input: terminalRuntimeResizeInputSchema,
    data: z.void(),
    error: terminalSliceErrorSchema,
  }),
  kill: fallible({
    input: terminalRuntimeKeySchema,
    data: z.void(),
    error: terminalSliceErrorSchema,
  }),
  killScope: fallible({
    input: terminalWorkspaceInputSchema,
    data: z.void(),
    error: terminalSliceErrorSchema,
  }),
  detachScope: fallible({
    input: terminalWorkspaceInputSchema,
    data: z.void(),
    error: terminalSliceErrorSchema,
  }),
});

export type TerminalsContract = typeof terminalsContract;
export type TerminalCreateResult = z.infer<typeof terminalCreateResultSchema>;
export type TerminalHydrateResult = z.infer<typeof terminalHydrateResultSchema>;
export type TerminalRuntimeKey = z.infer<typeof terminalRuntimeKeySchema>;
export type RunTerminalScriptWorkflowInput = z.infer<typeof runTerminalScriptWorkflowInputSchema>;
export type TerminalSliceError = z.infer<typeof terminalSliceErrorSchema>;
