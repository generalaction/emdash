import { defineContract, procedure } from '@emdash/wire/rpc';
import { z } from 'zod';
import type { ProviderRepositoryResult } from '@core/primitives/repository/api';

export const repositoryDomain = 'repository' as const;

export const repositoryContract = defineContract({
  resolveProvider: procedure({
    input: z.object({ projectId: z.string() }),
    output: z.custom<ProviderRepositoryResult>(),
  }),
});
