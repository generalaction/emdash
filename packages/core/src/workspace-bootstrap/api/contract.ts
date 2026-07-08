import { defineContract, fallible, liveJob, procedure } from '@emdash/wire';
import { z } from 'zod';
import {
  bootstrapInputSchema,
  bootstrapErrorSchema,
  planRejectionSchema,
  bootstrapProgressSchema,
  bootstrapResultSchema,
  validatePlanInputSchema,
  validatePlanResultSchema,
} from './schemas';

export const workspaceBootstrapContract = defineContract({
  capabilities: procedure({
    input: z.void().optional(),
    output: z.object({ stepKinds: z.array(z.string()) }),
  }),
  validatePlan: fallible({
    input: validatePlanInputSchema,
    data: validatePlanResultSchema,
    error: planRejectionSchema,
  }),
  bootstrap: liveJob({
    input: bootstrapInputSchema,
    progress: bootstrapProgressSchema,
    result: bootstrapResultSchema,
    error: bootstrapErrorSchema,
  }),
});
