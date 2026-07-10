import {
  defineContract,
  fallible,
  liveJob,
  liveLog,
  liveModel,
  liveState,
  procedure,
} from '@emdash/wire';
import { z } from 'zod';
import {
  bootstrapErrorSchema,
  bootstrapProgressSchema,
  bootstrapResultSchema,
  lifecycleStateSchema,
  listWorkspacesInputSchema,
  planRejectionSchema,
  runPhaseInputSchema,
  stepOutputKeySchema,
  validatePlanInputSchema,
  validatePlanResultSchema,
  workspaceListEntrySchema,
  workspaceLifecycleKeySchema,
  workspaceRefSchema,
} from './schemas';

export const workspaceLifecycleContract = defineContract({
  capabilities: procedure({
    input: z.void().optional(),
    output: z.object({ stepKinds: z.array(z.string()) }),
  }),
  validatePlan: fallible({
    input: validatePlanInputSchema,
    data: validatePlanResultSchema,
    error: planRejectionSchema,
  }),
  workspace: liveModel({
    key: workspaceLifecycleKeySchema,
    states: {
      lifecycle: liveState({ data: lifecycleStateSchema }),
    },
  }),
  refresh: fallible({
    input: workspaceRefSchema,
    data: lifecycleStateSchema,
    error: bootstrapErrorSchema,
  }),
  listWorkspaces: fallible({
    input: listWorkspacesInputSchema,
    data: z.array(workspaceListEntrySchema),
    error: bootstrapErrorSchema,
  }),
  runPhase: liveJob({
    input: runPhaseInputSchema,
    progress: bootstrapProgressSchema,
    result: bootstrapResultSchema,
    error: bootstrapErrorSchema,
  }),
  stepOutput: liveLog({ key: stepOutputKeySchema }),
});
