import type { Logger } from '@emdash/shared/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectedIntegrationHostContext } from '../../../integrations/host';
import * as jiraClient from '../../../integrations/impl/jira/client';
import type { JiraClient } from '../../../integrations/impl/jira/types';
import { provider } from './index';

vi.mock('../../../integrations/impl/jira/client', async (importOriginal) => {
  const actual = await importOriginal<typeof jiraClient>();
  return {
    ...actual,
    createJiraClient: vi.fn(),
  };
});

const mockCreateJiraClient = vi.mocked(jiraClient.createJiraClient);
const mockSearchForIssues = vi.fn();
const mockGetIssue = vi.fn();
const mockGetComments = vi.fn();

const issues = provider.behavior.issues;
if (!issues) {
  throw new Error('Jira issues behavior is not registered.');
}

function makeHost(): ConnectedIntegrationHostContext {
  const log: Logger = {
    level: 'info',
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => log,
  };
  return {
    log,
    credentials: {
      siteUrl: 'https://example.atlassian.net',
      email: 'user@example.com',
      apiToken: 'token',
    },
  };
}

function makeClient(): JiraClient {
  return {
    issues: { getIssue: mockGetIssue },
    issueComments: { getComments: mockGetComments },
    issueSearch: {
      searchForIssuesUsingJqlEnhancedSearchPost: mockSearchForIssues,
    },
  } as unknown as JiraClient;
}

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

function jiraError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

function searchParams(callIndex: number) {
  return mockSearchForIssues.mock.calls[callIndex]?.[0] as Record<string, unknown>;
}

describe('jira issues plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateJiraClient.mockReturnValue(makeClient());
  });

  it('lists Jira issues through one enhanced search call', async () => {
    mockSearchForIssues.mockResolvedValueOnce({
      issues: [jiraIssue('ENG-1'), jiraIssue('ENG-2')],
    });

    const result = await issues.listIssues(makeHost(), { limit: 2 });

    expect(result).toEqual({
      success: true,
      data: [
        expect.objectContaining({ identifier: 'ENG-1' }),
        expect.objectContaining({ identifier: 'ENG-2' }),
      ],
    });
    expect(mockSearchForIssues).toHaveBeenCalledTimes(1);
    expect(searchParams(0)).toEqual({
      jql: 'updated >= -90d ORDER BY updated DESC',
      maxResults: 2,
      fields: ['summary', 'description', 'updated', 'project', 'status', 'assignee'],
    });
  });

  it('enumerates every JQL page without treating the page size as a total limit', async () => {
    mockSearchForIssues
      .mockResolvedValueOnce({ issues: [jiraIssue('ENG-1')], nextPageToken: 'next' })
      .mockResolvedValueOnce({ issues: [jiraIssue('ENG-2')] });
    const result = await issues.listIssues(makeHost(), {
      limit: 1,
      jql: 'assignee = currentUser()',
    });
    expect(result).toMatchObject({
      success: true,
      data: [{ identifier: 'ENG-1' }, { identifier: 'ENG-2' }],
    });
    expect(searchParams(1)).toMatchObject({
      nextPageToken: 'next',
      jql: 'assignee = currentUser()',
      maxResults: 1,
    });
  });

  it('fails clearly instead of looping on a repeated search cursor', async () => {
    mockSearchForIssues.mockResolvedValue({ issues: [], nextPageToken: 'same' });
    expect(await issues.listIssues(makeHost(), { limit: 100, jql: 'project = ENG' })).toMatchObject(
      {
        success: false,
        error: { message: expect.stringContaining('repeated page token') },
      }
    );
    expect(mockSearchForIssues).toHaveBeenCalledTimes(2);
  });

  it('enumerates issue identities even when one search entry has incomplete fields', async () => {
    mockSearchForIssues.mockResolvedValueOnce({ issues: [{ key: 'ENG-1' }, jiraIssue('ENG-2')] });
    expect(await issues.listIssues(makeHost(), { limit: 100, jql: 'project = ENG' })).toMatchObject(
      {
        success: true,
        data: [{ identifier: 'ENG-1' }, { identifier: 'ENG-2' }],
      }
    );
  });

  it('continues comments pagination when the server omits total', async () => {
    mockGetIssue.mockResolvedValue(jiraIssue('ENG-1'));
    mockGetComments
      .mockResolvedValueOnce({ maxResults: 1, comments: [{ body: 'First' }] })
      .mockResolvedValueOnce({ maxResults: 1, comments: [{ body: 'Second' }] })
      .mockResolvedValueOnce({ maxResults: 1, comments: [] });
    const result = await issues.getIssue?.(makeHost(), { identifier: 'ENG-1' });
    expect(result).toMatchObject({
      success: true,
      data: { context: expect.stringContaining('Second') },
    });
    expect(mockGetComments).toHaveBeenCalledTimes(3);
  });

  it('loads the full description and every comments page, including authors and rich text', async () => {
    const text = 'Full description '.repeat(1000);
    mockGetIssue.mockResolvedValue({
      ...jiraIssue('ENG-1'),
      fields: {
        ...jiraIssue('ENG-1').fields,
        description: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text },
                { type: 'hardBreak' },
                { type: 'text', text: 'More' },
              ],
            },
          ],
        },
      },
    });
    mockGetComments
      .mockResolvedValueOnce({
        total: 2,
        comments: [
          { author: { displayName: 'Alice' }, created: '2026-01-01', body: 'First comment' },
        ],
      })
      .mockResolvedValueOnce({
        total: 2,
        comments: [
          {
            author: { displayName: 'Bob' },
            body: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: 'Second comment',
                      marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
                    },
                  ],
                },
              ],
            },
          },
        ],
      });
    const result = await issues.getIssue?.(makeHost(), { identifier: 'ENG-1' });
    expect(result).toMatchObject({
      success: true,
      data: { description: `${text}\nMore`, url: 'https://example.atlassian.net/browse/ENG-1' },
    });
    if (!result?.success) return;
    expect(result.data.context).toContain('Alice · 2026-01-01');
    expect(result.data.context).toContain('First comment');
    expect(result.data.context).toContain('[Second comment](https://example.com)');
    expect(mockGetComments).toHaveBeenNthCalledWith(2, expect.objectContaining({ startAt: 1 }));
  });

  it('does not return partial context if a later comment page fails', async () => {
    mockGetIssue.mockResolvedValue(jiraIssue('ENG-1'));
    mockGetComments
      .mockResolvedValueOnce({ total: 2, comments: [{ body: 'First' }] })
      .mockRejectedValueOnce(Object.assign(new Error('Connection failed'), { code: 'ETIMEDOUT' }));
    expect(await issues.getIssue?.(makeHost(), { identifier: 'ENG-1' })).toMatchObject({
      success: false,
      error: { type: 'host_unreachable' },
    });
  });

  it('searches Jira issues through one enhanced search call', async () => {
    mockSearchForIssues.mockResolvedValueOnce({
      issues: [jiraIssue('ENG-976')],
    });

    const result = await issues.searchIssues(makeHost(), {
      searchTerm: 'ENG-976',
      limit: 5,
    });

    expect(result).toEqual({
      success: true,
      data: [expect.objectContaining({ identifier: 'ENG-976' })],
    });
    expect(mockSearchForIssues).toHaveBeenCalledTimes(1);
    expect(searchParams(0)).toEqual({
      jql: '(key = "ENG-976" OR text ~ "ENG-976") ORDER BY updated DESC',
      maxResults: 5,
      fields: ['summary', 'description', 'updated', 'project', 'status', 'assignee'],
    });
  });

  it('searches plain text terms with escaped JQL text matching', async () => {
    mockSearchForIssues.mockResolvedValueOnce({
      issues: [],
    });

    const result = await issues.searchIssues(makeHost(), {
      searchTerm: 'deprecated "search" endpoint',
      limit: 5,
    });

    expect(result).toEqual({
      success: true,
      data: [],
    });
    expect(mockSearchForIssues).toHaveBeenCalledTimes(1);
    expect(searchParams(0)).toEqual({
      jql: 'text ~ "deprecated \\"search\\" endpoint" ORDER BY updated DESC',
      maxResults: 5,
      fields: ['summary', 'description', 'updated', 'project', 'status', 'assignee'],
    });
  });

  it('returns an empty list for empty search terms without creating a client', async () => {
    const result = await issues.searchIssues(makeHost(), {
      searchTerm: '   ',
      limit: 5,
    });

    expect(result).toEqual({
      success: true,
      data: [],
    });
    expect(mockCreateJiraClient).not.toHaveBeenCalled();
  });

  it('maps SDK errors through the generic integration error mapper', async () => {
    mockSearchForIssues.mockRejectedValueOnce(jiraError(401, 'unauthorized'));

    const result = await issues.listIssues(makeHost(), { limit: 10 });

    expect(result).toEqual({
      success: false,
      error: {
        type: 'auth_failed',
        message: 'Jira authentication failed. Check your credentials.',
      },
    });
  });

  it('returns invalid input for incomplete stored bearer credentials before constructing a client', async () => {
    const host = makeHost();
    host.credentials = {
      authMethod: 'bearer',
      siteUrl: 'https://example.atlassian.net',
      accessToken: 'oauth-token',
    };
    await expect(issues.listIssues(host, { limit: 10 })).resolves.toMatchObject({
      success: false,
      error: { type: 'invalid_input' },
    });
    await expect(
      issues.searchIssues(host, { searchTerm: 'ENG-1', limit: 10 })
    ).resolves.toMatchObject({
      success: false,
      error: { type: 'invalid_input' },
    });
    expect(mockCreateJiraClient).not.toHaveBeenCalled();
  });
});
