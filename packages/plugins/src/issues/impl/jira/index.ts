import { err, ok } from '@emdash/shared';
import { toIntegrationError } from '../../../integrations/helpers/error';
import type { IntegrationCredentials } from '../../../integrations/host';
import { createJiraClient, readJiraCredentials } from '../../../integrations/impl/jira/client';
import type { JiraClient, JiraIssue } from '../../../integrations/impl/jira/types';
import { clampIssueLimit, normalizeSearchTerm } from '../../helpers/provider-inputs';
import { defineIssuesPlugin, registerIssuesPluginBehavior } from '../../plugin';
import type { IssueListResult } from '../../types';
import { toIssueData } from './mapper';

const SEARCH_FIELDS = ['summary', 'description', 'updated', 'project', 'status', 'assignee'];
const JIRA_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;
const LIST_JQL = 'updated >= -90d ORDER BY updated DESC';

export async function listIssues(
  credentials: IntegrationCredentials,
  limit: number
): Promise<IssueListResult> {
  const parsedCredentials = readJiraCredentials(credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);

  const client = createJiraClient(parsedCredentials.data);
  const sanitizedLimit = clampIssueLimit(limit, 50, 500);

  try {
    const issues = await searchJql(client, LIST_JQL, sanitizedLimit);
    return ok(issues.map((issue) => toIssueData(issue, parsedCredentials.data.siteUrl)));
  } catch (error) {
    return err(toIntegrationError(error, 'Jira'));
  }
}

export async function searchIssues(
  credentials: IntegrationCredentials,
  searchTerm: string,
  limit: number
): Promise<IssueListResult> {
  const term = normalizeSearchTerm(searchTerm);
  if (!term) return ok([]);

  const parsedCredentials = readJiraCredentials(credentials);
  if (!parsedCredentials.success) return err(parsedCredentials.error);

  const client = createJiraClient(parsedCredentials.data);

  try {
    const escapedTerm = term.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const jql = JIRA_KEY_PATTERN.test(term)
      ? `(key = "${escapedTerm}" OR text ~ "${escapedTerm}") ORDER BY updated DESC`
      : `text ~ "${escapedTerm}" ORDER BY updated DESC`;
    const issues = await searchJql(client, jql, clampIssueLimit(limit, 20, 500));

    return ok(issues.map((issue) => toIssueData(issue, parsedCredentials.data.siteUrl)));
  } catch (error) {
    return err(toIntegrationError(error, 'Jira'));
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
  issues: {
    listIssues: (host, opts) => listIssues(host.credentials, opts.limit),
    searchIssues: (host, opts) => searchIssues(host.credentials, opts.searchTerm, opts.limit),
  },
});
