import { ok } from '@emdash/shared';
import { createScope, type Scope } from '@emdash/shared/concurrency';
import { retrySchedules } from '@emdash/shared/scheduling';
import { createStubLogger } from '@emdash/shared/testing';
import type { ContractClient } from '@emdash/wire/rpc';
import { observe, remote, whenReady } from '@emdash/wire/state';
import { defineWireComponent } from '@emdash/wire/worker';
import type { Octokit } from '@octokit/rest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { pullRequestsContract, type GitHubAuthContract, type PullRequestDetails } from '../api';
import { PullRequestEngine } from './engine';
import { PullRequestService } from './pull-request-service';
import { PullRequestStore, pullRequestSqliteStore } from './store';
import { createPullRequestsWireController } from './wire-controller';

const repositoryUrl = 'https://github.com/emdash/emdash';
const url = `${repositoryUrl}/pull/42`;
const scopes: Scope[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
});
afterEach(async () => {
  for (const scope of scopes.splice(0).reverse()) await scope.dispose();
  vi.useRealTimers();
});

async function harness() {
  const scope = createScope();
  scopes.push(scope);
  const handle = await pullRequestSqliteStore.openTemp();
  scope.add(() => handle.close());
  const store = new PullRequestStore(handle);
  store.registerRepository(repositoryUrl);
  const pr = {
    number: 42,
    url,
    title: 'Original',
    body: 'Description',
    state: 'OPEN',
    isDraft: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    headRefName: 'feature',
    headRefOid: 'head',
    baseRefName: 'main',
    baseRefOid: 'base',
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    commitCount: { totalCount: 1 },
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'UNSTABLE',
    reviewDecision: 'REVIEW_REQUIRED',
    author: null,
    headRepository: { url: repositoryUrl },
    baseRepository: { url: repositoryUrl },
    labels: { nodes: [] },
    assignees: { nodes: [] },
    statusCheckRollup: { state: 'PENDING' },
  };
  const check = {
    __typename: 'CheckRun',
    name: 'CI',
    status: 'IN_PROGRESS',
    conclusion: null as string | null,
    detailsUrl: null,
    startedAt: null,
    completedAt: null,
    checkSuite: null,
  };
  const api = {
    pr,
    check,
    comments: 'First comment',
    failComments: false,
    failChecks: false,
    checkOid: null as string | null,
    inventory: true,
  };
  const graphql = vi.fn(async (query: string): Promise<unknown> => {
    if (
      query.includes('query syncPullRequests') ||
      query.includes('query incrementalSyncPullRequests')
    )
      return {
        repository: {
          pullRequests: {
            totalCount: 0,
            nodes: [],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      };
    if (query.includes('openPullRequests'))
      return {
        repository: {
          pullRequests: {
            nodes: api.inventory && pr.state === 'OPEN' ? [structuredClone(pr)] : [],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      };
    if (query.includes('getPrCheckRunsByUrl')) {
      if (api.failChecks) throw new Error('Checks unavailable');
      return {
        repository: {
          pullRequest: {
            commits: {
              nodes: [
                {
                  commit: {
                    oid: api.checkOid ?? pr.headRefOid,
                    statusCheckRollup: {
                      contexts: {
                        nodes: [structuredClone(check)],
                        pageInfo: { hasNextPage: false, endCursor: null },
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
    return { repository: { pullRequest: structuredClone(pr) } };
  });
  const listComments = vi.fn();
  const paginate = vi.fn(async (method: unknown) => {
    if (api.failComments) throw new Error('Comments unavailable');
    return method === listComments
      ? [
          {
            id: 7,
            body: api.comments,
            html_url: url,
            user: null,
            created_at: pr.createdAt,
            updated_at: pr.updatedAt,
          },
        ]
      : [];
  });
  const { logger } = createStubLogger();
  const auth = {
    resolveAuth: async () =>
      ok({
        provider: 'github',
        accountId: 'account',
        token: 'test',
        host: 'github.com',
        apiBaseUrl: 'https://api.github.com',
      }),
  } as unknown as ContractClient<GitHubAuthContract>;
  // Use the real engine, database, service, controller and Wire subscription.
  const engine = new PullRequestEngine({
    scope,
    logger,
    githubAuth: auth,
    retrySchedule: retrySchedules.fixed(0, 0),
    createOctokit: () =>
      ({
        graphql,
        paginate,
        rest: {
          issues: { listComments },
          pulls: { listReviews: vi.fn(), listReviewComments: vi.fn() },
        },
      }) as unknown as Octokit,
  });
  let service!: PullRequestService;
  const definition = defineWireComponent({
    id: 'refresh-test',
    contract: pullRequestsContract,
    requirements: {},
    configSchema: z.object({}),
    create: ({ instance, scope: componentScope }) => {
      service = new PullRequestService({
        store,
        scope: componentScope,
        logger,
        githubAuth: auth,
        engine,
        incrementalIntervalMs: 60_000,
      });
      return instance({
        scope: componentScope,
        controller: createPullRequestsWireController(service, componentScope),
      });
    },
  });
  const component = definition.create({ scope, dependencies: {}, config: {} });
  const refresh = (force = true, comments = true) =>
    component.client.refreshPullRequest({
      repositoryUrl,
      number: 42,
      policy: force ? 'force' : 'if-stale',
      comments,
    });
  const watch = async (comments = true) => {
    const viewScope = scope.child('view');
    const model = remote(pullRequestsContract.details, component.client.details, {
      scope: viewScope,
    });
    const member = model({ repositoryUrl, number: 42, comments });
    let value: PullRequestDetails | undefined;
    observe(
      member.states.state,
      (state) => {
        value = state.value;
      },
      { scope: viewScope }
    );
    await whenReady(member.states.state, { scope: viewScope });
    await vi.advanceTimersByTimeAsync(0);
    return {
      get value() {
        return value;
      },
      dispose: () => viewScope.dispose(),
    };
  };
  return { api, engine, service, store, graphql, paginate, component, refresh, watch };
}

describe('PR freshness through Wire', () => {
  it('surfaces subscribed detail failures from repository revalidation and manual sync', async () => {
    const h = await harness();
    const view = await h.watch();
    expect(view.value?.errors).toEqual({});
    h.api.failChecks = true;
    vi.setSystemTime(160_000);
    expect(
      await h.component.client.refreshRepository({ repositoryUrl, policy: 'if-stale' })
    ).toMatchObject({
      success: false,
      error: { type: 'checks_failed' },
    });
    expect(view.value?.errors.checks?.type).toBe('checks_failed');
    expect(
      await h.component.client.refreshRepository({ repositoryUrl, policy: 'force' })
    ).toMatchObject({
      success: false,
      error: { type: 'checks_failed' },
    });
  });

  it('finishes label and assignee pagination before publishing metadata', async () => {
    const h = await harness();
    h.graphql.mockResolvedValueOnce({
      repository: {
        pullRequest: {
          ...h.api.pr,
          labels: {
            nodes: [{ name: 'first', color: '123456' }],
            pageInfo: { hasNextPage: true, endCursor: 'labels-next' },
          },
          assignees: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
        },
      },
    });
    h.graphql.mockResolvedValueOnce({
      repository: {
        pullRequest: {
          labels: {
            nodes: [{ name: 'second', color: '654321' }],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
          assignees: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
        },
      },
    });
    await h.refresh();
    expect(h.store.getPullRequestByUrl(url)?.labels.map((label) => label.name)).toEqual([
      'first',
      'second',
    ]);
    expect(h.graphql.mock.calls[1]?.[0]).toContain('pullRequestCollections');
  });

  it('keeps historical browsing populated when registering a repository', async () => {
    const h = await harness();
    h.graphql.mockResolvedValueOnce({
      repository: {
        pullRequests: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
      },
    });
    h.graphql.mockResolvedValueOnce({
      repository: {
        pullRequests: {
          totalCount: 1,
          nodes: [{ ...h.api.pr, state: 'MERGED' }],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    });
    h.service.registerRepository(repositoryUrl);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.store.getPullRequestByUrl(url)?.status).toBe('merged');
    expect(h.store.getCursor(repositoryUrl, 'full')?.done).toBe(true);
  });

  it('does not let an older inventory response overwrite a newer direct refresh', async () => {
    const h = await harness();
    const old = structuredClone(h.api.pr);
    let finish!: (value: unknown) => void;
    h.graphql.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }) as ReturnType<typeof h.graphql>
    );
    const inventory = h.service.refreshRepository({ repositoryUrl, policy: 'force' });
    await vi.advanceTimersByTimeAsync(0);
    h.api.pr.title = 'Newer direct observation';
    await h.refresh();
    finish({
      repository: {
        pullRequests: { nodes: [old], pageInfo: { hasNextPage: false, endCursor: null } },
      },
    });
    await inventory;
    expect(h.store.getPullRequestByUrl(url)?.title).toBe('Newer direct observation');
  });

  it('does not infer closure or advance inventory freshness from an incomplete scan', async () => {
    const h = await harness();
    await h.refresh();
    h.graphql.mockResolvedValueOnce({
      repository: {
        pullRequests: { nodes: [], pageInfo: { hasNextPage: true, endCursor: 'next' } },
      },
    });
    h.graphql.mockRejectedValueOnce(new Error('Second page unavailable'));
    const result = await h.service.refreshRepository({ repositoryUrl, policy: 'force' });
    expect(result.success).toBe(false);
    expect(h.store.getPullRequestByUrl(url)?.status).toBe('open');
    expect(h.graphql.mock.calls.filter(([q]) => q.includes('getPullRequestByNumber'))).toHaveLength(
      1
    );
  });

  it('shares reconnect work and forces a subsequent repository scan after a manual invalidation', async () => {
    const h = await harness();
    let finish!: (value: unknown) => void;
    const old = structuredClone(h.api.pr);
    h.graphql.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }) as ReturnType<typeof h.graphql>
    );
    const first = h.component.client.refreshRepository({ repositoryUrl, policy: 'if-stale' });
    await vi.advanceTimersByTimeAsync(0);
    const reconnect = h.component.client.refreshRepository({ repositoryUrl, policy: 'if-stale' });
    const manual = h.component.client.refreshRepository({ repositoryUrl, policy: 'force' });
    await vi.advanceTimersByTimeAsync(0);
    h.api.pr.title = 'Changed while request was running';
    finish({
      repository: {
        pullRequests: { nodes: [old], pageInfo: { hasNextPage: false, endCursor: null } },
      },
    });
    await Promise.all([first, reconnect, manual]);
    expect(h.store.getPullRequestByUrl(url)?.title).toBe('Changed while request was running');
    expect(h.graphql).toHaveBeenCalledTimes(2);
    await h.component.client.refreshRepository({ repositoryUrl, policy: 'if-stale' });
    expect(h.graphql).toHaveBeenCalledTimes(2);
  });

  it('only maintains comments while a comments view needs them', async () => {
    const h = await harness();
    const metadataView = await h.watch(false);
    expect(h.paginate).not.toHaveBeenCalled();
    const commentsView = await h.watch(true);
    expect(h.paginate).toHaveBeenCalledTimes(3);
    await commentsView.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.paginate).toHaveBeenCalledTimes(3);
    await metadataView.dispose();
  });

  it('polls twenty repositories once per fixed tick and stops released repositories', async () => {
    const h = await harness();
    h.api.inventory = false;
    const repositories = Array.from(
      { length: 20 },
      (_, i) => `https://github.com/emdash/repo-${i}`
    );
    for (const repo of repositories) h.service.registerRepository(repo);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.graphql).toHaveBeenCalledTimes(40); // Inventory and one history bootstrap per repository.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.graphql).toHaveBeenCalledTimes(60);
    for (const repo of repositories) await h.service.releaseRepository(repo);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.graphql).toHaveBeenCalledTimes(60);
  });
  it('refreshes completed and restarted checks, metadata and comments without navigation', async () => {
    const h = await harness();
    const view = await h.watch();
    expect(view.value?.errors).toEqual({});
    expect(view.value?.pr?.checks[0]?.status).toBe('IN_PROGRESS');
    h.api.check.status = 'COMPLETED';
    h.api.check.conclusion = 'SUCCESS';
    h.api.pr.statusCheckRollup.state = 'SUCCESS';
    h.api.pr.mergeStateStatus = 'CLEAN';
    h.api.pr.title = 'Edited externally';
    h.api.pr.reviewDecision = 'APPROVED';
    h.api.comments = 'New review';
    await vi.advanceTimersByTimeAsync(60_000);
    expect(view.value).toMatchObject({
      stale: false,
      pr: {
        title: 'Edited externally',
        mergeStateStatus: 'CLEAN',
        reviewDecision: 'APPROVED',
        checks: [{ status: 'COMPLETED' }],
      },
      comments: [{ body: 'New review' }],
    });
    h.api.check.status = 'QUEUED';
    h.api.check.conclusion = null;
    h.api.pr.statusCheckRollup.state = 'PENDING';
    await vi.advanceTimersByTimeAsync(60_000);
    expect(view.value?.pr?.checks[0]?.status).toBe('QUEUED');
    await view.dispose();
    const calls = h.graphql.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.graphql).toHaveBeenCalledTimes(calls);
  });

  it('discovers PRs and revalidates unchanged updatedAt, closure and reopening', async () => {
    const h = await harness();
    h.service.registerRepository(repositoryUrl);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.store.getPullRequestByUrl(url)?.status).toBe('open');
    h.api.pr.title = 'Edited';
    h.api.pr.statusCheckRollup.state = 'SUCCESS';
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.store.getPullRequestByUrl(url)).toMatchObject({
      title: 'Edited',
      checkSummary: 'SUCCESS',
      checks: [],
    });
    h.api.pr.state = 'MERGED';
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.store.getPullRequestByUrl(url)?.status).toBe('merged');
    h.api.pr.state = 'OPEN';
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.store.getPullRequestByUrl(url)?.status).toBe('open');
    await h.component.client.releaseRepository({ repositoryUrl });
    const calls = h.graphql.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.graphql).toHaveBeenCalledTimes(calls);
  });

  it('shares detail polling across views and keeps the remaining view alive', async () => {
    const h = await harness();
    const a = await h.watch();
    const b = await h.watch();
    const count = () =>
      h.graphql.mock.calls.filter(([q]) => q.includes('getPrCheckRunsByUrl')).length;
    expect(count()).toBe(1);
    await a.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(count()).toBe(2);
    expect(b.value?.pr).not.toBeNull();
    await b.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(count()).toBe(2);
  });

  it('preserves cached collections and timestamps after partial failure, then recovers', async () => {
    const h = await harness();
    const view = await h.watch();
    const checksFetchedAt = view.value?.pr?.checksFetchedAt;
    const commentsFetchedAt = view.value?.commentsFetchedAt;
    h.api.failComments = true;
    h.api.failChecks = true;
    h.api.pr.title = 'New metadata';
    await vi.advanceTimersByTimeAsync(60_000);
    expect(view.value).toMatchObject({
      stale: true,
      pr: { title: 'New metadata', checksFetchedAt, checks: [{ name: 'CI' }] },
      commentsFetchedAt,
      comments: [{ body: 'First comment' }],
      errors: { checks: { type: 'checks_failed' }, comments: { type: 'comments_failed' } },
    });
    h.api.failComments = false;
    h.api.failChecks = false;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(view.value?.stale).toBe(false);
  });

  it('rejects checks for a different head and clears old-head details', async () => {
    const h = await harness();
    const view = await h.watch();
    h.api.pr.headRefOid = 'new-head';
    h.api.checkOid = 'head';
    const result = await h.refresh();
    expect(result).toMatchObject({
      success: false,
      error: { type: 'checks_failed' },
    });
    expect(view.value).toMatchObject({
      stale: true,
      pr: { headRefOid: 'new-head', checks: [], checksFetchedAt: null },
      errors: { checks: { type: 'checks_failed' } },
    });
  });

  it('projects freshness per lease and reports requested comment failures from commands', async () => {
    const h = await harness();
    const metadata = await h.watch(false);
    const conversation = await h.watch(true);
    h.api.failComments = true;
    expect(await h.refresh()).toMatchObject({ success: false, error: { type: 'comments_failed' } });
    expect(conversation.value).toMatchObject({
      stale: true,
      errors: { comments: { type: 'comments_failed' } },
    });
    expect(metadata.value).toMatchObject({ stale: false, errors: {}, comments: [] });
    expect(await h.refresh(true, false)).toEqual(ok());
    expect(conversation.value?.stale).toBe(true);
  });

  it('uses the same automatic gate and force policy for both refresh commands', async () => {
    const h = await harness();
    expect(await h.refresh(false, false)).toEqual(ok());
    const detailCalls = h.graphql.mock.calls.length;
    expect(await h.refresh(false, false)).toEqual(ok());
    expect(h.graphql).toHaveBeenCalledTimes(detailCalls);
    expect(await h.refresh(true, false)).toEqual(ok());
    expect(h.graphql).toHaveBeenCalledTimes(detailCalls + 2);
    const input = { repositoryUrl, policy: 'if-stale' as const };
    expect(await h.component.client.refreshRepository(input)).toEqual(ok());
    const repositoryCalls = h.graphql.mock.calls.length;
    expect(await h.component.client.refreshRepository(input)).toEqual(ok());
    expect(h.graphql).toHaveBeenCalledTimes(repositoryCalls);
    expect(await h.component.client.refreshRepository({ ...input, policy: 'force' })).toEqual(ok());
    expect(h.graphql).toHaveBeenCalledTimes(repositoryCalls + 1);
  });

  it('queues a fresh read when a manual refresh arrives during an older request', async () => {
    const h = await harness();
    let finish!: (value: unknown) => void;
    const old = structuredClone(h.api.pr);
    h.graphql.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }) as ReturnType<typeof h.graphql>
    );
    const first = h.refresh(false, false);
    await vi.advanceTimersByTimeAsync(0);
    h.api.pr.title = 'After the first request';
    const forced = h.refresh(true, false);
    await vi.advanceTimersByTimeAsync(0);
    finish({ repository: { pullRequest: old } });
    await first;
    await forced;
    expect(h.store.getPullRequestByUrl(url)?.title).toBe('After the first request');
    expect(h.graphql.mock.calls.filter(([q]) => q.includes('getPullRequestByNumber'))).toHaveLength(
      2
    );
  });
});
