import { describe, expect, it, vi } from 'vitest';
import { linearConnectionService } from './linear-connection-service';
import { downloadLinearIssueAttachments } from './linear-issue-attachments';
import { linearIssueProvider } from './linear-issue-provider';

vi.mock('./linear-connection-service', () => ({
  linearConnectionService: {
    getClient: vi.fn(),
    getToken: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock('./linear-issue-attachments', () => ({
  downloadLinearIssueAttachments: vi.fn().mockResolvedValue([]),
}));

const mockGetClient = vi.mocked(linearConnectionService.getClient);
const mockGetToken = vi.mocked(linearConnectionService.getToken);
const mockDownloadAttachments = vi.mocked(downloadLinearIssueAttachments);

function makeLinearClient(rawRequest: ReturnType<typeof vi.fn>) {
  return {
    client: {
      rawRequest,
    },
  };
}

describe('linearIssueProvider', () => {
  it('maps branchName from listed Linear issues without fetching activity', async () => {
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
    expect(rawRequest).toHaveBeenCalledWith(expect.not.stringContaining('comments('), {
      limit: 10,
    });
    expect(rawRequest).toHaveBeenCalledWith(expect.not.stringContaining('history('), {
      limit: 10,
    });
    expect(result).toEqual({
      success: true,
      issues: [
        expect.objectContaining({
          provider: 'linear',
          identifier: 'GEN-626',
          branchName: 'jona/gen-626-linear-issue-branch-name-creation',
          context: undefined,
        }),
      ],
    });
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

  it('paginates Linear comments and history only when fetching issue context', async () => {
    const rawRequest = vi
      .fn()
      .mockResolvedValueOnce({
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

    const result = await linearIssueProvider.getIssueContext?.({ identifier: 'GEN-626' });

    expect(rawRequest).toHaveBeenCalledTimes(3);
    expect(rawRequest).toHaveBeenNthCalledWith(1, expect.stringContaining('IssueContext'), {
      term: 'GEN-626',
      limit: 3,
    });
    expect(rawRequest).toHaveBeenNthCalledWith(2, expect.stringContaining('IssueComments'), {
      issueId: 'issue-1',
      cursor: 'comment-cursor-1',
    });
    expect(rawRequest).toHaveBeenNthCalledWith(3, expect.stringContaining('IssueHistory'), {
      issueId: 'issue-1',
      cursor: 'history-cursor-1',
    });
    const context = result?.success ? result.issue.context : '';
    expect(context).toContain('First page comment.');
    expect(context).toContain('Second page comment.');
    expect(context).toContain('State: Todo -> Backlog');
    expect(context).toContain('Estimate: 1 -> 2');
  });

  it('keeps first-page issue context when activity pagination fails', async () => {
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

    const result = await linearIssueProvider.getIssueContext?.({ identifier: 'GEN-626' });

    expect(result?.success).toBe(true);
    expect(result?.success ? result.issue.context : '').toContain(
      'First page comment still survives.'
    );
  });

  it('downloads issue attachments from description and comments when a token exists', async () => {
    const rawRequest = vi.fn().mockResolvedValue({
      data: {
        searchIssues: {
          nodes: [
            {
              id: 'issue-1',
              identifier: 'GEN-626',
              title: 'Linear issue branch name creation',
              description: 'See ![shot](https://uploads.linear.app/abc/def/screenshot.png)',
              url: 'https://linear.app/general-action/issue/GEN-626',
              branchName: null,
              state: { name: 'Backlog', type: 'unstarted', color: '#aaa' },
              team: { name: 'General', key: 'GEN' },
              project: null,
              assignee: null,
              updatedAt: '2026-04-17T12:00:00.000Z',
              comments: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    id: 'comment-1',
                    body: 'Also ![more](https://uploads.linear.app/abc/ghi/more.png)',
                    createdAt: '2026-04-17T12:05:00.000Z',
                    updatedAt: '2026-04-17T12:05:00.000Z',
                    url: 'https://linear.app/general-action/issue/GEN-626#comment-1',
                    user: { displayName: 'Jona', name: 'jona' },
                  },
                ],
              },
              history: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
            },
          ],
        },
      },
    });
    mockGetClient.mockResolvedValue(makeLinearClient(rawRequest) as never);
    mockGetToken.mockResolvedValue('lin_api_test');
    mockDownloadAttachments.mockResolvedValue([
      {
        url: 'https://uploads.linear.app/abc/def/screenshot.png',
        localPath: '/tmp/emdash-drop-1-GEN-626-screenshot.png',
      },
    ]);

    const result = await linearIssueProvider.getIssueContext?.({ identifier: 'GEN-626' });

    expect(mockDownloadAttachments).toHaveBeenCalledWith({
      token: 'lin_api_test',
      identifier: 'GEN-626',
      texts: [
        'See ![shot](https://uploads.linear.app/abc/def/screenshot.png)',
        'Also ![more](https://uploads.linear.app/abc/ghi/more.png)',
      ],
    });
    expect(result?.success ? result.attachments : undefined).toEqual([
      {
        url: 'https://uploads.linear.app/abc/def/screenshot.png',
        localPath: '/tmp/emdash-drop-1-GEN-626-screenshot.png',
      },
    ]);
  });
});
