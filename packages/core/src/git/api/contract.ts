import { defineContract, fallible, liveJob, procedure } from '@emdash/wire';
import { z } from 'zod';
import { gitCheckoutContract } from '../checkout/contract';
import { gitRepositoryContract } from '../repository/api/contract';
import { ensureRepositoryOptionsSchema } from './commands';
import { cloneRepositoryErrorSchema, ensureRepositoryErrorSchema } from './errors';
import { cloneRepositoryJobInputSchema, transferProgressSchema } from './jobs';
import { gitPathInspectionSchema, gitRepositoryInfoSchema } from './queries';

/**
 * Git domain wire contract.
 *
 * Composes the machine-wide runtime endpoints (path inspection, repository
 * bootstrap, clone) with the scoped repository and checkout subdomain
 * contracts. Repository- and checkout-scoped work is reached under `repository`
 * and `checkout`; callers `open` a resource to obtain its key, attach to live
 * models / issue mutations / run reads against that key, then `close`.
 */
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
