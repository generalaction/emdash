import { URL } from 'node:url';
import { ISSUE_PROVIDER_CAPABILITIES, type IssueListResult } from '@shared/issue-providers';
import type { Issue } from '@shared/tasks';
import { normalizeSearchTerm } from '@main/core/issues/helpers/provider-inputs';
import type { IssueProvider } from '@main/core/issues/issue-provider';
import { jiraConnectionService } from './jira-connection-service';
import { jiraGet, jiraRequest } from './jira-http';

interface RawJiraIssueFields {
  summary?: string;
  description?: AdfNode | null;
  updated?: string | null;
  project?: { key?: string; name?: string } | null;
  status?: { name?: string } | null;
  assignee?: { displayName?: string; name?: string } | null;
}

interface RawJiraIssue {
  id?: string;
  key?: string;
  fields?: RawJiraIssueFields;
  errorMessages?: string[];
}

interface RawJiraSearchResult {
  issues?: RawJiraIssue[];
}

interface AdfNode {
  type?: string;
  text?: string;
  content?: AdfNode[];
}

interface JiraPickerSection {
  issues?: Array<{ key?: string }>;
}

interface JiraPickerResult {
  sections?: JiraPickerSection[];
}

let projectKeys: string[] = [];

async function listIssues(limit = 50): Promise<IssueListResult> {
  try {
    const { siteUrl, email, token } = await jiraConnectionService.requireAuth();
    const jqlCandidates = [
      'assignee = currentUser() ORDER BY updated DESC',
      'reporter = currentUser() ORDER BY updated DESC',
      'ORDER BY updated DESC',
    ];

    for (const jql of jqlCandidates) {
      try {
        const issues = await searchRaw(siteUrl, email, token, jql, limit);
        if (issues.length > 0) {
          return { success: true, issues: normalizeIssues(siteUrl, issues) };
        }
      } catch {
        // Try next candidate.
      }
    }

    try {
      const keys = await getRecentIssueKeys(siteUrl, email, token, limit);
      if (keys.length > 0) {
        const results: RawJiraIssue[] = [];
        for (const key of keys.slice(0, limit)) {
          try {
            const issue = await getIssueByKey(siteUrl, email, token, key);
            if (issue) {
              results.push(issue);
            }
          } catch {
            // Skip individual failures.
          }
        }

        if (results.length > 0) {
          return { success: true, issues: normalizeIssues(siteUrl, results) };
        }
      }
    } catch {
      // Ignore final fallback errors.
    }

    return { success: true, issues: [] };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function smartSearchIssues(searchTerm: string, limit = 20): Promise<IssueListResult> {
  const term = normalizeSearchTerm(searchTerm);
  if (!term) {
    return { success: true, issues: [] };
  }

  try {
    const { siteUrl, email, token } = await jiraConnectionService.requireAuth();

    const looksLikeKey = /^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(term);
    if (looksLikeKey) {
      const keyUpper = term.toUpperCase();
      try {
        const issue = await getIssueByKey(siteUrl, email, token, keyUpper);
        if (issue) {
          return { success: true, issues: normalizeIssues(siteUrl, [issue]) };
        }
      } catch {
        // Fall through to JQL search.
      }
    }

    const sanitized = term.replace(/"/g, '\\"');
    const extraKey = looksLikeKey ? ` OR issueKey = ${term.toUpperCase()}` : '';

    const isNumeric = /^\d+$/.test(term);
    if (isNumeric && projectKeys.length === 0) {
      projectKeys = await fetchProjectKeys(siteUrl, email, token);
    }

    const keyClause =
      isNumeric && projectKeys.length
        ? ` OR key IN (${projectKeys.map((projectKey) => `"${projectKey}-${term}"`).join(',')})`
        : '';

    const jql = `text ~ "${sanitized}"${extraKey}${keyClause}`;
    const data = await searchRaw(siteUrl, email, token, jql, limit);

    return { success: true, issues: normalizeIssues(siteUrl, data) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function searchRaw(
  siteUrl: string,
  email: string,
  token: string,
  jql: string,
  limit: number
): Promise<RawJiraIssue[]> {
  const url = new URL('/rest/api/3/search', siteUrl);
  const payload = JSON.stringify({
    jql,
    maxResults: Math.min(Math.max(limit, 1), 100),
    fields: ['summary', 'description', 'updated', 'project', 'status', 'assignee'],
  });

  const body = await jiraRequest(url, email, token, 'POST', payload, {
    'Content-Type': 'application/json',
  });

  const data = JSON.parse(body || '{}') as RawJiraSearchResult;
  return Array.isArray(data?.issues) ? data.issues : [];
}

async function fetchProjectKeys(siteUrl: string, email: string, token: string): Promise<string[]> {
  try {
    const url = new URL('/rest/api/3/project', siteUrl);
    const body = await jiraGet(url, email, token);
    const data = JSON.parse(body || '[]') as Array<{ key?: string }>;
    if (!Array.isArray(data)) return [];
    return data.map((project) => String(project?.key || '')).filter(Boolean);
  } catch {
    return [];
  }
}

async function getIssueByKey(
  siteUrl: string,
  email: string,
  token: string,
  key: string
): Promise<RawJiraIssue | null> {
  const url = new URL(`/rest/api/3/issue/${encodeURIComponent(key)}`, siteUrl);
  url.searchParams.set('fields', 'summary,description,updated,project,status,assignee');

  const body = await jiraGet(url, email, token);
  const data = JSON.parse(body || '{}') as RawJiraIssue;
  if (!data || data.errorMessages) {
    return null;
  }

  return data;
}

async function getRecentIssueKeys(
  siteUrl: string,
  email: string,
  token: string,
  limit: number
): Promise<string[]> {
  const url = new URL('/rest/api/3/issue/picker', siteUrl);
  url.searchParams.set('query', '');
  url.searchParams.set('currentJQL', '');

  const body = await jiraGet(url, email, token);
  const data = JSON.parse(body || '{}') as JiraPickerResult;

  const keys: string[] = [];
  const sections = Array.isArray(data?.sections) ? data.sections : [];
  for (const section of sections) {
    const issues = Array.isArray(section?.issues) ? section.issues : [];
    for (const issue of issues) {
      const key = String(issue?.key || '').trim();
      if (key && !keys.includes(key)) {
        keys.push(key);
      }
      if (keys.length >= limit) {
        break;
      }
    }
    if (keys.length >= limit) {
      break;
    }
  }

  return keys;
}

function flattenAdf(node: AdfNode | string | null | undefined): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text || '';

  if (Array.isArray(node.content)) {
    const parts = node.content.map((item) => flattenAdf(item));
    if (['doc', 'bulletList', 'orderedList'].includes(node.type ?? '')) {
      return parts.join('\n');
    }

    if (['paragraph', 'heading', 'listItem'].includes(node.type ?? '')) {
      return parts.join('');
    }

    return parts.join('');
  }

  return '';
}

function normalizeIssues(siteUrl: string, rawIssues: RawJiraIssue[]): Issue[] {
  const base = siteUrl.replace(/\/$/, '');

  return (rawIssues || []).map((item) => {
    const fields = item?.fields ?? {};
    return {
      provider: 'jira',
      identifier: String(item?.key || ''),
      title: String(fields?.summary || ''),
      url: `${base}/browse/${item?.key}`,
      description: fields?.description ? flattenAdf(fields.description) : undefined,
      status: fields?.status?.name ?? undefined,
      assignees:
        fields?.assignee?.displayName != null
          ? [fields.assignee.displayName ?? fields.assignee.name ?? ''].filter(Boolean)
          : undefined,
      project: fields?.project?.name ?? undefined,
      updatedAt: fields?.updated ?? undefined,
      fetchedAt: new Date().toISOString(),
    } satisfies Issue;
  });
}

export const jiraIssueProvider: IssueProvider = {
  type: 'jira',
  capabilities: ISSUE_PROVIDER_CAPABILITIES.jira,

  checkConnection: () => jiraConnectionService.checkConnection(),

  listIssues: async (opts) => listIssues(opts.limit ?? 50),

  searchIssues: async (opts) => smartSearchIssues(opts.searchTerm, opts.limit ?? 20),
};
