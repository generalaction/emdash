import { defineContract, procedure } from '@emdash/wire/rpc';
import { z } from 'zod';
import type {
  ConnectionStatus,
  ConnectionStatusMap,
  IssueContextOpts,
  IssueContextResult,
  IssueListResult,
  IssueProviderType,
  IssueQueryOpts,
  IssueSearchOpts,
} from '@core/primitives/issue-providers/api';
import type { JiraSyncResult } from './jira-sync';

const voidInput = z.void();

export const issuesDomain = 'issues' as const;

export const issuesContract = defineContract({
  syncAssignedJiraIssues: procedure({
    input: z.object({ projectId: z.string().min(1) }),
    output: z.custom<JiraSyncResult>(),
    callTimeoutMs: 0,
  }),
  checkConnection: procedure({
    input: z.object({ provider: z.custom<IssueProviderType>() }),
    output: z.custom<ConnectionStatus>(),
  }),
  checkAllConnections: procedure({
    input: voidInput,
    output: z.custom<ConnectionStatusMap>(),
  }),
  listIssues: procedure({
    input: z.object({
      provider: z.custom<IssueProviderType>(),
      options: z.custom<IssueQueryOpts>(),
    }),
    output: z.custom<IssueListResult>(),
  }),
  searchIssues: procedure({
    input: z.object({
      provider: z.custom<IssueProviderType>(),
      options: z.custom<IssueSearchOpts>(),
    }),
    output: z.custom<IssueListResult>(),
  }),
  getIssueContext: procedure({
    input: z.object({
      provider: z.custom<IssueProviderType>(),
      options: z.custom<IssueContextOpts>(),
    }),
    output: z.custom<IssueContextResult>(),
  }),
});
