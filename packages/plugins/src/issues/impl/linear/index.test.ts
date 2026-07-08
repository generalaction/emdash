import type { Logger } from '@emdash/shared/logger';
import type * as LinearSdk from '@linear/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectedIntegrationHostContext } from '../../../integrations/host';
import { provider } from './index';

const { rawRequest } = vi.hoisted(() => ({ rawRequest: vi.fn() }));

vi.mock('@linear/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof LinearSdk>();
  return {
    ...actual,
    LinearClient: class {
      client = { rawRequest };
    },
  };
});

const issues = provider.behavior.issues;
if (!issues) {
  throw new Error('Linear issues behavior is not registered.');
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
  return { log, credentials: { apiKey: 'lin_api_test' } };
}

function linearIssueNode(overrides: Record<string, unknown> = {}) {
  return {
    id: 'issue-1',
    identifier: 'GEN-626',
    title: 'Linear issue branch name creation',
    description: 'Use the Linear branch format',
    url: 'https://linear.app/general-action/issue/GEN-626',
    branchName: 'jona/gen-626-linear-issue-branch-name-creation',
    state: { name: 'Backlog', type: 'unstarted', color: '#aaa' },
    team: { name: 'General', key: 'GEN' },
    project: { name: 'Refactor (v1)' },
    assignee: { displayName: 'Jona', name: 'jona' },
    updatedAt: '2026-04-17T12:00:00.000Z',
    ...overrides,
  };
}

describe('linear issues plugin', () => {
  beforeEach(() => {
    rawRequest.mockReset();
  });

  it('maps branchName from listed Linear issues without fetching activity', async () => {
    rawRequest.mockResolvedValue({
      data: { issues: { nodes: [linearIssueNode()] } },
    });

    const result = await issues.listIssues(makeHost(), { limit: 10 });

    expect(rawRequest).toHaveBeenCalledTimes(1);
    expect(rawRequest).toHaveBeenCalledWith(expect.stringContaining('branchName'), { limit: 10 });
    expect(rawRequest).toHaveBeenCalledWith(expect.not.stringContaining('comments('), {
      limit: 10,
    });
    expect(rawRequest).toHaveBeenCalledWith(expect.not.stringContaining('history('), {
      limit: 10,
    });
    expect(result).toEqual({
      success: true,
      data: [
        expect.objectContaining({
          identifier: 'GEN-626',
          branchName: 'jona/gen-626-linear-issue-branch-name-creation',
        }),
      ],
    });
  });

  it('maps branchName from searched Linear issues without activity', async () => {
    rawRequest.mockResolvedValue({
      data: { searchIssues: { nodes: [linearIssueNode()] } },
    });

    const result = await issues.searchIssues(makeHost(), {
      searchTerm: 'GEN-626',
      limit: 5,
    });

    expect(rawRequest).toHaveBeenCalledTimes(1);
    expect(rawRequest).toHaveBeenCalledWith(
      expect.stringContaining('branchName'),
      expect.objectContaining({ term: 'GEN-626', limit: 5 })
    );
    expect(rawRequest).toHaveBeenCalledWith(
      expect.stringContaining('fragment IssueSearchSummary on IssueSearchResult'),
      expect.objectContaining({ term: 'GEN-626', limit: 5 })
    );
    expect(rawRequest).toHaveBeenCalledWith(
      expect.not.stringContaining('fragment IssueSummary on Issue'),
      expect.objectContaining({ term: 'GEN-626', limit: 5 })
    );
    expect(rawRequest).toHaveBeenCalledWith(
      expect.not.stringContaining('state {'),
      expect.objectContaining({ term: 'GEN-626', limit: 5 })
    );
    expect(rawRequest).toHaveBeenCalledWith(
      expect.not.stringContaining('assignee {'),
      expect.objectContaining({ term: 'GEN-626', limit: 5 })
    );
    expect(rawRequest).toHaveBeenCalledWith(
      expect.not.stringContaining('project {'),
      expect.objectContaining({ term: 'GEN-626', limit: 5 })
    );
    expect(rawRequest).toHaveBeenCalledWith(
      expect.not.stringContaining('updatedAt'),
      expect.objectContaining({ term: 'GEN-626', limit: 5 })
    );
    expect(rawRequest).toHaveBeenCalledWith(
      expect.not.stringContaining('comments('),
      expect.objectContaining({ term: 'GEN-626', limit: 5 })
    );
    expect(rawRequest).toHaveBeenCalledWith(
      expect.not.stringContaining('history('),
      expect.objectContaining({ term: 'GEN-626', limit: 5 })
    );
    expect(result).toEqual({
      success: true,
      data: [
        expect.objectContaining({
          identifier: 'GEN-626',
          branchName: 'jona/gen-626-linear-issue-branch-name-creation',
        }),
      ],
    });
    if (!result.success) throw new Error('expected Linear search to succeed');
    expect(result.data[0]).not.toHaveProperty('status');
    expect(result.data[0]).not.toHaveProperty('assignees');
    expect(result.data[0]).not.toHaveProperty('project');
    expect(result.data[0]).not.toHaveProperty('updatedAt');
  });

  it('returns a generic error when Linear search fails', async () => {
    rawRequest.mockRejectedValue(new Error('400: invalid fragment'));

    const result = await issues.searchIssues(makeHost(), {
      searchTerm: 'GEN-626',
      limit: 5,
    });

    expect(result).toEqual({
      success: false,
      error: { type: 'generic', message: '400: invalid fragment' },
    });
  });

  it('paginates Linear comments and history only when fetching issue context', async () => {
    rawRequest
      .mockResolvedValueOnce({
        data: {
          issue: linearIssueNode({
            comments: {
              pageInfo: { hasNextPage: true, endCursor: 'comment-cursor-1' },
              nodes: [
                {
                  id: 'comment-1',
                  body: 'First page comment.',
                  createdAt: '2026-04-17T12:05:00.000Z',
                  updatedAt: '2026-04-17T12:05:00.000Z',
                  url: 'https://linear.app/general-action/issue/GEN-626#comment-1',
                  user: { displayName: 'Jona', name: 'jona' },
                },
              ],
            },
            history: {
              pageInfo: { hasNextPage: true, endCursor: 'history-cursor-1' },
              nodes: [
                {
                  id: 'history-1',
                  createdAt: '2026-04-17T12:10:00.000Z',
                  updatedAt: '2026-04-17T12:10:00.000Z',
                  actor: { displayName: 'Jona', name: 'jona' },
                  fromState: { name: 'Todo' },
                  toState: { name: 'Backlog' },
                },
              ],
            },
          }),
        },
      })
      .mockResolvedValueOnce({
        data: {
          issue: {
            comments: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                {
                  id: 'comment-2',
                  body: 'Second page comment.',
                  createdAt: '2026-04-17T12:15:00.000Z',
                  updatedAt: '2026-04-17T12:15:00.000Z',
                  url: 'https://linear.app/general-action/issue/GEN-626#comment-2',
                  user: { displayName: 'Ari', name: 'ari' },
                },
              ],
            },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          issue: {
            history: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                {
                  id: 'history-2',
                  createdAt: '2026-04-17T12:20:00.000Z',
                  updatedAt: '2026-04-17T12:20:00.000Z',
                  actor: { displayName: 'Ari', name: 'ari' },
                  fromEstimate: 1,
                  toEstimate: 2,
                },
              ],
            },
          },
        },
      });

    const result = await issues.getIssue?.(makeHost(), {
      identifier: 'GEN-626',
    });

    expect(rawRequest).toHaveBeenCalledTimes(3);
    expect(rawRequest).toHaveBeenNthCalledWith(1, expect.stringContaining('IssueWithActivity'), {
      id: 'GEN-626',
    });
    expect(rawRequest).toHaveBeenNthCalledWith(2, expect.stringContaining('IssueComments'), {
      issueId: 'issue-1',
      cursor: 'comment-cursor-1',
    });
    expect(rawRequest).toHaveBeenNthCalledWith(3, expect.stringContaining('IssueHistory'), {
      issueId: 'issue-1',
      cursor: 'history-cursor-1',
    });
    const context = result?.success ? result.data.context : '';
    expect(context).toContain('First page comment.');
    expect(context).toContain('Second page comment.');
    expect(context).toContain('State: Todo -> Backlog');
    expect(context).toContain('Estimate: 1 -> 2');
  });

  it('keeps first-page issue context when activity pagination fails', async () => {
    rawRequest.mockImplementation((query: string) => {
      if (query.includes('IssueComments')) {
        return Promise.reject(new Error('Linear pagination failed'));
      }

      if (query.includes('IssueHistory')) {
        return Promise.resolve({
          data: {
            issue: {
              history: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
            },
          },
        });
      }

      return Promise.resolve({
        data: {
          issue: linearIssueNode({
            comments: {
              pageInfo: { hasNextPage: true, endCursor: 'comment-cursor-1' },
              nodes: [
                {
                  id: 'comment-1',
                  body: 'First page comment still survives.',
                  createdAt: '2026-04-17T12:05:00.000Z',
                  updatedAt: '2026-04-17T12:05:00.000Z',
                  url: 'https://linear.app/general-action/issue/GEN-626#comment-1',
                  user: { displayName: 'Jona', name: 'jona' },
                },
              ],
            },
            history: {
              pageInfo: { hasNextPage: true, endCursor: 'history-cursor-1' },
              nodes: [],
            },
          }),
        },
      });
    });

    const result = await issues.getIssue?.(makeHost(), {
      identifier: 'GEN-626',
    });

    expect(result?.success).toBe(true);
    expect(result?.success ? result.data.context : '').toContain(
      'First page comment still survives.'
    );
  });

  it('returns not found when the direct lookup resolves no issue', async () => {
    rawRequest.mockResolvedValue({ data: { issue: null } });

    const result = await issues.getIssue?.(makeHost(), {
      identifier: 'GEN-626',
    });

    expect(result).toEqual({
      success: false,
      error: { type: 'not_found_or_no_access', message: 'Linear issue not found: GEN-626' },
    });
  });

  it('returns not found when Linear rejects the lookup with an entity-not-found error', async () => {
    rawRequest.mockRejectedValue(new Error('Entity not found: Issue - Could not find Issue.'));

    const result = await issues.getIssue?.(makeHost(), {
      identifier: 'GEN-626',
    });

    expect(result).toEqual({
      success: false,
      error: { type: 'not_found_or_no_access', message: 'Linear issue not found: GEN-626' },
    });
  });
});
