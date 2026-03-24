import type { Octokit } from '@octokit/rest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// Retrieve the exposed mock handles after the module is set up
import { _mocks as dbMocks } from '@main/db/client';
import { PrService } from './pr-service';

vi.mock('@main/core/github/services/octokit-provider', () => ({
  getOctokit: vi.fn(),
}));

vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: { getProject: vi.fn() },
}));

vi.mock('@main/core/projects/utils', () => ({
  resolveTask: vi.fn(),
}));

// ---------------------------------------------------------------------------
// DB mock — makes upsert a transparent passthrough during unit tests.
// The db module is mocked with a chainable builder. mockReturning and
// mockOrderBy are exposed so individual tests can control return values.
// ---------------------------------------------------------------------------

vi.mock('@main/db/client', () => {
  const mockReturning = vi.fn().mockResolvedValue([]);
  const mockOnConflict = vi.fn().mockReturnValue({ returning: mockReturning });
  const mockValues = vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflict });
  const mockInsert = vi.fn().mockReturnValue({ values: mockValues });

  const mockOrderBy = vi.fn().mockResolvedValue([]);
  const mockLimit = vi.fn().mockResolvedValue([]);
  const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy, limit: mockLimit });
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere, orderBy: mockOrderBy });
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

  // Expose via module so tests can access them via import
  return {
    db: { insert: mockInsert, select: mockSelect },
    _mocks: { mockReturning, mockOrderBy },
  };
});

const { mockReturning, mockOrderBy } = dbMocks as {
  mockReturning: ReturnType<typeof vi.fn>;
  mockOrderBy: ReturnType<typeof vi.fn>;
};

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

/** Produce a fake DB row that round-trips through dbRowToUnified → expectedUnified. */
function makeFakeDbRow(pr: {
  url: string;
  provider: string;
  nameWithOwner: string;
  title: string;
  status: string;
  author: unknown;
  isDraft: boolean;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    id: pr.url,
    provider: pr.provider,
    nameWithOwner: pr.nameWithOwner,
    url: pr.url,
    title: pr.title,
    status: pr.status,
    author: JSON.stringify(pr.author),
    isDraft: Number(pr.isDraft),
    metadata: JSON.stringify(pr.metadata),
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    fetchedAt: '2024-01-02T00:00:00Z',
  };
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
  body: 'PR description',
  additions: 10,
  deletions: 5,
  changedFiles: 3,
  mergeable: 'MERGEABLE' as const,
  mergeStateStatus: 'CLEAN' as const,
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

const expectedUnified = {
  id: 'https://github.com/acme/my-repo/pull/42',
  identifier: '#42',
  nameWithOwner: 'acme/my-repo',
  provider: 'github',
  url: 'https://github.com/acme/my-repo/pull/42',
  title: 'feat: add widget',
  status: 'open',
  author: { userName: 'dev', displayName: 'dev' },
  isDraft: false,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
  metadata: {
    number: 42,
    headRefName: 'feat/widget',
    headRefOid: 'abc123',
    baseRefName: 'main',
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
    body: 'PR description',
    additions: 10,
    deletions: 5,
    changedFiles: 3,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PrService.listPullRequests (invalidate=true)', () => {
  let graphqlMock: ReturnType<typeof vi.fn>;
  let svc: PrService;

  beforeEach(() => {
    vi.clearAllMocks();
    graphqlMock = vi.fn();
    svc = new PrService(makeOctokitFactory(graphqlMock));
    mockReturning.mockResolvedValue([makeFakeDbRow(expectedUnified)]);
  });

  it('uses repository query when no search', async () => {
    graphqlMock.mockResolvedValue({
      repository: { pullRequests: { totalCount: 1, nodes: [gqlPrNode] } },
    });

    const result = await svc.listPullRequests(NAME_WITH_OWNER, { limit: 10 }, true);

    expect(graphqlMock).toHaveBeenCalledWith(expect.stringContaining('listPullRequests'), {
      owner: 'acme',
      repo: 'my-repo',
      limit: 10,
    });
    expect(result).toEqual([expectedUnified]);
  });

  it('uses search query when searchQuery provided', async () => {
    graphqlMock.mockResolvedValue({
      search: { nodes: [gqlPrNode] },
    });

    const result = await svc.listPullRequests(
      NAME_WITH_OWNER,
      { searchQuery: 'widget', limit: 5 },
      true
    );

    expect(graphqlMock).toHaveBeenCalledWith(expect.stringContaining('searchPullRequests'), {
      query: `widget repo:${NAME_WITH_OWNER} is:pr is:open`,
      limit: 5,
    });
    expect(result).toHaveLength(1);
  });

  it('clamps limit to [1, 100]', async () => {
    graphqlMock.mockResolvedValue({
      repository: { pullRequests: { nodes: [] } },
    });

    await svc.listPullRequests(NAME_WITH_OWNER, { limit: 999 }, true);
    expect(graphqlMock).toHaveBeenCalledWith(
      expect.stringContaining('listPullRequests'),
      expect.objectContaining({ limit: 100 })
    );

    graphqlMock.mockClear();
    await svc.listPullRequests(NAME_WITH_OWNER, { limit: 0 }, true);
    expect(graphqlMock).toHaveBeenCalledWith(
      expect.stringContaining('listPullRequests'),
      expect.objectContaining({ limit: 1 })
    );
  });

  it('builds reviewer list from reviewRequests and latestReviews', async () => {
    graphqlMock.mockResolvedValue({
      repository: { pullRequests: { nodes: [gqlPrNode] } },
    });

    const result = await svc.listPullRequests(NAME_WITH_OWNER, {}, true);

    expect(result[0].metadata.reviewers).toEqual([
      { login: 'pending-reviewer', state: 'PENDING' },
      { login: 'reviewer', state: 'APPROVED' },
    ]);
  });

  it('returns data from DB without fetching GitHub when invalidate=false', async () => {
    mockOrderBy.mockResolvedValue([makeFakeDbRow(expectedUnified)]);

    const result = await svc.listPullRequests(NAME_WITH_OWNER);

    expect(graphqlMock).not.toHaveBeenCalled();
    expect(result).toEqual([expectedUnified]);
  });
});

describe('PrService.getPullRequest (invalidate=true)', () => {
  let graphqlMock: ReturnType<typeof vi.fn>;
  let svc: PrService;

  beforeEach(() => {
    vi.clearAllMocks();
    graphqlMock = vi.fn();
    svc = new PrService(makeOctokitFactory(graphqlMock));
    mockReturning.mockResolvedValue([makeFakeDbRow(expectedUnified)]);
  });

  it('fetches a single PR by number and returns unified model', async () => {
    graphqlMock.mockResolvedValue({
      repository: { pullRequest: gqlPrNode },
    });

    const result = await svc.getPullRequest(NAME_WITH_OWNER, 42, true);

    expect(graphqlMock).toHaveBeenCalledWith(expect.stringContaining('getPullRequest'), {
      owner: 'acme',
      repo: 'my-repo',
      number: 42,
    });
    expect(result).toEqual(expectedUnified);
  });

  it('returns null when PR not found', async () => {
    graphqlMock.mockResolvedValue({ repository: { pullRequest: null } });

    expect(await svc.getPullRequest(NAME_WITH_OWNER, 999, true)).toBeNull();
  });

  it('throws on error', async () => {
    graphqlMock.mockRejectedValue(new Error('not found'));

    await expect(svc.getPullRequest(NAME_WITH_OWNER, 999, true)).rejects.toThrow('not found');
  });
});

describe('PrService (REST-backed methods)', () => {
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
  let service: PrService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new PrService(getOctokit);
    mockReturning.mockResolvedValue([makeFakeDbRow(expectedUnified)]);
  });

  it('createPullRequest returns URL and number', async () => {
    mockCreate.mockResolvedValue({
      data: { html_url: 'https://github.com/owner/repo/pull/1', number: 1 },
    });
    // Subsequent getPullRequest(invalidate=true) call
    mockGraphql.mockResolvedValue({ repository: { pullRequest: gqlPrNode } });

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
    // Subsequent getPullRequest(invalidate=true) call
    mockGraphql.mockResolvedValue({ repository: { pullRequest: gqlPrNode } });

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
