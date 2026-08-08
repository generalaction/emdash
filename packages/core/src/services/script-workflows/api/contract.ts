import { defineContract, liveJob } from '@emdash/wire/rpc';
import {
  runScriptWorkflowInputSchema,
  scriptWorkflowProgressSchema,
  scriptWorkflowResultSchema,
  terminalErrorSchema,
} from './schemas';

export const scriptWorkflowsDefinitions = {
  runWorkflow: liveJob({
    input: runScriptWorkflowInputSchema,
    progress: scriptWorkflowProgressSchema,
    result: scriptWorkflowResultSchema,
    error: terminalErrorSchema,
  }),
};

export const scriptWorkflowsContract = defineContract(scriptWorkflowsDefinitions);

export type ScriptWorkflowsContract = typeof scriptWorkflowsContract;
