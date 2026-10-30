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
      jql: '(updated >= -90d) AND (statusCategory != Done) ORDER BY updated DESC',
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
      jql: '((key = "ENG-976" OR text ~ "ENG-976")) AND (statusCategory != Done) ORDER BY updated DESC',
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
      jql: '(text ~ "deprecated \\"search\\" endpoint") AND (statusCategory != Done) ORDER BY updated DESC',
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

  it('scopes the list to the account filter instead of the recent-activity window', async () => {
    mockSearchForIssues.mockResolvedValueOnce({ issues: [] });
    const host = makeHost();
    host.credentials = { ...host.credentials, jqlFilter: 'project = WEB' };

    await issues.listIssues(host, { limit: 10 });

    expect(searchParams(0)).toMatchObject({
      jql: '(project = WEB) AND (statusCategory != Done) ORDER BY updated DESC',
    });
  });

  it('ANDs the account filter with the search term', async () => {
    mockSearchForIssues.mockResolvedValueOnce({ issues: [] });
    const host = makeHost();
    host.credentials = { ...host.credentials, jqlFilter: 'project = WEB OR project = IT' };

    await issues.searchIssues(host, { searchTerm: 'certificate', limit: 5 });

    expect(searchParams(0)).toMatchObject({
      jql: '(project = WEB OR project = IT) AND (text ~ "certificate") AND (statusCategory != Done) ORDER BY updated DESC',
    });
  });

  it('narrows the account filter with the project filter', async () => {
    mockSearchForIssues.mockResolvedValueOnce({ issues: [] });
    const host = makeHost();
    host.credentials = { ...host.credentials, jqlFilter: 'project = WEB' };

    await issues.listIssues(host, { limit: 10, issueFilter: '"Epic Link" = WEB-123' });

    expect(searchParams(0)).toMatchObject({
      jql: '(project = WEB) AND ("Epic Link" = WEB-123) AND (statusCategory != Done) ORDER BY updated DESC',
    });
  });

  it('leaves completed issues out of lists and searches, even under a status filter', async () => {
    const host = makeHost();
    host.credentials = { ...host.credentials, jqlFilter: 'status = Done' };

    await issues.listIssues(host, { limit: 5 });
    await issues.searchIssues(host, { searchTerm: 'certificate', limit: 5 });

    expect(searchParams(0).jql).toContain('(statusCategory != Done)');
    expect(searchParams(1).jql).toContain('(statusCategory != Done)');
  });

  it('rejects a project filter that brings its own ORDER BY without querying Jira', async () => {
    const result = await issues.searchIssues(makeHost(), {
      searchTerm: 'cert',
      limit: 5,
      issueFilter: 'project = WEB order by created',
    });

    expect(result).toMatchObject({ success: false, error: { type: 'invalid_input' } });
    expect(mockSearchForIssues).not.toHaveBeenCalled();
  });

  it('lists Data Center issues through the v2 search with plain-text descriptions', async () => {
    const mockV2Search = vi.fn().mockResolvedValueOnce({
      issues: [
        {
          ...jiraIssue('OPS-7', 'Renew certificate'),
          fields: {
            ...jiraIssue('OPS-7', 'Renew certificate').fields,
            description: 'h3. Steps\n* renew the cert',
          },
        },
      ],
    });
    mockCreateJiraClient.mockReturnValue({
      issueSearch: { searchForIssuesUsingJqlPost: mockV2Search },
    } as unknown as JiraClient);
    const host = makeHost();
    host.credentials = {
      authMethod: 'pat',
      siteUrl: 'https://jira.example.com',
      personalAccessToken: 'dc-token',
    };

    const result = await issues.listIssues(host, { limit: 10 });

    expect(result).toEqual({
      success: true,
      data: [
        expect.objectContaining({
          identifier: 'OPS-7',
          title: 'Renew certificate',
          url: 'https://jira.example.com/browse/OPS-7',
          description: 'h3. Steps\n* renew the cert',
        }),
      ],
    });
    expect(mockSearchForIssues).not.toHaveBeenCalled();
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
