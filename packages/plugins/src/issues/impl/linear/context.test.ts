import { describe, expect, it, vi } from 'vitest';
import type { LinearClient } from '../../../integrations/impl/linear/types';
import { formatLinearContext, getLinearIssueDetails, hydrateIssueActivity } from './context';

function makeClient(rawRequest: ReturnType<typeof vi.fn>): LinearClient {
  return { client: { rawRequest } } as unknown as LinearClient;
}

function comment(id: string, body: string, user: { displayName: string; name: string } | null) {
  return {
    id,
    body,
    createdAt: '2026-04-17T12:05:00.000Z',
    updatedAt: '2026-04-17T12:05:00.000Z',
    url: `https://linear.app/issue/GEN-626#${id}`,
    user,
  };
}

function historyEntry(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    createdAt: '2026-04-17T12:10:00.000Z',
    updatedAt: '2026-04-17T12:10:00.000Z',
    actor: { displayName: 'Jona', name: 'jona' },
    ...overrides,
  };
}

function emptyPage() {
  return { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] };
}

describe('formatLinearContext', () => {
  it('returns undefined when there are no comments or history entries', () => {
    expect(
      formatLinearContext({ id: 'issue-1', comments: emptyPage(), history: emptyPage() })
    ).toBeUndefined();
  });

  it('formats comments and history transitions', () => {
    const context = formatLinearContext({
      id: 'issue-1',
      comments: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [comment('comment-1', '  Ship it.  ', { displayName: 'Jona', name: 'jona' })],
      },
      history: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [
          historyEntry('history-1', {
            fromState: { name: 'Todo' },
            toState: { name: 'Backlog' },
            fromEstimate: 1,
            toEstimate: 2,
          }),
        ],
      },
    });

    expect(context).toContain('Linear issue activity');
    expect(context).toContain('Comments:');
    expect(context).toContain('by Jona: Ship it.');
    expect(context).toContain('History:');
    expect(context).toContain('State: Todo -> Backlog; Estimate: 1 -> 2');
  });

  it('skips unchanged transitions and falls back to a generic history summary', () => {
    const context = formatLinearContext({
      id: 'issue-1',
      comments: emptyPage(),
      history: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [
          historyEntry('history-1', {
            actor: null,
            fromState: { name: 'Backlog' },
            toState: { name: 'Backlog' },
          }),
        ],
      },
    });

    expect(context).toContain('by Unknown: Issue updated');
    expect(context).not.toContain('State:');
  });
});

describe('hydrateIssueActivity', () => {
  it('returns the issue unchanged when there is nothing left to paginate', async () => {
    const rawRequest = vi.fn();
    const issue = {
      id: 'issue-1',
      comments: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [comment('comment-1', 'Only page.', { displayName: 'Jona', name: 'jona' })],
      },
      history: emptyPage(),
    };

    const hydrated = await hydrateIssueActivity(makeClient(rawRequest), issue);

    expect(hydrated).toBe(issue);
    expect(rawRequest).not.toHaveBeenCalled();
  });

  it('follows comment and history cursors until every page is fetched', async () => {
    const rawRequest = vi
      .fn()
      .mockImplementation((query: string, variables: { cursor: string }) => {
        if (query.includes('IssueComments')) {
          if (variables.cursor === 'comment-cursor-1') {
            return Promise.resolve({
              data: {
                issue: {
                  comments: {
                    pageInfo: { hasNextPage: true, endCursor: 'comment-cursor-2' },
                    nodes: [comment('comment-2', 'Page two.', { displayName: 'Ari', name: 'ari' })],
                  },
                },
              },
            });
          }

          return Promise.resolve({
            data: {
              issue: {
                comments: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [comment('comment-3', 'Page three.', { displayName: 'Ari', name: 'ari' })],
                },
              },
            },
          });
        }

        return Promise.resolve({
          data: {
            issue: {
              history: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  historyEntry('history-2', {
                    fromPriority: 1,
                    toPriority: 3,
                  }),
                ],
              },
            },
          },
        });
      });
    const issue = {
      id: 'issue-1',
      comments: {
        pageInfo: { hasNextPage: true, endCursor: 'comment-cursor-1' },
        nodes: [comment('comment-1', 'Page one.', { displayName: 'Jona', name: 'jona' })],
      },
      history: {
        pageInfo: { hasNextPage: true, endCursor: 'history-cursor-1' },
        nodes: [],
      },
    };

    const hydrated = await hydrateIssueActivity(makeClient(rawRequest), issue);

    expect(rawRequest).toHaveBeenCalledTimes(3);
    expect(hydrated.comments.nodes.map((node) => node.id)).toEqual([
      'comment-1',
      'comment-2',
      'comment-3',
    ]);
    expect(hydrated.comments.pageInfo).toEqual({ hasNextPage: false, endCursor: null });
    expect(hydrated.history.nodes).toEqual([expect.objectContaining({ id: 'history-2' })]);
    expect(hydrated.history.pageInfo).toEqual({ hasNextPage: false, endCursor: null });
  });
});

describe('getLinearIssueDetails', () => {
  it('falls back to first-page context when pagination fails', async () => {
    const rawRequest = vi.fn().mockRejectedValue(new Error('Linear pagination failed'));
    const issue = {
      id: 'issue-1',
      comments: {
        pageInfo: { hasNextPage: true, endCursor: 'comment-cursor-1' },
        nodes: [comment('comment-1', 'Survives.', { displayName: 'Jona', name: 'jona' })],
      },
      history: emptyPage(),
    };

    const { context } = await getLinearIssueDetails(makeClient(rawRequest), issue);

    expect(context).toContain('Survives.');
  });
});
