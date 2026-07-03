import { definePluginCapability } from '@emdash/shared/plugins';
import z from 'zod';
import type { ConnectedIntegrationHostContext } from '../../integrations/host';
import type {
  IssueGetOpts,
  IssueGetResult,
  IssueListResult,
  IssueQueryOpts,
  IssueSearchOpts,
} from '../types';

/**
 * Host-supplied context an issues plugin needs before it can operate.
 * Repository-scoped services (GitHub, GitLab, Forgejo) need `repositoryUrl`;
 * account-scoped services (Linear, Jira, ...) need nothing.
 */
export const issueRequiredInputSchema = z.enum(['repositoryUrl']);

export type IssueRequiredInput = z.infer<typeof issueRequiredInputSchema>;

const issuesDescriptorSchema = z.object({
  requiredInputs: z.array(issueRequiredInputSchema).default([]),
});

export type IssuesDescriptor = z.infer<typeof issuesDescriptorSchema>;

export type IIssuesBehavior = {
  listIssues(host: ConnectedIntegrationHostContext, opts: IssueQueryOpts): Promise<IssueListResult>;
  searchIssues(
    host: ConnectedIntegrationHostContext,
    opts: IssueSearchOpts
  ): Promise<IssueListResult>;
  getIssue?(host: ConnectedIntegrationHostContext, opts: IssueGetOpts): Promise<IssueGetResult>;
};

export const issuesCapability = definePluginCapability<IIssuesBehavior>()(
  'issues',
  issuesDescriptorSchema
);
