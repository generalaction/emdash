import { ok } from '@emdash/shared';
import { createScope, type Scope } from '@emdash/shared/concurrency';
import { createStubLogger } from '@emdash/shared/testing';
import type { ContractClient } from '@emdash/wire/rpc';
import { snapshot } from '@emdash/wire/state';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitPlatformAuthContract, PullRequest, PullRequestComment } from '../api';
import type { PullRequestEngine } from './engine';
import type { GitHubPullRequestRepository, PullRequestPage } from './engine/observation';
import { PullRequestService } from './pull-request-service';
import { PullRequestStore, pullRequestSqliteStore } from './store';

const repositoryUrl = 'https://github.com/emdash/emdash';
const scopes: Scope[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
});

afterEach(async () => {
  for (const scope of scopes.splice(0).reverse()) await scope.dispose();
  vi.useRealTimers();
});

function observed<T>(data: T, fetchedAt = Date.now()) {
  return ok({ data, fetchedAt });
}

function page(prs: PullRequest[] = []): PullRequestPage {
  return { prs, pageInfo: { hasNextPage: false, endCursor: null }, totalCount: prs.length };
}

function repository(url: string) {
  const pr = fixture(url);
  const comments: PullRequestComment[] = [];
  const context = {
    identity: 'github.com:account',
    repositoryUrl: url,
    fetchOpenPage: vi.fn<GitHubPullRequestRepository['fetchOpenPage']>(async () =>
      observed(page(pr.status === 'open' ? [structuredClone(pr)] : []))
    ),
    fetchHistoryPage: vi.fn<GitHubPullRequestRepository['fetchHistoryPage']>(async () =>
      observed(page())
    ),
    fetchPullRequest: vi.fn<GitHubPullRequestRepository['fetchPullRequest']>(async () =>
      observed(structuredClone(pr))
    ),
    fetchChecks: vi.fn<GitHubPullRequestRepository['fetchChecks']>(async () =>
      observed({ headRefOid: pr.headRefOid, checks: structuredClone(pr.checks) })
    ),
    fetchComments: vi.fn<GitHubPullRequestRepository['fetchComments']>(async () =>
      observed(structuredClone(comments))
    ),
  };
  return { pr, comments, context };
}

async function harness(urls = [repositoryUrl]) {
  const scope = createScope();
  scopes.push(scope);
  const handle = await pullRequestSqliteStore.openTemp();
  scope.add(() => handle.close());
  const store = new PullRequestStore(handle);
  const repositories = urls.map(repository);
  for (const url of urls) store.registerRepository(url);
  const engine = {
    openRepository: vi.fn<PullRequestEngine['openRepository']>(async (url) => {
      const found = repositories.find((entry) => entry.context.repositoryUrl === url);
      if (!found) throw new Error(`Unexpected repository: ${url}`);
      return ok(found.context);
    }),
  };
  const { logger } = createStubLogger();
  const service = new PullRequestService({
    scope,
    store,
    logger,
    engine: engine as unknown as PullRequestEngine,
    githubAuth: {} as ContractClient<GitPlatformAuthContract>,
    incrementalIntervalMs: 60_000,
  });
  const observe = (url = repositoryUrl, comments = false) => {
    const lease = createScope();
    scopes.push(lease);
    const details = service.observePullRequest({ repositoryUrl: url, number: 1, comments }, lease);
    return { lease, details };
  };
  return { service, store, repositories, observe };
}

describe('fixed-minute pull-request polling', () => {
  it('resets repository status when unregistering before a status view has subscribed', async () => {
    const h = await harness();
    const { context } = h.repositories[0]!;
    context.fetchOpenPage.mockResolvedValue({
      success: false,
      error: { type: 'sync_failed', message: 'Inventory failed' },
    });
    await h.service.refreshRepository({ repositoryUrl, policy: 'force' });
    await h.service.unregisterRepository(repositoryUrl);
    const lease = createScope();
    scopes.push(lease);
    const state = h.service.observeRepository(repositoryUrl, lease);
    expect(snapshot(state).value).toMatchObject({ phase: 'idle', kind: null });
    expect(snapshot(state).value.error).toBeUndefined();
  });

  it('does not skip the next fixed tick when inventory takes one second', async () => {
    const h = await harness();
    const { context, pr } = h.repositories[0]!;
    context.fetchOpenPage.mockImplementation(async () => {
      const fetchedAt = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      return observed(page([structuredClone(pr)]), fetchedAt);
    });
    h.service.registerRepository(repositoryUrl);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(context.fetchOpenPage).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(context.fetchOpenPage).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(context.fetchOpenPage).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1_000);
  });

  it('reuses bulk metadata while refreshing checks and demanded comments with unchanged updatedAt', async () => {
    const h = await harness();
    const { context, pr, comments } = h.repositories[0]!;
    h.service.registerRepository(repositoryUrl);
    await vi.advanceTimersByTimeAsync(0);
    const { details } = h.observe(repositoryUrl, true);
    await vi.advanceTimersByTimeAsync(0);
    context.fetchPullRequest.mockClear();
    const updatedAt = pr.updatedAt;
    pr.title = 'New title';
    pr.checks = [
      {
        id: 'ci',
        pullRequestUrl: pr.url,
        commitSha: pr.headRefOid,
        name: 'CI',
        status: 'completed',
        conclusion: 'success',
        detailsUrl: null,
        startedAt: null,
        completedAt: null,
        workflowName: null,
        appName: null,
        appLogoUrl: null,
      },
    ];
    comments.push({
      id: 'comment',
      pullRequestUrl: pr.url,
      kind: 'issue',
      body: 'New comment',
      url: pr.url,
      author: null,
      path: null,
      line: null,
      isResolved: false,
      isOutdated: false,
      createdAt: updatedAt,
      updatedAt,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(context.fetchOpenPage).toHaveBeenCalledTimes(2);
    expect(context.fetchPullRequest).not.toHaveBeenCalled();
    expect(context.fetchChecks).toHaveBeenCalledTimes(2);
    expect(context.fetchComments).toHaveBeenCalledTimes(2);
    expect(snapshot(details).value).toMatchObject({
      pr: { title: 'New title', updatedAt, checks: [{ conclusion: 'success' }] },
      comments: [{ body: 'New comment' }],
    });
    pr.checks[0]!.status = 'in_progress';
    pr.checks[0]!.conclusion = null;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(context.fetchChecks).toHaveBeenCalledTimes(3);
    expect(snapshot(details).value?.pr?.checks[0]?.status).toBe('in_progress');
    expect(context.fetchPullRequest).not.toHaveBeenCalled();
  });

  it('keeps inventory on schedule while joining slow checks without detail follow-ups', async () => {
    const h = await harness();
    const { context, pr } = h.repositories[0]!;
    h.service.registerRepository(repositoryUrl);
    await vi.advanceTimersByTimeAsync(0);
    h.observe();
    await vi.advanceTimersByTimeAsync(0);
    let finish!: () => void;
    context.fetchChecks.mockImplementationOnce(async () => {
      const fetchedAt = Date.now();
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return observed({ headRefOid: pr.headRefOid, checks: [] }, fetchedAt);
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(finish).toBeDefined();
    const automatic = h.service.refreshRepository({ repositoryUrl, policy: 'if-stale' });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(context.fetchOpenPage).toHaveBeenCalledTimes(4);
    expect(context.fetchChecks).toHaveBeenCalledTimes(2);
    finish();
    await automatic;
    await vi.advanceTimersByTimeAsync(0);
    expect(context.fetchOpenPage).toHaveBeenCalledTimes(4);
    expect(context.fetchChecks).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(context.fetchOpenPage).toHaveBeenCalledTimes(5);
    expect(context.fetchChecks).toHaveBeenCalledTimes(3);
  });

  it('joins slow inventory across ticks and refreshes details once after it finishes', async () => {
    const h = await harness();
    const { context, pr } = h.repositories[0]!;
    h.service.registerRepository(repositoryUrl);
    await vi.advanceTimersByTimeAsync(0);
    h.observe();
    await vi.advanceTimersByTimeAsync(0);
    let finish!: () => void;
    context.fetchOpenPage.mockImplementationOnce(async () => {
      const fetchedAt = Date.now();
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return observed(page([structuredClone(pr)]), fetchedAt);
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(finish).toBeDefined();
    const automatic = h.service.refreshRepository({ repositoryUrl, policy: 'if-stale' });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(context.fetchOpenPage).toHaveBeenCalledTimes(2);
    expect(context.fetchChecks).toHaveBeenCalledTimes(1);
    finish();
    await automatic;
    await vi.advanceTimersByTimeAsync(0);
    expect(context.fetchOpenPage).toHaveBeenCalledTimes(2);
    expect(context.fetchChecks).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(context.fetchOpenPage).toHaveBeenCalledTimes(3);
    expect(context.fetchChecks).toHaveBeenCalledTimes(3);
  });

  it('reuses inventory metadata during an overdue reconnect refresh before a timer tick', async () => {
    const h = await harness();
    const { context } = h.repositories[0]!;
    h.service.registerRepository(repositoryUrl);
    await vi.advanceTimersByTimeAsync(0);
    h.observe(repositoryUrl, true);
    await vi.advanceTimersByTimeAsync(0);
    context.fetchPullRequest.mockClear();
    // Simulate elapsed wall time while timer delivery was suspended.
    vi.setSystemTime(Date.now() + 65_000);
    expect(await h.service.refreshRepository({ repositoryUrl, policy: 'if-stale' })).toEqual(ok());
    expect(context.fetchOpenPage).toHaveBeenCalledTimes(2);
    expect(context.fetchPullRequest).not.toHaveBeenCalled();
    expect(context.fetchChecks).toHaveBeenCalledTimes(2);
    expect(context.fetchComments).toHaveBeenCalledTimes(2);
  });

  it('reuses a manual detail refresh completed after the tick while inventory was pending', async () => {
    const h = await harness();
    const { context, pr } = h.repositories[0]!;
    h.service.registerRepository(repositoryUrl);
    await vi.advanceTimersByTimeAsync(0);
    h.observe(repositoryUrl, true);
    await vi.advanceTimersByTimeAsync(0);
    let finish!: () => void;
    context.fetchOpenPage.mockImplementationOnce(async () => {
      const fetchedAt = Date.now();
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return observed(page([structuredClone(pr)]), fetchedAt);
    });
    await vi.advanceTimersByTimeAsync(61_000);
    expect(finish).toBeDefined();
    expect(
      await h.service.refreshPullRequest({ repositoryUrl, number: 1, policy: 'force' })
    ).toEqual(ok());
    expect(context.fetchChecks).toHaveBeenCalledTimes(2);
    expect(context.fetchComments).toHaveBeenCalledTimes(2);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(context.fetchOpenPage).toHaveBeenCalledTimes(2);
    expect(context.fetchChecks).toHaveBeenCalledTimes(2);
    expect(context.fetchComments).toHaveBeenCalledTimes(2);
  });

  it('reads metadata for an observed closed PR that is absent from inventory', async () => {
    const h = await harness();
    const { context, pr } = h.repositories[0]!;
    pr.status = 'closed';
    h.service.registerRepository(repositoryUrl);
    await vi.advanceTimersByTimeAsync(0);
    const { details } = h.observe();
    await vi.advanceTimersByTimeAsync(0);
    context.fetchPullRequest.mockClear();
    pr.title = 'Closed PR edit';
    await vi.advanceTimersByTimeAsync(60_000);
    expect(context.fetchPullRequest).toHaveBeenCalledTimes(1);
    expect(snapshot(details).value?.pr?.title).toBe('Closed PR edit');
  });

  it('does not let a recent activation suppress the scheduled details refresh', async () => {
    const h = await harness();
    const { context } = h.repositories[0]!;
    h.service.registerRepository(repositoryUrl);
    await vi.advanceTimersByTimeAsync(59_000);
    h.observe();
    await vi.advanceTimersByTimeAsync(0);
    expect(context.fetchChecks).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(context.fetchChecks).toHaveBeenCalledTimes(2);
    expect(context.fetchPullRequest).not.toHaveBeenCalled();
  });

  it('joins a detail read started before the tick without forcing a follow-up', async () => {
    const h = await harness();
    const { context, pr } = h.repositories[0]!;
    h.service.registerRepository(repositoryUrl);
    await vi.advanceTimersByTimeAsync(0);
    h.observe();
    await vi.advanceTimersByTimeAsync(59_000);
    let finish!: () => void;
    context.fetchChecks.mockImplementationOnce(async () => {
      const fetchedAt = Date.now();
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return observed({ headRefOid: pr.headRefOid, checks: [] }, fetchedAt);
    });
    const manual = h.service.refreshPullRequest({ repositoryUrl, number: 1, policy: 'force' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(finish).toBeDefined();
    expect(context.fetchChecks).toHaveBeenCalledTimes(2);
    finish();
    await manual;
    await vi.advanceTimersByTimeAsync(0);
    expect(context.fetchChecks).toHaveBeenCalledTimes(2);
  });

  it('keeps observed details polling without active repository inventory', async () => {
    const h = await harness();
    const { context } = h.repositories[0]!;
    h.observe();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(context.fetchOpenPage).not.toHaveBeenCalled();
    expect(context.fetchPullRequest).toHaveBeenCalledTimes(2);
    expect(context.fetchChecks).toHaveBeenCalledTimes(2);
  });

  it('does not skip detail-only ticks when a previous read finished less than a minute ago', async () => {
    const h = await harness();
    const { context, pr } = h.repositories[0]!;
    context.fetchChecks.mockImplementation(async () => {
      const fetchedAt = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      return observed({ headRefOid: pr.headRefOid, checks: [] }, fetchedAt);
    });
    h.observe();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(context.fetchChecks).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(context.fetchChecks).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(context.fetchChecks).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(context.fetchOpenPage).not.toHaveBeenCalled();
  });

  it('reuses fresh details on quick remount and refreshes after their minute expires', async () => {
    const h = await harness();
    const { context } = h.repositories[0]!;
    const first = h.observe(repositoryUrl, true);
    await vi.advanceTimersByTimeAsync(0);
    await first.lease.dispose();
    await vi.advanceTimersByTimeAsync(10_000);
    const second = h.observe(repositoryUrl, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(context.fetchPullRequest).toHaveBeenCalledTimes(1);
    expect(context.fetchChecks).toHaveBeenCalledTimes(1);
    expect(context.fetchComments).toHaveBeenCalledTimes(1);
    await second.lease.dispose();
    await vi.advanceTimersByTimeAsync(50_000);
    h.observe(repositoryUrl, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(context.fetchPullRequest).toHaveBeenCalledTimes(2);
    expect(context.fetchChecks).toHaveBeenCalledTimes(2);
    expect(context.fetchComments).toHaveBeenCalledTimes(2);
    expect(context.fetchOpenPage).not.toHaveBeenCalled();
  });

  it('does not let a slow repository block another repository details', async () => {
    const otherUrl = 'https://github.com/emdash/other';
    const h = await harness([repositoryUrl, otherUrl]);
    for (const url of [repositoryUrl, otherUrl]) h.service.registerRepository(url);
    await vi.advanceTimersByTimeAsync(0);
    h.observe(repositoryUrl);
    h.observe(otherUrl);
    await vi.advanceTimersByTimeAsync(0);
    const slow = h.repositories[0]!;
    const fast = h.repositories[1]!;
    let finish!: () => void;
    slow.context.fetchOpenPage.mockImplementationOnce(async () => {
      const fetchedAt = Date.now();
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return observed(page([structuredClone(slow.pr)]), fetchedAt);
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(finish).toBeDefined();
    expect(fast.context.fetchOpenPage).toHaveBeenCalledTimes(2);
    expect(fast.context.fetchChecks).toHaveBeenCalledTimes(2);
    expect(slow.context.fetchChecks).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(slow.context.fetchChecks).toHaveBeenCalledTimes(2);
  });

  it('stops checks and comments when the last lease is disposed, while inventory continues', async () => {
    const h = await harness();
    const { context } = h.repositories[0]!;
    h.service.registerRepository(repositoryUrl);
    await vi.advanceTimersByTimeAsync(0);
    const { lease } = h.observe(repositoryUrl, true);
    await vi.advanceTimersByTimeAsync(0);
    await lease.dispose();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(context.fetchOpenPage).toHaveBeenCalledTimes(3);
    expect(context.fetchChecks).toHaveBeenCalledTimes(1);
    expect(context.fetchComments).toHaveBeenCalledTimes(1);
  });
});

function fixture(url: string): PullRequest {
  return {
    url: `${url}/pull/1`,
    provider: 'github',
    repositoryUrl: url,
    baseRefName: 'main',
    baseRefOid: 'base',
    headRepositoryUrl: url,
    headRefName: 'feature',
    headRefOid: 'head',
    identifier: '#1',
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
    updatedAt: '2026-01-02T00:00:00.000Z',
    author: null,
    labels: [],
    assignees: [],
    checks: [],
  };
}
