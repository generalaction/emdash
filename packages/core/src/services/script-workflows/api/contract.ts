import { defineContract, fallible, liveJob } from '@emdash/wire';
import { z } from 'zod';
import {
  runScriptWorkflowInputSchema,
  scriptWorkflowProgressSchema,
  scriptWorkflowResultSchema,
  terminalErrorSchema,
  terminalScopeInputSchema,
} from './schemas';

export const scriptWorkflowsDefinitions = {
  runWorkflow: liveJob({
    input: runScriptWorkflowInputSchema,
    progress: scriptWorkflowProgressSchema,
    result: scriptWorkflowResultSchema,
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
};

export const scriptWorkflowsContract = defineContract(scriptWorkflowsDefinitions);

export type ScriptWorkflowsContract = typeof scriptWorkflowsContract;
