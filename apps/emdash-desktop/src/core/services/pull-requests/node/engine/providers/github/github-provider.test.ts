import { err, ok } from '@emdash/shared';
import { createScope, type Scope } from '@emdash/shared/concurrency';
import {
  requestPriorities,
  type CreateRequestSchedulerOptions,
  type RateGate,
  type RequestScheduler,
  type ScheduledRequest,
} from '@emdash/shared/requests';
import { retrySchedules } from '@emdash/shared/scheduling';
import { createStubLogger } from '@emdash/shared/testing';
import type { ContractClient } from '@emdash/wire/rpc';
import type { Octokit } from '@octokit/rest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GitPlatformAuthContract } from '../../../../api';
import { GitHubProvider, type GitHubProviderOptions } from './github-provider';

const scopes: Scope[] = [];
const repositoryUrl = 'https://github.com/emdash/emdash';
afterEach(async () => {
  await Promise.all(scopes.splice(0).map(async (scope) => await scope.dispose()));
  vi.useRealTimers();
});
async function repository(provider: GitHubProvider) {
  const result = await provider.openRepository(repositoryUrl, new AbortController().signal);
  if (!result.success) throw new Error(result.error.type);
  return result.data;
}

describe('GitHub pull request provider (without persistence)', () => {
  it('returns mapped metadata and pagination evidence without a cache', async () => {
    const graphql = vi.fn(async () => ({
      repository: {
        pullRequests: {
          totalCount: 101,
          pageInfo: { hasNextPage: true, endCursor: 'next' },
          nodes: [gqlPullRequest()],
        },
      },
    }));
    const { logger } = createStubLogger();
    const provider = createProvider({
      githubAuth: fakeGitHubAuth(),
      logger,
      createOctokit: () => fakeOctokit(graphql),
    });
    expect(
      await (await repository(provider)).fetchOpenPage(null, new AbortController().signal)
    ).toMatchObject({
      success: true,
      data: {
        fetchedAt: expect.any(Number),
        data: {
          pageInfo: { hasNextPage: true, endCursor: 'next' },
          prs: [
            { title: 'Worker-owned PR', identifier: '#42', author: { userId: 'github.com:1' } },
          ],
        },
      },
    });
    expect(graphql).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['account_unresolvable', 'github_account_not_found'],
    ['github_disabled', 'github_disabled'],
  ])('surfaces %s before making requests', async (authType, expectedType) => {
    const graphql = vi.fn();
    const { logger } = createStubLogger();
    const provider = createProvider({
      githubAuth: {
        resolveAuth: async () =>
          err({ type: authType, host: 'github.com', message: 'Account unavailable' }),
      } as ContractClient<GitPlatformAuthContract>,
      logger,
      createOctokit: () => fakeOctokit(graphql),
    });
    expect(
      await provider.openRepository(repositoryUrl, new AbortController().signal)
    ).toMatchObject({
      success: false,
      error: { type: expectedType, message: 'Account unavailable' },
    });
    expect(graphql).not.toHaveBeenCalled();
  });
  it('does not mutate shared provider responses while completing nested pagination', async () => {
    const node = {
      ...gqlPullRequest(),
      labels: {
        nodes: [{ name: 'first', color: '00ff00' }],
        pageInfo: { hasNextPage: true, endCursor: 'labels-next' },
      },
    };
    const graphql = vi.fn(async (query: string) =>
      query.includes('pullRequestCollections')
        ? {
            repository: {
              pullRequest: {
                labels: {
                  nodes: [{ name: 'second', color: 'ff0000' }],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
                assignees: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
              },
            },
          }
        : { repository: { pullRequest: node } }
    );
    const { logger } = createStubLogger();
    const provider = createProvider({
      githubAuth: fakeGitHubAuth(),
      logger,
      createOctokit: () => fakeOctokit(graphql),
    });
    const context = await repository(provider);
    const observations = await Promise.all([
      context.fetchPullRequest(42, new AbortController().signal),
      context.fetchPullRequest(42, new AbortController().signal),
    ]);
    for (const observation of observations) {
      expect(observation).toMatchObject({
        success: true,
        data: {
          data: {
            labels: [{ name: 'first' }, { name: 'second' }],
          },
        },
      });
    }
    expect(node.labels.nodes).toHaveLength(1);
  });

  it('captures request-start rather than completion time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    let resolve!: (value: unknown) => void;
    const graphql = vi.fn(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const { logger } = createStubLogger();
    const provider = createProvider({
      githubAuth: fakeGitHubAuth(),
      logger,
      createOctokit: () => fakeOctokit(graphql),
    });
    const context = await repository(provider);
    const pending = context.fetchPullRequest(42, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(0);
    vi.setSystemTime(10_000);
    resolve({ repository: { pullRequest: gqlPullRequest() } });
    expect(await pending).toMatchObject({ success: true, data: { fetchedAt: 1_000 } });
  });
  it('returns a missing PR failure', async () => {
    const graphql = vi.fn(async () => ({ repository: { pullRequest: null } }));
    const { logger } = createStubLogger();
    const provider = createProvider({
      githubAuth: fakeGitHubAuth(),
      logger,
      createOctokit: () => fakeOctokit(graphql),
    });
    expect(
      await (await repository(provider)).fetchPullRequest(42, new AbortController().signal)
    ).toMatchObject({
      success: false,
      error: { type: 'github_not_found_or_no_access' },
    });
  });
  it('does not return an observation after cancellation', async () => {
    const controller = new AbortController();
    const graphql = vi.fn(async () => {
      controller.abort();
      return { repository: { pullRequest: gqlPullRequest() } };
    });
    const { logger } = createStubLogger();
    const provider = createProvider({
      githubAuth: fakeGitHubAuth(),
      logger,
      createOctokit: () => fakeOctokit(graphql),
    });
    const context = await repository(provider);
    expect(await context.fetchPullRequest(42, controller.signal)).toMatchObject({
      success: false,
    });
  });
  it('fetches actual comment collections every time and host-qualifies authors', async () => {
    const github = fakeCommentsOctokit({ issueComments: [restIssueComment()] });
    const { logger } = createStubLogger();
    const provider = createProvider({
      githubAuth: fakeGitHubAuth(),
      logger,
      createOctokit: () => github.octokit,
    });
    const context = await repository(provider);
    for (let i = 0; i < 2; i++) {
      expect(await context.fetchComments(42, new AbortController().signal)).toMatchObject({
        success: true,
        data: {
          fetchedAt: expect.any(Number),
          data: [{ author: { userId: 'github.com:1' }, body: 'Comment' }],
        },
      });
    }
    expect(github.paginate).toHaveBeenCalledTimes(6);
    expect(github.get).not.toHaveBeenCalled();
  });
  it('returns no partial comments observation when a collection fails', async () => {
    const github = fakeCommentsOctokit({});
    github.paginate.mockRejectedValueOnce(new Error('Unavailable'));
    const { logger } = createStubLogger();
    const provider = createProvider({
      githubAuth: fakeGitHubAuth(),
      logger,
      createOctokit: () => github.octokit,
      retrySchedule: retrySchedules.fixed(0, 0),
    });
    expect(
      await (await repository(provider)).fetchComments(42, new AbortController().signal)
    ).toMatchObject({ success: false });
  });
  it('returns head evidence and stable check IDs', async () => {
    const graphql = vi.fn(async () => checkResponse('head'));
    const { logger } = createStubLogger();
    const provider = createProvider({
      githubAuth: fakeGitHubAuth(),
      logger,
      createOctokit: () => fakeOctokit(graphql),
    });
    const context = await repository(provider);
    const first = await context.fetchChecks(42, new AbortController().signal);
    const second = await context.fetchChecks(42, new AbortController().signal);
    expect(first).toMatchObject({
      success: true,
      data: {
        data: {
          headRefOid: 'head',
          checks: [
            {
              id: expect.any(String),
              status: 'REQUESTED',
            },
          ],
        },
      },
    });
    if (!first.success || !second.success) throw new Error('Checks failed');
    expect(first.data.data.checks).toEqual(second.data.data.checks);
  });
  it('rejects check pagination across different heads', async () => {
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(checkResponse('old-head', true, 'next'))
      .mockResolvedValueOnce(checkResponse('new-head'));
    const { logger } = createStubLogger();
    const provider = createProvider({
      githubAuth: fakeGitHubAuth(),
      logger,
      createOctokit: () => fakeOctokit(graphql),
    });
    expect(
      await (await repository(provider)).fetchChecks(42, new AbortController().signal)
    ).toMatchObject({ success: false });
  });
  it('schedules background sync pages with retry through one account lane', async () => {
    const graphql = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('Unavailable'), { status: 503 }))
      .mockResolvedValueOnce({
        repository: {
          pullRequests: {
            totalCount: 0,
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [],
          },
        },
      });
    const requests: ScheduledRequest<unknown>[] = [];
    const scheduler = immediateScheduler(requests);
    const createScheduler = vi.fn((_options: CreateRequestSchedulerOptions) => scheduler);
    const { logger } = createStubLogger();
    const provider = createProvider({
      githubAuth: fakeGitHubAuth('account-1'),
      logger,
      createOctokit: () => fakeOctokit(graphql),
      createScheduler,
      retrySchedule: retrySchedules.fixed(0, 1),
    });

    await expect(
      (await repository(provider)).fetchHistoryPage(
        null,
        new AbortController().signal,
        requestPriorities.background
      )
    ).resolves.toMatchObject({ success: true });

    expect(graphql).toHaveBeenCalledTimes(2);
    expect(createScheduler).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.priority === requestPriorities.background)).toBe(
      true
    );
  });

  it('feeds GraphQL and HTTP rate-limit observations into the lane gate', async () => {
    const resetAt = '2026-01-03T00:00:00.000Z';
    const graphql = vi.fn(async () => ({
      repository: {
        pullRequests: {
          totalCount: 0,
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [],
        },
      },
      rateLimit: { cost: 2, remaining: 98, resetAt },
    }));
    type HookOptions = {
      url?: string;
      request?: { signal?: AbortSignal };
    };
    let beforeHook: ((options: HookOptions) => Promise<void>) | undefined;
    let afterHook:
      | ((
          response: { headers: Record<string, string | number | undefined> },
          options: HookOptions
        ) => void)
      | undefined;
    let errorHook: ((error: unknown, options: HookOptions) => never) | undefined;
    const octokit = {
      graphql,
      rest: {},
      paginate: vi.fn(),
      hook: {
        before: vi.fn((_name: string, callback: (options: HookOptions) => Promise<void>) => {
          beforeHook = callback;
        }),
        after: vi.fn(
          (
            _name: string,
            callback: (
              response: { headers: Record<string, string | number | undefined> },
              options: HookOptions
            ) => void
          ) => {
            afterHook = callback;
          }
        ),
        error: vi.fn((_name: string, callback: (error: unknown, options: HookOptions) => never) => {
          errorHook = callback;
        }),
      },
    } as unknown as Octokit;
    const gates = {
      graphql: fakeRateGate(),
      rest: fakeRateGate(),
    };
    const { logger } = createStubLogger();
    const provider = createProvider({
      githubAuth: fakeGitHubAuth(),
      logger,
      createOctokit: () => octokit,
      createScheduler: () => immediateScheduler([]),
      createRateGate: (resource) => gates[resource],
    });

    await expect(
      (await repository(provider)).fetchOpenPage(null, new AbortController().signal)
    ).resolves.toMatchObject({ success: true });
    expect(gates.graphql.observe).toHaveBeenCalledWith({
      cost: 2,
      remaining: 98,
      resetAtMs: Date.parse(resetAt),
    });
    expect(gates.rest.observe).not.toHaveBeenCalled();

    const requestSignal = new AbortController().signal;
    await beforeHook?.({
      url: 'https://api.github.com/graphql',
      request: { signal: requestSignal },
    });
    expect(gates.graphql.acquire).toHaveBeenLastCalledWith(0, requestSignal);
    await beforeHook?.({
      url: 'https://api.github.com/repos/emdash/emdash/pulls',
      request: { signal: requestSignal },
    });
    expect(gates.rest.acquire).toHaveBeenLastCalledWith(1, requestSignal);

    afterHook?.(
      {
        headers: {
          'x-ratelimit-resource': 'core',
          'x-ratelimit-remaining': '17',
          'x-ratelimit-reset': '100',
          'retry-after': '3',
        },
      },
      { url: 'https://api.github.com/graphql' }
    );
    expect(gates.rest.observe).toHaveBeenLastCalledWith({
      remaining: 17,
      resetAtMs: 100_000,
      retryAfterMs: 3_000,
    });

    const rateError = Object.assign(new Error('rate limited'), {
      response: { headers: { 'retry-after': '2' } },
    });
    expect(() =>
      errorHook?.(rateError, {
        url: 'https://api.github.com/repos/emdash/emdash/pulls',
      })
    ).toThrow(rateError);
    expect(gates.rest.observe).toHaveBeenLastCalledWith({
      remaining: undefined,
      resetAtMs: undefined,
      retryAfterMs: 2_000,
    });
  });
});

function createProvider(options: Omit<GitHubProviderOptions, 'scope'>): GitHubProvider {
  const scope = createScope({ label: 'github-provider-test' });
  scopes.push(scope);
  return new GitHubProvider({ ...options, scope });
}

function immediateScheduler(requests: ScheduledRequest<unknown>[]): RequestScheduler {
  return {
    stats: { pending: 0, inFlight: 0 },
    async submit<T>(
      request: ScheduledRequest<T>,
      options: { signal?: AbortSignal } = {}
    ): Promise<T> {
      requests.push(request as ScheduledRequest<unknown>);
      return await request.run(options.signal ?? new AbortController().signal);
    },
    async dispose(): Promise<void> {},
  };
}

function fakeRateGate(): RateGate {
  return {
    acquire: vi.fn(async () => {}),
    observe: vi.fn(),
  };
}

function fakeGitHubAuth(accountId?: string): ContractClient<GitPlatformAuthContract> {
  return {
    resolveAuth: async () =>
      ok({
        provider: 'github',
        token: 'test-token',
        host: 'github.com',
        apiBaseUrl: 'https://api.github.com',
        accountId,
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

function fakeCommentsOctokit(options: {
  etag?: string;
  getError?: unknown;
  issueComments?: Array<ReturnType<typeof restIssueComment>>;
}) {
  const get = options.getError
    ? vi.fn(async () => {
        throw options.getError;
      })
    : vi.fn(async () => ({ headers: { etag: options.etag ?? '"etag"' }, data: {} }));
  const listComments = vi.fn();
  const listReviewComments = vi.fn();
  const listReviews = vi.fn();
  const paginate = vi.fn(async (method: unknown) =>
    method === listComments ? (options.issueComments ?? []) : []
  );
  const octokit = {
    graphql: vi.fn(),
    paginate,
    rest: {
      issues: { listComments },
      pulls: { get, listReviewComments, listReviews },
    },
  } as unknown as Octokit;
  return { octokit, get, paginate };
}

function restIssueComment(overrides: { id?: number; body?: string } = {}) {
  return {
    id: overrides.id ?? 7,
    body: overrides.body ?? 'Comment',
    html_url: `https://github.com/emdash/emdash/pull/42#issuecomment-${overrides.id ?? 7}`,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    user: {
      id: 1,
      login: 'octocat',
      avatar_url: 'https://github.com/images/octocat.png',
      html_url: 'https://github.com/octocat',
    },
  };
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

function checkResponse(oid: string, hasNextPage = false, endCursor: string | null = null) {
  return {
    repository: {
      pullRequest: {
        commits: {
          nodes: [
            {
              commit: {
                oid,
                statusCheckRollup: {
                  contexts: {
                    nodes: [
                      {
                        __typename: 'CheckRun',
                        name: 'CI',
                        status: 'REQUESTED',
                        conclusion: null,
                        detailsUrl: null,
                        startedAt: null,
                        completedAt: null,
                        checkSuite: null,
                      },
                    ],
                    pageInfo: { hasNextPage, endCursor },
                  },
                },
              },
            },
          ],
        },
      },
    },
  };
}
