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

const issuesDescriptorSchema = z.object({
  /**
   * Repository-scoped services (GitHub, GitLab, Forgejo) resolve issues per
   * repository; the host passes the resolved repository URL with every call.
   * Account-scoped services (Linear, Jira, ...) list across the account.
   */
  requiresRepositoryUrl: z.boolean(),
});

export type IssuesDescriptor = z.infer<typeof issuesDescriptorSchema>;

export type IIssuesBehavior = {
  listIssues(host: ConnectedIntegrationHostContext, opts: IssueQueryOpts): Promise<IssueListResult>;
  searchIssues(
    host: ConnectedIntegrationHostContext,
    opts: IssueSearchOpts
  ): Promise<IssueListResult>;
  /** Optional; the host derives get-issue support from this method's presence. */
  getIssue?(host: ConnectedIntegrationHostContext, opts: IssueGetOpts): Promise<IssueGetResult>;
};

export const issuesCapability = definePluginCapability<IIssuesBehavior>()(
  'issues',
  issuesDescriptorSchema
);
