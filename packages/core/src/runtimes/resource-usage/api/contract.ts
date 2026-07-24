import { defineContract, procedure } from '@emdash/wire';
import { z } from 'zod';
import { resourceUsageSampleSchema } from './schemas';

export const resourceUsageContract = defineContract({
  sample: procedure({
    input: z.void().optional(),
    output: resourceUsageSampleSchema,
  }),
});

export type ResourceUsageContract = typeof resourceUsageContract;
