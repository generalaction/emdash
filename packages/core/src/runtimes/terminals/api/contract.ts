import { defineContract, fallible, liveJob, liveLog, liveModel, liveState } from '@emdash/wire';
import { z } from 'zod';
import {
  runScriptWorkflowInputSchema,
  scriptWorkflowProgressSchema,
  scriptWorkflowResultSchema,
  startTerminalInputSchema,
  scriptWorkflowStateSchema,
  terminalControlInputSchema,
  terminalDataInputSchema,
  terminalErrorSchema,
  terminalKeySchema,
  terminalResizeInputSchema,
  terminalScopeInputSchema,
  terminalSessionListSchema,
} from './schemas';

export const terminalsContract = defineContract({
  startTerminal: fallible({
    input: startTerminalInputSchema,
    data: z.void(),
    error: terminalErrorSchema,
  }),
  runWorkflow: liveJob({
    input: runScriptWorkflowInputSchema,
    progress: scriptWorkflowProgressSchema,
    result: scriptWorkflowResultSchema,
    error: terminalErrorSchema,
  }),
  workflows: liveModel({
    key: terminalScopeInputSchema,
    states: {
      state: liveState({ data: scriptWorkflowStateSchema.nullable() }),
    },
  }),
  output: liveLog({
    key: terminalKeySchema,
  }),
  sessions: liveModel({
    key: z.void().optional(),
    states: {
      list: liveState({ data: terminalSessionListSchema }),
    },
  }),
  sendInput: fallible({
    input: terminalDataInputSchema,
    data: z.void(),
    error: terminalErrorSchema,
  }),
  resize: fallible({
    input: terminalResizeInputSchema,
    data: z.void(),
    error: terminalErrorSchema,
  }),
  kill: fallible({
    input: terminalControlInputSchema,
    data: z.void(),
    error: terminalErrorSchema,
  }),
  killScope: fallible({
    input: terminalScopeInputSchema,
    data: z.void(),
    error: terminalErrorSchema,
  }),
  detachScope: fallible({
    input: terminalScopeInputSchema,
    data: z.void(),
    error: terminalErrorSchema,
  }),
});

export type TerminalsContract = typeof terminalsContract;
