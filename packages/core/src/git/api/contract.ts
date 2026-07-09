import { defineContract, fallible, liveJob, procedure } from '@emdash/wire';
import { z } from 'zod';
import { gitCheckoutContract } from '../checkout/contract';
import { gitRepositoryContract } from '../repository/contract';
import { cloneRepositoryErrorSchema, ensureRepositoryErrorSchema } from './errors';
import {
  cloneRepositoryJobInputSchema,
  ensureRepositoryOptionsSchema,
  gitPathInspectionSchema,
  gitRepositoryInfoSchema,
  transferProgressSchema,
} from './schemas';

export const gitContract = defineContract({
  inspectPath: procedure({
    input: z.object({ path: z.string() }),
    output: gitPathInspectionSchema,
  }),
  ensureRepository: fallible({
    input: z.object({ path: z.string(), options: ensureRepositoryOptionsSchema.optional() }),
    data: gitRepositoryInfoSchema,
    error: ensureRepositoryErrorSchema,
  }),
  cloneRepository: liveJob({
    input: cloneRepositoryJobInputSchema,
    progress: transferProgressSchema,
    result: gitRepositoryInfoSchema,
    error: cloneRepositoryErrorSchema,
  }),

  repository: gitRepositoryContract,
  checkout: gitCheckoutContract,
});

export type GitContract = typeof gitContract;
