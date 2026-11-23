import { err, ok } from '@emdash/shared';
import { toIntegrationError } from '../../../integrations/helpers/error';
import type { ConnectedIntegrationHostContext } from '../../../integrations/host';
import { createJiraClient, readJiraCredentials } from '../../../integrations/impl/jira/client';
import type { JiraClient, JiraIssue } from '../../../integrations/impl/jira/types';
import { clampIssueLimit, normalizeSearchTerm } from '../../helpers/provider-inputs';
import { defineIssuesPlugin, registerIssuesPluginBehavior } from '../../plugin';
import type {
  IssueGetOpts,
  IssueGetResult,
  IssueListResult,
  IssueQueryOpts,
  IssueSearchOpts,
} from '../../types';
import { flattenAdf, toIssueData } from './mapper';

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
    if (opts.jql !== undefined) {
      // Enumerate identities first. Details are fetched independently by the sync,
      // so a malformed description or inaccessible issue cannot discard its peers.
      const issues = await listAllJql(client, opts.jql, sanitizedLimit);
      const site = parsedCredentials.data.siteUrl.replace(/\/$/, '');
      return ok(
        issues.map((issue) => ({
          identifier: issue.key,
          title: String(issue.fields?.summary ?? ''),
          url: `${site}/browse/${issue.key}`,
        }))
      );
    }
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
  issues: { listIssues, searchIssues, getIssue },
});

async function listAllJql(client: JiraClient, jql: string, pageSize: number): Promise<JiraIssue[]> {
  const issues: JiraIssue[] = [];
  const tokens = new Set<string>();
  let nextPageToken: string | undefined;
  do {
    const page = await client.issueSearch.searchForIssuesUsingJqlEnhancedSearchPost({
      jql,
      maxResults: pageSize,
      fields: ['summary'],
      ...(nextPageToken ? { nextPageToken } : {}),
    });
    issues.push(...(page.issues ?? []));
    nextPageToken = page.nextPageToken;
    if (nextPageToken && tokens.has(nextPageToken)) {
      throw new Error('Jira returned a repeated page token. Please retry the sync.');
    }
    if (nextPageToken) tokens.add(nextPageToken);
  } while (nextPageToken);
  return issues;
}

export async function getIssue(
  host: ConnectedIntegrationHostContext,
  opts: IssueGetOpts
): Promise<IssueGetResult> {
  const credentials = readJiraCredentials(host.credentials);
  if (!credentials.success) return credentials;
  const client = createJiraClient(credentials.data);
  try {
    const issue = toIssueData(
      await client.issues.getIssue({ issueIdOrKey: opts.identifier, fields: SEARCH_FIELDS }),
      credentials.data.siteUrl
    );
    const comments: string[] = [];
    let startAt = 0;
    for (;;) {
      const page = await client.issueComments.getComments({
        issueIdOrKey: opts.identifier,
        startAt,
        maxResults: 100,
        orderBy: 'created',
      });
      const entries = page.comments ?? [];
      for (const comment of entries) {
        comments.push(
          `### ${comment.author?.displayName ?? 'Unknown author'}${comment.created ? ` · ${comment.created}` : ''}\n\n${flattenAdf(comment.body)}`
        );
      }
      startAt += entries.length;
      if (
        page.total !== undefined ? startAt >= page.total : entries.length < (page.maxResults ?? 100)
      )
        break;
      if (entries.length === 0)
        throw new Error('Jira returned an incomplete comments page. Please retry.');
    }
    return ok({
      ...issue,
      context: [issue.description, '## Comments', ...comments].filter(Boolean).join('\n\n'),
    });
  } catch (error) {
    return err(
      toIntegrationError(error, 'Jira', 'Unable to fetch Jira issue details and comments.')
    );
  }
}
