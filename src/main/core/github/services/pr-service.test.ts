import type { Octokit } from '@octokit/rest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubPullRequestServiceImpl } from './pr-service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOctokit(graphqlMock?: ReturnType<typeof vi.fn>): Octokit {
  return {
    graphql: graphqlMock ?? vi.fn(),
  } as unknown as Octokit;
}

const OWNER = 'acme';
const REPO = 'my-repo';

// GraphQL-shaped node (camelCase, nested { nodes })
const gqlPrNode = {
  number: 42,
  title: 'feat: add widget',
  url: 'https://github.com/acme/my-repo/pull/42',
  state: 'OPEN' as const,
  isDraft: false,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
  headRefName: 'feat/widget',
  headRefOid: 'abc123',
  baseRefName: 'main',
  author: { login: 'dev' },
  headRepository: {
    nameWithOwner: 'acme/my-repo',
    url: 'https://github.com/acme/my-repo',
    owner: { login: 'acme' },
  },
  labels: { nodes: [{ name: 'enhancement', color: '84b6eb' }] },
  assignees: { nodes: [{ login: 'dev', avatarUrl: 'https://avatar.test/dev' }] },
  reviewDecision: null,
  latestReviews: { nodes: [{ author: { login: 'reviewer' }, state: 'APPROVED' }] },
  reviewRequests: { nodes: [{ requestedReviewer: { login: 'pending-reviewer' } }] },
};

const gqlPrDetailNode = {
  ...gqlPrNode,
  body: 'PR description',
  additions: 10,
  deletions: 5,
  changedFiles: 3,
  mergeable: 'MERGEABLE' as const,
  mergeStateStatus: 'CLEAN' as const,
};

// Expected mapped summary
const expectedSummary = {
  number: 42,
  title: 'feat: add widget',
  url: 'https://github.com/acme/my-repo/pull/42',
  state: 'OPEN',
  isDraft: false,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
  headRefName: 'feat/widget',
  headRefOid: 'abc123',
  baseRefName: 'main',
  author: { login: 'dev' },
  headRepository: {
    nameWithOwner: 'acme/my-repo',
    url: 'https://github.com/acme/my-repo',
    owner: { login: 'acme' },
  },
  labels: [{ name: 'enhancement', color: '84b6eb' }],
  assignees: [{ login: 'dev', avatarUrl: 'https://avatar.test/dev' }],
  reviewDecision: null,
  reviewers: [
    { login: 'pending-reviewer', state: 'PENDING' },
    { login: 'reviewer', state: 'APPROVED' },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GitHubPullRequestServiceImpl.listPullRequests', () => {
  let graphqlMock: ReturnType<typeof vi.fn>;
  let svc: GitHubPullRequestServiceImpl;

  beforeEach(() => {
    graphqlMock = vi.fn();
    svc = new GitHubPullRequestServiceImpl(makeOctokit(graphqlMock));
  });

  it('uses repository query when no search', async () => {
    graphqlMock.mockResolvedValue({
      repository: { pullRequests: { totalCount: 1, nodes: [gqlPrNode] } },
    });

    const result = await svc.listPullRequests(OWNER, REPO, { limit: 10 });

    expect(graphqlMock).toHaveBeenCalledWith(expect.stringContaining('listPullRequests'), {
      owner: OWNER,
      repo: REPO,
      limit: 10,
    });
    expect(result.prs).toEqual([expectedSummary]);
    expect(result.totalCount).toBe(1);
  });

  it('uses search query when searchQuery provided', async () => {
    graphqlMock.mockResolvedValue({
      search: { issueCount: 99, nodes: [gqlPrNode] },
    });

    const result = await svc.listPullRequests(OWNER, REPO, { searchQuery: 'widget', limit: 5 });

    expect(graphqlMock).toHaveBeenCalledWith(expect.stringContaining('searchPullRequests'), {
      query: `widget repo:${OWNER}/${REPO} is:pr is:open`,
      limit: 5,
    });
    expect(result.totalCount).toBe(99);
    expect(result.prs).toHaveLength(1);
  });

  it('returns empty on error', async () => {
    graphqlMock.mockRejectedValue(new Error('network error'));

    const result = await svc.listPullRequests(OWNER, REPO);

    expect(result).toEqual({ prs: [], totalCount: 0 });
  });

  it('clamps limit to [1, 100]', async () => {
    graphqlMock.mockResolvedValue({
      repository: { pullRequests: { totalCount: 0, nodes: [] } },
    });

    await svc.listPullRequests(OWNER, REPO, { limit: 999 });
    expect(graphqlMock).toHaveBeenCalledWith(
      expect.stringContaining('listPullRequests'),
      expect.objectContaining({ limit: 100 })
    );

    graphqlMock.mockClear();
    await svc.listPullRequests(OWNER, REPO, { limit: 0 });
    expect(graphqlMock).toHaveBeenCalledWith(
      expect.stringContaining('listPullRequests'),
      expect.objectContaining({ limit: 1 })
    );
  });

  it('builds reviewer list from reviewRequests and latestReviews', async () => {
    graphqlMock.mockResolvedValue({
      repository: { pullRequests: { totalCount: 1, nodes: [gqlPrNode] } },
    });

    const result = await svc.listPullRequests(OWNER, REPO);

    expect(result.prs[0].reviewers).toEqual([
      { login: 'pending-reviewer', state: 'PENDING' },
      { login: 'reviewer', state: 'APPROVED' },
    ]);
  });

  it('flattens labels and assignees from GraphQL nodes', async () => {
    graphqlMock.mockResolvedValue({
      repository: { pullRequests: { totalCount: 1, nodes: [gqlPrNode] } },
    });

    const result = await svc.listPullRequests(OWNER, REPO);

    expect(result.prs[0].labels).toEqual([{ name: 'enhancement', color: '84b6eb' }]);
    expect(result.prs[0].assignees).toEqual([
      { login: 'dev', avatarUrl: 'https://avatar.test/dev' },
    ]);
  });
});

describe('GitHubPullRequestServiceImpl.getPullRequestDetails', () => {
  let graphqlMock: ReturnType<typeof vi.fn>;
  let svc: GitHubPullRequestServiceImpl;

  beforeEach(() => {
    graphqlMock = vi.fn();
    svc = new GitHubPullRequestServiceImpl(makeOctokit(graphqlMock));
  });

  it('returns full detail with merge status', async () => {
    graphqlMock.mockResolvedValue({
      repository: { pullRequest: gqlPrDetailNode },
    });

    const result = await svc.getPullRequestDetails(OWNER, REPO, 42);

    expect(graphqlMock).toHaveBeenCalledWith(expect.stringContaining('getPullRequest'), {
      owner: OWNER,
      repo: REPO,
      number: 42,
    });
    expect(result).toEqual({
      ...expectedSummary,
      body: 'PR description',
      additions: 10,
      deletions: 5,
      changedFiles: 3,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
    });
  });

  it('returns null when PR not found', async () => {
    graphqlMock.mockResolvedValue({ repository: { pullRequest: null } });

    expect(await svc.getPullRequestDetails(OWNER, REPO, 999)).toBeNull();
  });

  it('returns null on error', async () => {
    graphqlMock.mockRejectedValue(new Error('not found'));

    expect(await svc.getPullRequestDetails(OWNER, REPO, 999)).toBeNull();
  });
});
