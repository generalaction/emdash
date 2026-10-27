import { err, ok } from '@emdash/shared';
import { toIntegrationError } from '../../../integrations/helpers/error';
import type { ConnectedIntegrationHostContext } from '../../../integrations/host';
import { createJiraClient, readJiraCredentials } from '../../../integrations/impl/jira/client';
import type { JiraClient, JiraIssue } from '../../../integrations/impl/jira/types';
import { clampIssueLimit, normalizeSearchTerm } from '../../helpers/provider-inputs';
import { defineIssuesPlugin, registerIssuesPluginBehavior } from '../../plugin';
import type { IssueListResult, IssueQueryOpts, IssueSearchOpts } from '../../types';
import { toIssueData } from './mapper';

const SEARCH_FIELDS = ['summary', 'description', 'updated', 'project', 'status', 'assignee'];
const JIRA_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;
const LIST_JQL = 'updated >= -90d ORDER BY updated DESC';

export async function listIssues(
  host: ConnectedIntegrationHostContext,
  opts: IssueQueryOpts
): Promise<IssueListResult> {
  const parsedCredentials = readJiraCredentials(host.credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);

  const client = createJiraClient(parsedCredentials.data);
  const sanitizedLimit = clampIssueLimit(opts.limit, 50, 500);

  try {
    const issues = await searchJql(client, LIST_JQL, sanitizedLimit);
    return ok(issues.map((issue) => toIssueData(issue, parsedCredentials.data.siteUrl)));
  } catch (error) {
    host.log.warn('Jira listIssues failed', { error });
    return err(toIntegrationError(error, 'Jira', 'Unable to fetch Jira issues.'));
  }
}

export async function searchIssues(
  host: ConnectedIntegrationHostContext,
  opts: IssueSearchOpts
): Promise<IssueListResult> {
  const term = normalizeSearchTerm(opts.searchTerm);
  if (!term) return ok([]);

  const parsedCredentials = readJiraCredentials(host.credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);

  const client = createJiraClient(parsedCredentials.data);

  try {
    const escapedTerm = term.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const jql = JIRA_KEY_PATTERN.test(term)
      ? `(key = "${escapedTerm}" OR text ~ "${escapedTerm}") ORDER BY updated DESC`
      : `text ~ "${escapedTerm}" ORDER BY updated DESC`;
    const issues = await searchJql(client, jql, clampIssueLimit(opts.limit, 20, 500));

    return ok(issues.map((issue) => toIssueData(issue, parsedCredentials.data.siteUrl)));
  } catch (error) {
    host.log.warn('Jira searchIssues failed', { error });
    return err(toIntegrationError(error, 'Jira', 'Unable to search Jira issues.'));
  }
}

async function searchJql(client: JiraClient, jql: string, limit: number): Promise<JiraIssue[]> {
  const response = await client.issueSearch.searchForIssuesUsingJqlEnhancedSearchPost({
    jql,
    maxResults: limit,
    fields: SEARCH_FIELDS,
  });
  return response.issues ?? [];
}

const plugin = defineIssuesPlugin({ integrationId: 'jira' }, { issues: {} }, {});

export const provider = registerIssuesPluginBehavior(plugin, {
  issues: { listIssues, searchIssues },
});
