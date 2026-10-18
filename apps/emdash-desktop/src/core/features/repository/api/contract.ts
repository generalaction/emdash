import type { Result } from '@emdash/shared';
import { defineContract, procedure } from '@emdash/wire/rpc';
import { z } from 'zod';
import type { ProjectAttachmentError } from '@core/features/projects/api';
import type { ProviderRepository, ProviderRepositoryError } from '@core/primitives/repository/api';

export type ProviderRepositoryResult = Result<
  ProviderRepository,
  ProviderRepositoryError | ProjectAttachmentError
>;

export const repositoryDomain = 'repository' as const;

export const repositoryContract = defineContract({
  resolveProvider: procedure({
    input: z.object({ projectId: z.string() }),
    output: z.custom<ProviderRepositoryResult>(),
  }),
  gitLabOwners: procedure({
    input: z.object({ accountId: z.string().min(1) }),
    output: z.custom<
      | { success: true; owners: { login: string; avatarUrl: string }[] }
      | { success: false; error: string }
    >(),
  }),
  gitLabCreate: procedure({
    input: z.object({
      accountId: z.string().min(1),
      owner: z.string().min(1),
      name: z.string().min(1),
      isPrivate: z.boolean(),
    }),
    output: z.custom<
      { success: true; cloneUrl: string; nameWithOwner: string } | { success: false; error: string }
    >(),
  }),
  gitLabDelete: procedure({
    input: z.object({
      accountId: z.string().min(1),
      owner: z.string().min(1),
      name: z.string().min(1),
    }),
    output: z.custom<{ success: true } | { success: false; error: string }>(),
  }),
});
