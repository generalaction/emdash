import { pullRequestAuthErrorSchema } from '@emdash/plugins/pull-requests/schemas';
import { defineContract, fallible } from '@emdash/wire/rpc';
import { z } from 'zod';

/**
 * The worker's per-sync identity request (spec: github-git-settings §8): the
 * worker names only *what* it is about to sync; the desktop answers *as whom*
 * through the blessed resolver and returns that account's integration and
 * credential record. Account changes apply on the next request — no persisted
 * binding, no refresh events.
 */
export const gitPlatformAuthContract = defineContract({
  resolveAuth: fallible({
    input: z.object({
      repositoryUrl: z.string(),
    }),
    data: z.object({
      integrationId: z.string(),
      /** Resolved account row id; used by the worker to key per-identity request lanes. */
      accountId: z.string().optional(),
      /** Opaque integration credential record, narrowed by the plugin's `credentialsSchema`. */
      credentials: z.record(z.string(), z.json()),
    }),
    error: pullRequestAuthErrorSchema,
  }),
});

export type GitPlatformAuthContract = typeof gitPlatformAuthContract;
