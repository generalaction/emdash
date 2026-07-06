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
});
