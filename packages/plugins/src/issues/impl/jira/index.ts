import { err, ok } from '@emdash/shared';
import { doJiraGet, doJiraPost, readJiraCredentials } from '../../../integrations/impl/jira/client';
import { clampIssueLimit, issueError, normalizeSearchTerm } from '../../helpers/provider-inputs';
import { defineIssuesPlugin, registerIssuesPluginBehavior } from '../../plugin';
import type { IssueData, IssueListResult } from '../../types';

type RawJiraIssueFields = {
  summary?: string;
  description?: AdfNode | null;
  updated?: string | null;
  project?: { key?: string; name?: string } | null;
  status?: { name?: string } | null;
  assignee?: { displayName?: string; name?: string } | null;
};

type RawJiraIssue = {
  id?: string;
  key?: string;
  fields?: RawJiraIssueFields;
  errorMessages?: string[];
};

type RawJiraSearchResult = {
  issues?: RawJiraIssue[];
  nextPageToken?: string;
  isLast?: boolean;
};

type AdfNode = {
  type?: string;
  text?: string;
  content?: AdfNode[];
};

type JiraPickerSection = {
  issues?: Array<{ key?: string }>;
};

type JiraPickerResult = {
  sections?: JiraPickerSection[];
};

let projectKeys: string[] = [];

const SEARCH_FIELDS = ['summary', 'description', 'updated', 'project', 'status', 'assignee'];
const PAGE_SIZE = 100;
const JIRA_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

const plugin = defineIssuesPlugin({ integrationId: 'jira' }, { issues: {} }, {});

export const provider = registerIssuesPluginBehavior(plugin, {
  issues: {
    async listIssues(host, opts) {
      try {
        const { siteUrl, email, apiToken } = readJiraCredentials(host.credentials);
        const sanitizedLimit = clampIssueLimit(opts.limit, 50, 500);
        try {
          const issues = await searchJql(
            siteUrl,
            email,
            apiToken,
            buildListJql('mine'),
            sanitizedLimit
          );
          if (issues.length > 0) return ok(normalizeIssues(siteUrl, issues));
        } catch (error) {
          if (!isJqlPermissionError(error)) throw error;

          try {
            const issues = await searchJql(
              siteUrl,
              email,
              apiToken,
              buildListJql('mine-fallback'),
              sanitizedLimit
            );
            if (issues.length > 0) return ok(normalizeIssues(siteUrl, issues));
          } catch {
            // Try all-issues and picker fallbacks.
          }
        }

        try {
          const issues = await searchJql(
            siteUrl,
            email,
            apiToken,
            buildListJql('all'),
            sanitizedLimit
          );
          if (issues.length > 0) return ok(normalizeIssues(siteUrl, issues));
        } catch {
          // Try picker fallback.
        }

        try {
          const keys = await getRecentIssueKeys(siteUrl, email, apiToken, sanitizedLimit);
          if (keys.length > 0) {
            const results: RawJiraIssue[] = [];
            for (const key of keys.slice(0, sanitizedLimit)) {
              try {
                const issue = await getIssueByKey(siteUrl, email, apiToken, key);
                if (issue) results.push(issue);
              } catch {
                // Skip individual failures.
              }
            }

            if (results.length > 0) return ok(normalizeIssues(siteUrl, results));
          }
        } catch {
          // Ignore final fallback errors.
        }

        return ok([]);
      } catch (error) {
        return err(issueError('generic', error instanceof Error ? error.message : String(error)));
      }
    },

    async searchIssues(host, opts): Promise<IssueListResult> {
      const term = normalizeSearchTerm(opts.searchTerm);
      if (!term) return ok([]);

      try {
        const { siteUrl, email, apiToken } = readJiraCredentials(host.credentials);

        const looksLikeKey = JIRA_KEY_PATTERN.test(term);
        if (looksLikeKey) {
          const keyUpper = term.toUpperCase();
          try {
            const issue = await getIssueByKey(siteUrl, email, apiToken, keyUpper);
            if (issue) return ok(normalizeIssues(siteUrl, [issue]));
          } catch {
            // Fall through to JQL search.
          }
        }

        const isNumeric = /^\d+$/.test(term);
        if (isNumeric && projectKeys.length === 0) {
          projectKeys = await fetchProjectKeys(siteUrl, email, apiToken);
        }

        const keyClause =
          isNumeric && projectKeys.length
            ? ` OR key IN (${projectKeys
                .map((projectKey) => `"${escapeJqlValue(`${projectKey}-${term}`)}"`)
                .join(',')})`
            : '';

        const data = await searchJql(
          siteUrl,
          email,
          apiToken,
          `${buildSearchJql(term)}${keyClause} ORDER BY updated DESC`,
          clampIssueLimit(opts.limit, 20, 500)
        );

        return ok(normalizeIssues(siteUrl, data));
      } catch (error) {
        return err(issueError('generic', error instanceof Error ? error.message : String(error)));
      }
    },
  },
});

type ListMode = 'mine' | 'mine-fallback' | 'all';

export function buildListJql(mode: ListMode): string {
  if (mode === 'mine') {
    return '(assignee = currentUser() OR reporter = currentUser()) ORDER BY updated DESC';
  }

  if (mode === 'mine-fallback') {
    return 'assignee = currentUser() ORDER BY updated DESC';
  }

  return 'updated >= -90d ORDER BY updated DESC';
}

export function buildSearchJql(searchTerm: string): string {
  const term = normalizeSearchTerm(searchTerm);
  const escaped = escapeJqlValue(term);

  if (JIRA_KEY_PATTERN.test(term)) {
    return `(key = "${escaped}" OR text ~ "${escaped}")`;
  }

  return `text ~ "${escaped}"`;
}

function escapeJqlValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function isJqlPermissionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Jira API error (400|403)/.test(message);
}

async function searchJql(
  siteUrl: string,
  email: string,
  token: string,
  jql: string,
  limit: number
): Promise<RawJiraIssue[]> {
  const effectiveLimit = clampIssueLimit(limit, 20, 500);
  const issues: RawJiraIssue[] = [];
  let nextPageToken: string | undefined;

  while (issues.length < effectiveLimit) {
    const remaining = effectiveLimit - issues.length;
    const data = await fetchSearchPage(
      siteUrl,
      email,
      token,
      jql,
      Math.min(PAGE_SIZE, remaining),
      nextPageToken
    );
    const pageIssues = Array.isArray(data?.issues) ? data.issues : [];
    issues.push(...pageIssues);

    if (pageIssues.length === 0 || data?.isLast === true || !data?.nextPageToken) {
      break;
    }
    nextPageToken = data.nextPageToken;
  }

  return issues.slice(0, effectiveLimit);
}

async function fetchSearchPage(
  siteUrl: string,
  email: string,
  token: string,
  jql: string,
  maxResults: number,
  nextPageToken?: string
): Promise<RawJiraSearchResult> {
  const url = new URL('/rest/api/3/search/jql', siteUrl);
  const payload: Record<string, unknown> = {
    jql,
    maxResults,
    fields: SEARCH_FIELDS,
  };
  if (nextPageToken) {
    payload.nextPageToken = nextPageToken;
  }

  const body = await doJiraPost(url, email, token, JSON.stringify(payload));
  return JSON.parse(body || '{}') as RawJiraSearchResult;
}

async function fetchProjectKeys(siteUrl: string, email: string, token: string): Promise<string[]> {
  try {
    const url = new URL('/rest/api/3/project', siteUrl);
    const body = await doJiraGet(url, email, token);
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

  const body = await doJiraGet(url, email, token);
  const data = JSON.parse(body || '{}') as RawJiraIssue;
  if (!data || data.errorMessages) return null;
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

  const body = await doJiraGet(url, email, token);
  const data = JSON.parse(body || '{}') as JiraPickerResult;

  const keys: string[] = [];
  const sections = Array.isArray(data?.sections) ? data.sections : [];
  for (const section of sections) {
    const issues = Array.isArray(section?.issues) ? section.issues : [];
    for (const issue of issues) {
      const key = String(issue?.key || '').trim();
      if (key && !keys.includes(key)) keys.push(key);
      if (keys.length >= limit) break;
    }
    if (keys.length >= limit) break;
  }

  return keys;
}

function flattenAdf(node: AdfNode | string | null | undefined): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text || '';

  if (Array.isArray(node.content)) {
    const parts = node.content.map((item) => flattenAdf(item));
    if (['doc', 'bulletList', 'orderedList'].includes(node.type ?? '')) return parts.join('\n');
    if (['paragraph', 'heading', 'listItem'].includes(node.type ?? '')) return parts.join('');
    return parts.join('');
  }

  return '';
}

function normalizeIssues(siteUrl: string, rawIssues: RawJiraIssue[]): IssueData[] {
  const base = siteUrl.replace(/\/$/, '');

  return (rawIssues || []).map((item) => {
    const fields = item?.fields ?? {};
    return {
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
    };
  });
}
