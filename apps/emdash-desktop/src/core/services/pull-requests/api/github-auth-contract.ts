import { defineContract, fallible } from '@emdash/wire/api';
import { z } from 'zod';

export const githubAuthErrorSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('auth_required'),
    host: z.string(),
    message: z.string(),
    hint: z.string().optional(),
  }),
  z.object({
    type: z.literal('account_not_found'),
    host: z.string(),
    accountId: z.string(),
    message: z.string(),
    hint: z.string().optional(),
  }),
  z.object({
    type: z.literal('account_host_mismatch'),
    host: z.string(),
    accountId: z.string(),
    accountHost: z.string(),
    message: z.string(),
    hint: z.string().optional(),
  }),
  z.object({
    type: z.literal('token_missing'),
    host: z.string(),
    accountId: z.string(),
    message: z.string(),
    hint: z.string().optional(),
  }),
]);

export const githubAuthContract = defineContract({
  resolveAuth: fallible({
    input: z.object({
      host: z.string(),
      accountId: z.string().optional(),
    }),
    data: z.object({
      token: z.string(),
      host: z.string(),
      apiBaseUrl: z.string(),
    }),
    error: githubAuthErrorSchema,
  }),
});

export type GitHubAuthContract = typeof githubAuthContract;
export type GitHubAuthError = z.infer<typeof githubAuthErrorSchema>;
