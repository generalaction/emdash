import { defineContract, procedure } from '@emdash/wire';
import { z } from 'zod';
import type { ProviderRepositoryResult } from '@core/primitives/repository/api';

export const repositoryContract = defineContract({
  resolveProvider: procedure({
    input: z.object({ projectId: z.string() }),
    output: z.custom<ProviderRepositoryResult>(),
  }),
});
