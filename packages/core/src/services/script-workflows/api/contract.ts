import { defineContract, liveJob } from '@emdash/wire/rpc';
import {
  runScriptWorkflowInputSchema,
  scriptWorkflowErrorSchema,
  scriptWorkflowProgressSchema,
  scriptWorkflowResultSchema,
} from './schemas';

export const scriptWorkflowsDefinitions = {
  runWorkflow: liveJob({
    input: runScriptWorkflowInputSchema,
    progress: scriptWorkflowProgressSchema,
    result: scriptWorkflowResultSchema,
    error: scriptWorkflowErrorSchema,
  }),
};

export const scriptWorkflowsContract = defineContract(scriptWorkflowsDefinitions);

export type ScriptWorkflowsContract = typeof scriptWorkflowsContract;
