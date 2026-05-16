import { describe, expect, it, vi } from 'vitest';
import { linearConnectionService } from './linear-connection-service';
import { linearIssueProvider } from './linear-issue-provider';

vi.mock('./linear-connection-service', () => ({
  linearConnectionService: {
    getClient: vi.fn(),
  },
}));

const mockGetClient = vi.mocked(linearConnectionService.getClient);

function makeLinearClient(rawRequest: ReturnType<typeof vi.fn>) {
  return {
    client: {
      rawRequest,
    },
  };
}

describe('linearIssueProvider', () => {
  it('maps branchName and activity from listed Linear issues', async () => {
    const rawRequest = vi.fn().mockResolvedValue({
      data: {
        issues: {
          nodes: [
            {
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
              comments: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    id: 'comment-1',
                    body: 'This should match Linear copy prompt context.',
                    createdAt: '2026-04-17T12:05:00.000Z',
                    updatedAt: '2026-04-17T12:05:00.000Z',
                    url: 'https://linear.app/general-action/issue/GEN-626#comment-1',
                    user: { displayName: 'Jona', name: 'jona' },
                  },
                ],
              },
              history: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    id: 'history-1',
                    createdAt: '2026-04-17T12:10:00.000Z',
                    updatedAt: '2026-04-17T12:10:00.000Z',
                    actor: { displayName: 'Jona', name: 'jona' },
                    fromState: { name: 'Todo' },
                    toState: { name: 'Backlog' },
                  },
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
          ],
        },
      },
    });
    mockGetClient.mockResolvedValue(makeLinearClient(rawRequest) as never);

    const result = await linearIssueProvider.listIssues({ limit: 10 });

    expect(rawRequest).toHaveBeenCalledTimes(1);
    expect(rawRequest).toHaveBeenCalledWith(expect.stringContaining('branchName'), {
      limit: 10,
    });
    expect(result).toEqual({
      success: true,
      issues: [
        expect.objectContaining({
          provider: 'linear',
          identifier: 'GEN-626',
          branchName: 'jona/gen-626-linear-issue-branch-name-creation',
          context: expect.stringContaining('This should match Linear copy prompt context.'),
        }),
      ],
    });
    const context = result.success ? result.issues[0]?.context : '';
    expect(context).toContain('by Jona: This should match Linear copy prompt context.');
    expect(context).toContain('State: Todo -> Backlog');
    expect(context).toContain('by Ari: Estimate: 1 -> 2');
  });

  it('maps branchName from searched Linear issues without activity', async () => {
    const rawRequest = vi.fn().mockResolvedValue({
      data: {
        searchIssues: {
          nodes: [
            {
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
              comments: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
              history: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
            },
          ],
        },
      },
    });
    mockGetClient.mockResolvedValue(makeLinearClient(rawRequest) as never);

    const result = await linearIssueProvider.searchIssues({
      searchTerm: 'GEN-626',
      limit: 5,
    });

    expect(rawRequest).toHaveBeenCalledTimes(1);
    expect(rawRequest).toHaveBeenCalledWith(
      expect.not.stringContaining('...IssueDetails'),
      expect.objectContaining({ term: 'GEN-626', limit: 5 })
    );
    expect(result).toEqual({
      success: true,
      issues: [
        expect.objectContaining({
          provider: 'linear',
          identifier: 'GEN-626',
          branchName: 'jona/gen-626-linear-issue-branch-name-creation',
        }),
      ],
    });
  });

  it('returns an error when Linear search fails', async () => {
    const rawRequest = vi.fn().mockRejectedValue(new Error('400: invalid fragment'));
    mockGetClient.mockResolvedValue(makeLinearClient(rawRequest) as never);

    const result = await linearIssueProvider.searchIssues({
      searchTerm: 'GEN-626',
      limit: 5,
    });

    expect(result).toEqual({ success: false, error: '400: invalid fragment' });
  });

  it('paginates Linear comments and history before building issue context', async () => {
    const rawRequest = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          issues: {
            nodes: [
              {
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
              },
            ],
          },
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
    mockGetClient.mockResolvedValue(makeLinearClient(rawRequest) as never);

    const result = await linearIssueProvider.listIssues({ limit: 10 });

    expect(rawRequest).toHaveBeenCalledTimes(3);
    expect(rawRequest).toHaveBeenNthCalledWith(2, expect.stringContaining('IssueComments'), {
      issueId: 'issue-1',
      cursor: 'comment-cursor-1',
    });
    expect(rawRequest).toHaveBeenNthCalledWith(3, expect.stringContaining('IssueHistory'), {
      issueId: 'issue-1',
      cursor: 'history-cursor-1',
    });
    const context = result.success ? result.issues[0]?.context : '';
    expect(context).toContain('First page comment.');
    expect(context).toContain('Second page comment.');
    expect(context).toContain('State: Todo -> Backlog');
    expect(context).toContain('Estimate: 1 -> 2');
  });

  it('keeps listed issues when activity pagination fails for one issue', async () => {
    const rawRequest = vi.fn().mockImplementation((query: string) => {
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
          issues: {
            nodes: [
              {
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
              },
            ],
          },
        },
      });
    });
    mockGetClient.mockResolvedValue(makeLinearClient(rawRequest) as never);

    const result = await linearIssueProvider.listIssues({ limit: 10 });

    expect(result.success).toBe(true);
    expect(result.success ? result.issues : []).toHaveLength(1);
    expect(result.success ? result.issues[0]?.context : '').toContain(
      'First page comment still survives.'
    );
  });
});
