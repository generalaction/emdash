import { defineContract, eventStream, procedure } from '@emdash/wire/rpc';
import { z } from 'zod';
import type {
  GitHubAuthResponse,
  GitHubEvent,
  GitHubImportCliAccountsResponse,
  GitHubOwner,
  GitHubRepo,
} from '@core/primitives/github/api';

type ActionResult = { success: true } | { success: false; error: string };
type OwnersResult = { success: true; owners: GitHubOwner[] } | { success: false; error: string };
type CreateRepositoryResult =
  | {
      success: true;
      repoUrl: string;
      cloneUrl: string;
      nameWithOwner: string;
      defaultBranch: string;
    }
  | { success: false; error: string };

const voidInput = z.void();

export const githubDomain = 'github' as const;

export const githubContract = defineContract({
  auth: procedure({ input: voidInput, output: z.custom<GitHubAuthResponse>() }),
  importCliAccounts: procedure({
    input: voidInput,
    output: z.custom<GitHubImportCliAccountsResponse>(),
  }),
  authCancel: procedure({ input: voidInput, output: z.custom<ActionResult>() }),
  getRepositories: procedure({
    input: z.object({ accountId: z.string().optional() }),
    output: z.array(z.custom<GitHubRepo>()),
  }),
  getOwners: procedure({
    input: z.object({ accountId: z.string().optional() }),
    output: z.custom<OwnersResult>(),
  }),
  createRepository: procedure({
    input: z.object({
      name: z.string(),
      owner: z.string(),
      description: z.string().optional(),
      isPrivate: z.boolean().optional(),
      visibility: z.enum(['public', 'private']).optional(),
      accountId: z.string().nullable().optional(),
    }),
    output: z.custom<CreateRepositoryResult>(),
  }),
  deleteRepository: procedure({
    input: z.object({
      owner: z.string(),
      name: z.string(),
      accountId: z.string().nullable().optional(),
    }),
    output: z.custom<ActionResult>(),
  }),
  events: eventStream({ key: z.void(), event: z.custom<GitHubEvent>() }),
});
