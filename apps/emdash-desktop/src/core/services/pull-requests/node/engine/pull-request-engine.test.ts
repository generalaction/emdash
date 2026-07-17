import { ok } from '@emdash/shared/result';
import { createStubLogger } from '@emdash/shared/testing';
import type { ContractClient } from '@emdash/wire/api';
import type { Octokit } from '@octokit/rest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GitHubAuthContract, PullRequest, SyncState } from '../../api';
import { PullRequestStore, pullRequestSqliteStore } from '../store';
import { PullRequestEngine } from './pull-request-engine';

const closeHandles: Array<() => void> = [];

afterEach(() => {
  while (closeHandles.length > 0) closeHandles.pop()?.();
});

describe('PullRequestEngine', () => {
  it('syncs GitHub pull requests into the private store and emits state', async () => {
    const handle = await pullRequestSqliteStore.openTemp();
    closeHandles.push(() => handle.close());
    const store = new PullRequestStore(handle);
    const repositoryUrl = 'https://github.com/emdash/emdash';
    store.registerRepository(repositoryUrl);
    const states: SyncState[] = [];
    const graphql = vi.fn(async () => ({
      repository: {
        pullRequests: {
          totalCount: 1,
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [gqlPullRequest()],
        },
      },
    }));
    const { logger } = createStubLogger();
    const engine = new PullRequestEngine({
      store,
      githubAuth: fakeGitHubAuth(),
      logger,
      createOctokit: () => fakeOctokit(graphql),
      onSyncState: (_repositoryUrl, state) => states.push(state),
    });

    const result = await engine.sync(repositoryUrl, new AbortController().signal);
    expect(result).toEqual(ok());
    expect(
      store.listPullRequests({ repositoryUrls: [repositoryUrl], cursor: null, limit: 10 }).prs
    ).toMatchObject([
      {
        title: 'Worker-owned PR',
        identifier: '#42',
        author: { userId: 'github.com:1' },
      },
    ]);
    expect(store.getCursor(repositoryUrl, 'full')?.done).toBe(true);
    expect(store.getCursor(repositoryUrl, 'full')?.lastUpdatedAt).toBe('2026-01-02T00:00:00.000Z');
    expect(states.at(-1)).toMatchObject({ phase: 'idle', kind: 'full', synced: 1 });
  });

  it('aborts an in-flight request without advancing its cursor', async () => {
    const handle = await pullRequestSqliteStore.openTemp();
    closeHandles.push(() => handle.close());
    const store = new PullRequestStore(handle);
    const repositoryUrl = 'https://github.com/emdash/emdash';
    store.registerRepository(repositoryUrl);
    let started = false;
    const graphql = vi.fn(
      async (_query: string, variables: { request: { signal: AbortSignal } }) =>
        await new Promise<never>((_resolve, reject) => {
          started = true;
          variables.request.signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true }
          );
        })
    );
    const { logger } = createStubLogger();
    const states: SyncState[] = [];
    const engine = new PullRequestEngine({
      store,
      githubAuth: fakeGitHubAuth(),
      logger,
      createOctokit: () => fakeOctokit(graphql),
      onSyncState: (_repositoryUrl, state) => states.push(state),
    });
    const controller = new AbortController();

    const sync = engine.sync(repositoryUrl, controller.signal);
    await vi.waitFor(() => expect(started).toBe(true));
    controller.abort(new Error('Scope disposed'));
    const result = await sync;
    expect(result.success).toBe(false);
    expect(store.getCursor(repositoryUrl, 'full')).toBeNull();
    expect(states.at(-1)).toMatchObject({ phase: 'idle', kind: 'full' });
  });

  it('resumes incremental sync without skipping older pages', async () => {
    const handle = await pullRequestSqliteStore.openTemp();
    closeHandles.push(() => handle.close());
    const store = new PullRequestStore(handle);
    const repositoryUrl = 'https://github.com/emdash/emdash';
    store.registerRepository(repositoryUrl);
    store.setCursor(repositoryUrl, 'full', {
      lastUpdatedAt: '2026-01-01T00:00:00.000Z',
      done: true,
    });
    const firstAttempt = vi
      .fn()
      .mockResolvedValueOnce({
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: true, endCursor: 'page-2' },
            nodes: [
              gqlPullRequest({
                number: 43,
                title: 'Newest page',
                updatedAt: '2026-01-03T00:00:00.000Z',
              }),
            ],
          },
        },
      })
      .mockRejectedValueOnce(Object.assign(new Error('Worker stopped'), { status: 400 }));
    const { logger } = createStubLogger();
    const interruptedEngine = new PullRequestEngine({
      store,
      githubAuth: fakeGitHubAuth(),
      logger,
      createOctokit: () => fakeOctokit(firstAttempt),
    });

    expect(
      (await interruptedEngine.sync(repositoryUrl, new AbortController().signal)).success
    ).toBe(false);
    expect(store.getCursor(repositoryUrl, 'incremental')).toEqual({
      lastUpdatedAt: '2026-01-01T00:00:00.000Z',
      pageCursor: 'page-2',
      done: false,
    });

    const resumedGraphql = vi.fn(async () => ({
      repository: {
        pullRequests: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            gqlPullRequest({
              number: 44,
              title: 'Older page',
              updatedAt: '2026-01-02T00:00:00.000Z',
            }),
          ],
        },
      },
    }));
    const resumedEngine = new PullRequestEngine({
      store,
      githubAuth: fakeGitHubAuth(),
      logger,
      createOctokit: () => fakeOctokit(resumedGraphql),
    });

    expect(await resumedEngine.sync(repositoryUrl, new AbortController().signal)).toEqual(ok());
    expect(resumedGraphql).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ cursor: 'page-2' })
    );
    expect(
      store.listPullRequests({ repositoryUrls: [repositoryUrl], cursor: null, limit: 10 }).prs
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ identifier: '#43' }),
        expect.objectContaining({ identifier: '#44' }),
      ])
    );
    expect(store.getCursor(repositoryUrl, 'incremental')).toEqual({
      lastUpdatedAt: '2026-01-03T00:00:00.000Z',
      pageCursor: undefined,
      done: true,
    });
  });

  it('emits a terminal error state when a single pull request is not found', async () => {
    const handle = await pullRequestSqliteStore.openTemp();
    closeHandles.push(() => handle.close());
    const store = new PullRequestStore(handle);
    store.registerRepository('https://github.com/emdash/emdash');
    const states: SyncState[] = [];
    const { logger } = createStubLogger();
    const engine = new PullRequestEngine({
      store,
      githubAuth: fakeGitHubAuth(),
      logger,
      createOctokit: () =>
        fakeOctokit(
          vi.fn(async () => ({
            repository: { pullRequest: null },
          }))
        ),
      onSyncState: (_repositoryUrl, state) => states.push(state),
    });

    const result = await engine.syncSingle(
      'https://github.com/emdash/emdash',
      404,
      new AbortController().signal
    );

    expect(result.success).toBe(false);
    expect(states.at(-1)).toMatchObject({
      phase: 'error',
      kind: 'single',
      error: {
        type: 'github_not_found_or_no_access',
        host: 'github.com',
        message: 'Pull request #404 was not found',
      },
    });

    const stateCount = states.length;
    const quietResult = await engine.syncSingle(
      'https://github.com/emdash/emdash',
      404,
      new AbortController().signal,
      { emit: false }
    );
    expect(quietResult.success).toBe(false);
    expect(states).toHaveLength(stateCount);
  });

  it('emits only completion when a quiet single refresh succeeds', async () => {
    const handle = await pullRequestSqliteStore.openTemp();
    closeHandles.push(() => handle.close());
    const store = new PullRequestStore(handle);
    const repositoryUrl = 'https://github.com/emdash/emdash';
    store.registerRepository(repositoryUrl);
    const states: SyncState[] = [];
    const { logger } = createStubLogger();
    const engine = new PullRequestEngine({
      store,
      githubAuth: fakeGitHubAuth(),
      logger,
      createOctokit: () =>
        fakeOctokit(
          vi.fn(async () => ({
            repository: { pullRequest: gqlPullRequest() },
          }))
        ),
      onSyncState: (_repositoryUrl, state) => states.push(state),
    });

    await expect(
      engine.syncSingle(repositoryUrl, 42, new AbortController().signal, { emit: false })
    ).resolves.toMatchObject({ success: true });
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({
      phase: 'idle',
      kind: 'single',
      synced: 1,
      lastSyncedAt: expect.any(Number),
    });
  });

  it('falls back to a full sync after incremental overflow', async () => {
    const handle = await pullRequestSqliteStore.openTemp();
    closeHandles.push(() => handle.close());
    const store = new PullRequestStore(handle);
    const repositoryUrl = 'https://github.com/emdash/emdash';
    store.registerRepository(repositoryUrl);
    store.setCursor(repositoryUrl, 'full', {
      lastUpdatedAt: '2026-01-01T00:00:00.000Z',
      done: true,
    });
    const graphql = vi
      .fn()
      .mockResolvedValueOnce({
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: true, endCursor: 'page-2' },
            nodes: [gqlPullRequest({ updatedAt: '2026-01-03T00:00:00.000Z' })],
          },
        },
      })
      .mockResolvedValueOnce({
        repository: {
          pullRequests: {
            totalCount: 0,
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [],
          },
        },
      });
    const { logger } = createStubLogger();
    const engine = new PullRequestEngine({
      store,
      githubAuth: fakeGitHubAuth(),
      logger,
      maxSyncCount: 1,
      createOctokit: () => fakeOctokit(graphql),
    });

    await expect(engine.sync(repositoryUrl, new AbortController().signal)).resolves.toEqual(ok());
    expect(store.getCursor(repositoryUrl, 'full')).toBeNull();
    await expect(engine.sync(repositoryUrl, new AbortController().signal)).resolves.toEqual(ok());
    expect(graphql).toHaveBeenCalledTimes(2);
    expect(store.getCursor(repositoryUrl, 'full')?.done).toBe(true);
  });

  it('host-qualifies REST comment author IDs', async () => {
    const handle = await pullRequestSqliteStore.openTemp();
    closeHandles.push(() => handle.close());
    const store = new PullRequestStore(handle);
    const repositoryUrl = 'https://github.com/emdash/emdash';
    store.registerRepository(repositoryUrl);
    const listComments = vi.fn();
    const listReviewComments = vi.fn();
    const listReviews = vi.fn();
    const paginate = vi.fn(async (method: unknown) =>
      method === listComments
        ? [
            {
              id: 7,
              body: 'Comment',
              html_url: `${repositoryUrl}/pull/42#issuecomment-7`,
              created_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-01-01T00:00:00.000Z',
              user: {
                id: 1,
                login: 'octocat',
                avatar_url: 'https://github.com/images/octocat.png',
                html_url: 'https://github.com/octocat',
              },
            },
          ]
        : []
    );
    const octokit = {
      graphql: vi.fn(),
      paginate,
      rest: {
        issues: { listComments },
        pulls: { listReviewComments, listReviews },
      },
    } as unknown as Octokit;
    const { logger } = createStubLogger();
    const engine = new PullRequestEngine({
      store,
      githubAuth: fakeGitHubAuth(),
      logger,
      createOctokit: () => octokit,
    });

    const result = await engine.getPullRequestComments(
      repositoryUrl,
      42,
      new AbortController().signal
    );

    expect(result).toMatchObject({
      success: true,
      data: [{ author: { userId: 'github.com:1' } }],
    });
  });

  it('keeps check IDs stable across refreshes', async () => {
    const handle = await pullRequestSqliteStore.openTemp();
    closeHandles.push(() => handle.close());
    const store = new PullRequestStore(handle);
    const repositoryUrl = 'https://github.com/emdash/emdash';
    const pullRequestUrl = `${repositoryUrl}/pull/42`;
    store.registerRepository(repositoryUrl);
    store.savePullRequest(pullRequestFixture());
    const graphql = vi.fn(async () => ({
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
                          detailsUrl: 'https://github.com/checks/1',
                          startedAt: '2026-01-01T00:00:00.000Z',
                          completedAt: '2026-01-01T00:01:00.000Z',
                          checkSuite: null,
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
    }));
    const { logger } = createStubLogger();
    const states: SyncState[] = [];
    const engine = new PullRequestEngine({
      store,
      githubAuth: fakeGitHubAuth(),
      logger,
      createOctokit: () => fakeOctokit(graphql),
      onSyncState: (_repositoryUrl, state) => states.push(state),
    });

    await engine.syncChecks(repositoryUrl, pullRequestUrl, 'head', new AbortController().signal);
    const firstId = store.listPullRequests({
      repositoryUrls: [repositoryUrl],
      cursor: null,
      limit: 10,
    }).prs[0]?.checks[0]?.id;
    await engine.syncChecks(repositoryUrl, pullRequestUrl, 'head', new AbortController().signal);
    const secondId = store.listPullRequests({
      repositoryUrls: [repositoryUrl],
      cursor: null,
      limit: 10,
    }).prs[0]?.checks[0]?.id;

    expect(firstId).toBe('head:0:CI');
    expect(secondId).toBe(firstId);
    expect(states.at(-1)).toMatchObject({
      phase: 'idle',
      kind: 'single',
      lastSyncedAt: expect.any(Number),
    });
  });
});

function fakeGitHubAuth(): ContractClient<GitHubAuthContract> {
  return {
    resolveAuth: async () =>
      ok({
        token: 'test-token',
        host: 'github.com',
        apiBaseUrl: 'https://api.github.com',
      }),
  };
}

function fakeOctokit(graphql: (...args: never[]) => Promise<unknown>): Octokit {
  return {
    graphql,
    rest: {},
    paginate: vi.fn(),
  } as unknown as Octokit;
}

function gqlPullRequest(overrides: { number?: number; title?: string; updatedAt?: string } = {}) {
  return {
    number: overrides.number ?? 42,
    title: overrides.title ?? 'Worker-owned PR',
    url: `https://github.com/emdash/emdash/pull/${overrides.number ?? 42}`,
    state: 'OPEN',
    isDraft: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-01-02T00:00:00.000Z',
    headRefName: 'feature',
    headRefOid: 'head',
    baseRefName: 'main',
    baseRefOid: 'base',
    commitCount: { totalCount: 1 },
    body: 'Description',
    additions: 10,
    deletions: 1,
    changedFiles: 2,
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    author: {
      databaseId: 1,
      login: 'octocat',
      avatarUrl: '',
      url: 'https://github.com/octocat',
    },
    headRepository: { url: 'https://github.com/emdash/emdash' },
    baseRepository: { url: 'https://github.com/emdash/emdash' },
    labels: { nodes: [{ name: 'feature', color: '00ff00' }] },
    assignees: { nodes: [] },
    reviewDecision: null,
  };
}

function pullRequestFixture(): PullRequest {
  const repositoryUrl = 'https://github.com/emdash/emdash';
  return {
    url: `${repositoryUrl}/pull/42`,
    provider: 'github',
    repositoryUrl,
    baseRefName: 'main',
    baseRefOid: 'base',
    headRepositoryUrl: repositoryUrl,
    headRefName: 'feature',
    headRefOid: 'head',
    identifier: '#42',
    title: 'Feature',
    description: null,
    status: 'open',
    isDraft: false,
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    commitCount: 1,
    mergeableStatus: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    reviewDecision: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    author: null,
    labels: [],
    assignees: [],
    checks: [],
  };
}
