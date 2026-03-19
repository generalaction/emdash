import type { Octokit } from '@octokit/rest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubPullRequestServiceImpl } from './pr-service';

vi.mock('./octokit-provider', () => ({
  getOctokit: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOctokitFactory(
  graphqlMock?: ReturnType<typeof vi.fn>,
  restMock?: Record<string, unknown>
): () => Promise<Octokit> {
  const octokit = {
    graphql: graphqlMock ?? vi.fn(),
    rest: restMock ?? {},
  } as unknown as Octokit;
  return async () => octokit;
}

const NAME_WITH_OWNER = 'acme/my-repo';

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
    svc = new GitHubPullRequestServiceImpl(makeOctokitFactory(graphqlMock));
  });

  it('uses repository query when no search', async () => {
    graphqlMock.mockResolvedValue({
      repository: { pullRequests: { totalCount: 1, nodes: [gqlPrNode] } },
    });

    const result = await svc.listPullRequests(NAME_WITH_OWNER, { limit: 10 });

    expect(graphqlMock).toHaveBeenCalledWith(expect.stringContaining('listPullRequests'), {
      owner: 'acme',
      repo: 'my-repo',
      limit: 10,
    });
    expect(result.prs).toEqual([expectedSummary]);
    expect(result.totalCount).toBe(1);
  });

  it('uses search query when searchQuery provided', async () => {
    graphqlMock.mockResolvedValue({
      search: { issueCount: 99, nodes: [gqlPrNode] },
    });

    const result = await svc.listPullRequests(NAME_WITH_OWNER, { searchQuery: 'widget', limit: 5 });

    expect(graphqlMock).toHaveBeenCalledWith(expect.stringContaining('searchPullRequests'), {
      query: `widget repo:${NAME_WITH_OWNER} is:pr is:open`,
      limit: 5,
    });
    expect(result.totalCount).toBe(99);
    expect(result.prs).toHaveLength(1);
  });

  it('throws on error', async () => {
    graphqlMock.mockRejectedValue(new Error('network error'));

    await expect(svc.listPullRequests(NAME_WITH_OWNER)).rejects.toThrow('network error');
  });

  it('clamps limit to [1, 100]', async () => {
    graphqlMock.mockResolvedValue({
      repository: { pullRequests: { totalCount: 0, nodes: [] } },
    });

    await svc.listPullRequests(NAME_WITH_OWNER, { limit: 999 });
    expect(graphqlMock).toHaveBeenCalledWith(
      expect.stringContaining('listPullRequests'),
      expect.objectContaining({ limit: 100 })
    );

    graphqlMock.mockClear();
    await svc.listPullRequests(NAME_WITH_OWNER, { limit: 0 });
    expect(graphqlMock).toHaveBeenCalledWith(
      expect.stringContaining('listPullRequests'),
      expect.objectContaining({ limit: 1 })
    );
  });

  it('builds reviewer list from reviewRequests and latestReviews', async () => {
    graphqlMock.mockResolvedValue({
      repository: { pullRequests: { totalCount: 1, nodes: [gqlPrNode] } },
    });

    const result = await svc.listPullRequests(NAME_WITH_OWNER);

    expect(result.prs[0].reviewers).toEqual([
      { login: 'pending-reviewer', state: 'PENDING' },
      { login: 'reviewer', state: 'APPROVED' },
    ]);
  });

  it('flattens labels and assignees from GraphQL nodes', async () => {
    graphqlMock.mockResolvedValue({
      repository: { pullRequests: { totalCount: 1, nodes: [gqlPrNode] } },
    });

    const result = await svc.listPullRequests(NAME_WITH_OWNER);

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
    svc = new GitHubPullRequestServiceImpl(makeOctokitFactory(graphqlMock));
  });

  it('returns full detail with merge status', async () => {
    graphqlMock.mockResolvedValue({
      repository: { pullRequest: gqlPrDetailNode },
    });

    const result = await svc.getPullRequestDetails(NAME_WITH_OWNER, 42);

    expect(graphqlMock).toHaveBeenCalledWith(expect.stringContaining('getPullRequest'), {
      owner: 'acme',
      repo: 'my-repo',
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

    expect(await svc.getPullRequestDetails(NAME_WITH_OWNER, 999)).toBeNull();
  });

  it('throws on error', async () => {
    graphqlMock.mockRejectedValue(new Error('not found'));

    await expect(svc.getPullRequestDetails(NAME_WITH_OWNER, 999)).rejects.toThrow('not found');
  });
});

describe('GitHubPullRequestServiceImpl (REST-backed methods)', () => {
  const mockCreate = vi.fn();
  const mockMerge = vi.fn();
  const mockListFiles = vi.fn();
  const mockListReviews = vi.fn();
  const mockListComments = vi.fn();
  const mockCreateComment = vi.fn();
  const mockGraphql = vi.fn();
  const mockPaginate = vi.fn();

  const mockOctokit = {
    rest: {
      pulls: {
        create: mockCreate,
        merge: mockMerge,
        listFiles: mockListFiles,
        listReviews: mockListReviews,
      },
      issues: {
        listComments: mockListComments,
        createComment: mockCreateComment,
      },
    },
    graphql: mockGraphql,
    paginate: mockPaginate,
  } as unknown as Octokit;

  const getOctokit = vi.fn().mockResolvedValue(mockOctokit);
  let service: GitHubPullRequestServiceImpl;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new GitHubPullRequestServiceImpl(getOctokit);
  });

  it('createPullRequest returns URL and number', async () => {
    mockCreate.mockResolvedValue({
      data: { html_url: 'https://github.com/owner/repo/pull/1', number: 1 },
    });

    const result = await service.createPullRequest({
      nameWithOwner: 'owner/repo',
      head: 'feature',
      base: 'main',
      title: 'Test PR',
      draft: false,
    });

    expect(mockCreate).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      head: 'feature',
      base: 'main',
      title: 'Test PR',
      body: undefined,
      draft: false,
    });
    expect(result).toEqual({
      url: 'https://github.com/owner/repo/pull/1',
      number: 1,
    });
  });

  it('mergePullRequest supports merge strategy and optional sha', async () => {
    mockMerge.mockResolvedValue({
      data: { sha: 'abc123', merged: true, message: 'Pull Request successfully merged' },
    });

    const result = await service.mergePullRequest('owner/repo', 42, {
      strategy: 'squash',
      commitHeadOid: 'def456',
    });

    expect(mockMerge).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      pull_number: 42,
      merge_method: 'squash',
      sha: 'def456',
    });
    expect(result).toEqual({ sha: 'abc123', merged: true });
  });

  it('getCheckRuns maps check run buckets and status contexts', async () => {
    mockGraphql.mockResolvedValue({
      repository: {
        pullRequest: {
          commits: {
            nodes: [
              {
                commit: {
                  statusCheckRollup: {
                    contexts: {
                      pageInfo: { hasNextPage: false, endCursor: null },
                      nodes: [
                        {
                          __typename: 'CheckRun',
                          name: 'CI',
                          status: 'COMPLETED',
                          conclusion: 'SUCCESS',
                          detailsUrl: 'https://github.com/runs/1',
                          startedAt: '2026-01-01T00:00:00Z',
                          completedAt: '2026-01-01T00:02:00Z',
                          checkSuite: {
                            workflowRun: { workflow: { name: 'Build' } },
                          },
                        },
                        {
                          __typename: 'CheckRun',
                          name: 'Lint',
                          status: 'IN_PROGRESS',
                          conclusion: null,
                          detailsUrl: null,
                          startedAt: '2026-01-01T00:01:00Z',
                          completedAt: null,
                          checkSuite: null,
                        },
                        {
                          __typename: 'CheckRun',
                          name: 'CodeQL',
                          status: 'COMPLETED',
                          conclusion: 'NEUTRAL',
                          detailsUrl: null,
                          startedAt: '2026-01-01T00:01:00Z',
                          completedAt: '2026-01-01T00:05:00Z',
                          checkSuite: null,
                        },
                        {
                          __typename: 'StatusContext',
                          context: 'deploy/preview',
                          state: 'FAILURE',
                          targetUrl: 'https://deploy.example.com',
                          createdAt: '2026-01-01T00:00:00Z',
                        },
                      ],
                    },
                  },
                },
              },
            ],
          },
        },
      },
    });

    const result = await service.getCheckRuns('owner/repo', 42);

    expect(result).toEqual([
      {
        name: 'CI',
        bucket: 'pass',
        workflowName: 'Build',
        detailsUrl: 'https://github.com/runs/1',
        startedAt: '2026-01-01T00:00:00Z',
        completedAt: '2026-01-01T00:02:00Z',
      },
      {
        name: 'Lint',
        bucket: 'pending',
        workflowName: undefined,
        detailsUrl: undefined,
        startedAt: '2026-01-01T00:01:00Z',
        completedAt: undefined,
      },
      {
        name: 'CodeQL',
        bucket: 'skipping',
        workflowName: undefined,
        detailsUrl: undefined,
        startedAt: '2026-01-01T00:01:00Z',
        completedAt: '2026-01-01T00:05:00Z',
      },
      {
        name: 'deploy/preview',
        bucket: 'fail',
        detailsUrl: 'https://deploy.example.com',
        startedAt: '2026-01-01T00:00:00Z',
      },
    ]);
  });

  it('getPrComments filters out PENDING reviews', async () => {
    mockPaginate
      .mockResolvedValueOnce([
        {
          id: 1,
          user: { login: 'alice', avatar_url: 'https://a.com/alice.png' },
          body: 'Looks good',
          created_at: '2026-01-01T00:00:00Z',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 2,
          user: { login: 'bob', avatar_url: 'https://a.com/bob.png' },
          body: 'LGTM',
          submitted_at: '2026-01-01T01:00:00Z',
          state: 'APPROVED',
          commit_id: 'abc',
        },
        {
          id: 3,
          user: { login: 'carol' },
          body: '',
          submitted_at: '2026-01-01T02:00:00Z',
          state: 'COMMENTED',
          commit_id: 'def',
        },
        {
          id: 4,
          user: { login: 'dana' },
          body: 'Still working on this',
          submitted_at: null,
          updated_at: '2026-01-01T03:00:00Z',
          state: 'PENDING',
          commit_id: 'ghi',
        },
      ]);

    const result = await service.getPrComments('owner/repo', 42);

    expect(result.comments).toHaveLength(1);
    expect(result.comments[0].author.login).toBe('alice');
    expect(result.reviews).toHaveLength(1);
    expect(result.reviews[0].state).toBe('APPROVED');
    expect(result.reviews.every((r) => r.state !== 'PENDING')).toBe(true);
  });

  it('addPrComment returns created id', async () => {
    mockCreateComment.mockResolvedValue({ data: { id: 99 } });

    const result = await service.addPrComment('owner/repo', 42, 'Nice work!');

    expect(mockCreateComment).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      issue_number: 42,
      body: 'Nice work!',
    });
    expect(result).toEqual({ id: 99 });
  });

  it('getPullRequestFiles maps paginated response', async () => {
    mockPaginate.mockResolvedValue([
      {
        filename: 'src/foo.ts',
        status: 'modified',
        additions: 10,
        deletions: 3,
        patch: '@@ -1,3 +1,10 @@\n+added line',
      },
      {
        filename: 'src/bar.ts',
        status: 'added',
        additions: 25,
        deletions: 0,
        patch: '@@ -0,0 +1,25 @@\n+new file',
      },
    ]);

    const result = await service.getPullRequestFiles('owner/repo', 42);

    expect(mockPaginate).toHaveBeenCalledWith(mockListFiles, {
      owner: 'owner',
      repo: 'repo',
      pull_number: 42,
      per_page: 100,
    });
    expect(result).toEqual([
      {
        filename: 'src/foo.ts',
        status: 'modified',
        additions: 10,
        deletions: 3,
        patch: '@@ -1,3 +1,10 @@\n+added line',
      },
      {
        filename: 'src/bar.ts',
        status: 'added',
        additions: 25,
        deletions: 0,
        patch: '@@ -0,0 +1,25 @@\n+new file',
      },
    ]);
  });
});
