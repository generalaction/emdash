import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jiraConnectionService } from './jira-connection-service';
import { doJiraGet, doJiraPost } from './jira-http-client';
import { buildListJql, buildSearchJql, jiraIssueProvider } from './jira-issue-provider';

vi.mock('./jira-connection-service', () => ({
  jiraConnectionService: {
    requireAuth: vi.fn(),
    checkConnection: vi.fn(),
  },
}));

vi.mock('./jira-http-client', () => ({
  doJiraGet: vi.fn(),
  doJiraPost: vi.fn(),
}));

const mockRequireAuth = vi.mocked(jiraConnectionService.requireAuth);
const mockDoJiraGet = vi.mocked(doJiraGet);
const mockDoJiraPost = vi.mocked(doJiraPost);

function jiraIssue(key: string, summary = `${key} summary`) {
  return {
    id: key,
    key,
    fields: {
      summary,
      description: null,
      updated: '2026-05-30T12:00:00.000+0000',
      project: { key: key.split('-')[0], name: 'Project' },
      status: { name: 'To Do' },
      assignee: { displayName: 'Jona' },
    },
  };
}

function postPayload(callIndex: number) {
  return JSON.parse(String(mockDoJiraPost.mock.calls[callIndex]?.[3] || '{}')) as Record<
    string,
    unknown
  >;
}

describe('jiraIssueProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAuth.mockResolvedValue({
      siteUrl: 'https://example.atlassian.net',
      email: 'user@example.com',
      token: 'token',
    });
  });

  it('builds list JQL for mine, fallback, and bounded all modes', () => {
    expect(buildListJql('mine')).toBe(
      '(assignee = currentUser() OR reporter = currentUser()) ORDER BY updated DESC'
    );
    expect(buildListJql('mine-fallback')).toBe('assignee = currentUser() ORDER BY updated DESC');
    expect(buildListJql('all')).toBe('updated >= -90d ORDER BY updated DESC');
  });

  it('builds search JQL for key-shaped and plain text terms', () => {
    expect(buildSearchJql('ENG-976')).toBe('(key = "ENG-976" OR text ~ "ENG-976")');
    expect(buildSearchJql('deprecated "search" endpoint')).toBe(
      'text ~ "deprecated \\"search\\" endpoint"'
    );
  });

  it('lists Jira issues through enhanced search with nextPageToken pagination', async () => {
    mockDoJiraPost
      .mockResolvedValueOnce(
        JSON.stringify({
          issues: [jiraIssue('ENG-1')],
          nextPageToken: 'page-2',
          isLast: false,
        })
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          issues: [jiraIssue('ENG-2')],
          isLast: true,
        })
      );

    const result = await jiraIssueProvider.listIssues({ limit: 2 });

    expect(result).toEqual({
      success: true,
      issues: [
        expect.objectContaining({ provider: 'jira', identifier: 'ENG-1' }),
        expect.objectContaining({ provider: 'jira', identifier: 'ENG-2' }),
      ],
    });
    expect(mockDoJiraPost).toHaveBeenCalledTimes(2);
    expect(mockDoJiraPost.mock.calls[0]?.[0].pathname).toBe('/rest/api/3/search/jql');
    expect(postPayload(0)).toEqual({
      jql: buildListJql('mine'),
      maxResults: 2,
      fields: ['summary', 'description', 'updated', 'project', 'status', 'assignee'],
    });
    expect(postPayload(1)).toEqual({
      jql: buildListJql('mine'),
      maxResults: 1,
      fields: ['summary', 'description', 'updated', 'project', 'status', 'assignee'],
      nextPageToken: 'page-2',
    });
  });

  it('retries list issues with assignee-only JQL when reporter query is not permitted', async () => {
    mockDoJiraPost
      .mockRejectedValueOnce(new Error('Jira API error 403: reporter is not queryable'))
      .mockResolvedValueOnce(JSON.stringify({ issues: [jiraIssue('ENG-3')], isLast: true }));

    const result = await jiraIssueProvider.listIssues({ limit: 10 });

    expect(result).toEqual({
      success: true,
      issues: [expect.objectContaining({ provider: 'jira', identifier: 'ENG-3' })],
    });
    expect(mockDoJiraPost).toHaveBeenCalledTimes(2);
    expect(postPayload(0).jql).toBe(buildListJql('mine'));
    expect(postPayload(1).jql).toBe(buildListJql('mine-fallback'));
  });

  it('does not hide auth failures behind broad list fallbacks', async () => {
    mockDoJiraPost.mockRejectedValueOnce(new Error('Jira API error 401: unauthorized'));

    const result = await jiraIssueProvider.listIssues({ limit: 10 });

    expect(result).toEqual({ success: false, error: 'Jira API error 401: unauthorized' });
    expect(mockDoJiraPost).toHaveBeenCalledTimes(1);
  });

  it('falls back from exact issue lookup to enhanced JQL search for key-shaped terms', async () => {
    mockDoJiraGet.mockResolvedValueOnce(
      JSON.stringify({ errorMessages: ['Issue does not exist'] })
    );
    mockDoJiraPost.mockResolvedValueOnce(
      JSON.stringify({ issues: [jiraIssue('ENG-976')], isLast: true })
    );

    const result = await jiraIssueProvider.searchIssues({
      searchTerm: 'ENG-976',
      limit: 5,
    });

    expect(result).toEqual({
      success: true,
      issues: [expect.objectContaining({ provider: 'jira', identifier: 'ENG-976' })],
    });
    expect(mockDoJiraGet.mock.calls[0]?.[0].pathname).toBe('/rest/api/3/issue/ENG-976');
    expect(mockDoJiraPost.mock.calls[0]?.[0].pathname).toBe('/rest/api/3/search/jql');
    expect(postPayload(0).jql).toBe('(key = "ENG-976" OR text ~ "ENG-976") ORDER BY updated DESC');
  });
});
