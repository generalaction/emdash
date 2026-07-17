import { createScope } from '@emdash/shared/concurrency';
import { err, ok } from '@emdash/shared/result';
import {
  createController,
  createLiveModelHost,
  type ContractClient,
  type LiveInstance,
} from '@emdash/wire';
import { defineWireComponent } from '@emdash/wire/component';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { pullRequestsContract, type PullRequest, type PullRequestsContract } from '../api';
import { createPullRequestListView } from './pull-request-list-view';
import { PullRequestsStore } from './pull-requests-store';

const repositoryUrl = 'https://github.com/emdash/emdash';

describe('createPullRequestListView', () => {
  it('reloads cursor pagination when filter, sort, and search state changes', async () => {
    const listPullRequests = vi.fn(async (input) =>
      ok({
        prs: [pullRequestFixture({ title: input.searchQuery || input.sort || 'initial' })],
        nextCursor: null,
      })
    );
    const client = { listPullRequests } as unknown as ContractClient<PullRequestsContract>;
    const view = createPullRequestListView({
      client,
      getRepositoryUrls: () => [repositoryUrl],
    });
    view.store.initialize();
    await vi.waitFor(() => expect(listPullRequests).toHaveBeenCalledTimes(1));

    view.store.filter!.set({ status: 'open' });
    await vi.waitFor(() => expect(listPullRequests).toHaveBeenCalledTimes(2));
    expect(listPullRequests.mock.calls.at(-1)?.[0]).toMatchObject({
      cursor: null,
      filters: { status: 'open' },
    });

    view.store.sort!.setKey('recently-updated');
    await vi.waitFor(() => expect(listPullRequests).toHaveBeenCalledTimes(3));
    expect(listPullRequests.mock.calls.at(-1)?.[0]).toMatchObject({
      sort: 'recently-updated',
    });

    view.store.search!.setQuery('worker');
    await vi.waitFor(
      () => {
        expect(listPullRequests).toHaveBeenCalledTimes(4);
      },
      { timeout: 1_000 }
    );
    expect(listPullRequests.mock.calls.at(-1)?.[0]).toMatchObject({
      searchQuery: 'worker',
    });
    view.store.dispose();
  });

  it('exposes wire failures through the ListView error state', async () => {
    const client = {
      listPullRequests: vi.fn(async () =>
        err({ type: 'list_failed' as const, message: 'Database unavailable' })
      ),
    } as unknown as ContractClient<PullRequestsContract>;
    const view = createPullRequestListView({
      client,
      getRepositoryUrls: () => [repositoryUrl],
    });

    view.store.initialize();

    await vi.waitFor(() => expect(view.store.status).toBe('error'));
    expect(view.store.error).toEqual(new Error('Database unavailable'));
    view.store.dispose();
  });
});

describe('PullRequestsStore', () => {
  it('reloads the list exactly once when sync-backed data changes', async () => {
    const scope = createScope({ label: 'pull-requests-browser-test' });
    let syncInstance: LiveInstance<typeof pullRequestsContract.syncState> | undefined;
    const testComponent = defineWireComponent({
      id: 'pull-requests-browser-test',
      contract: pullRequestsContract,
      requirements: {},
      configSchema: z.object({}),
      create: ({ instance, scope: componentScope }) => {
        const syncState = componentScope.use(createLiveModelHost(pullRequestsContract.syncState));
        syncInstance = syncState.create(
          { repositoryUrl },
          { state: { phase: 'idle', kind: null } }
        );
        return instance({
          scope: componentScope,
          controller: createController(pullRequestsContract, {
            listPullRequests: () => ok({ prs: [], nextCursor: null }),
            getFilterOptions: () =>
              ok({
                authors: [],
                labels: [],
                assignees: [],
              }),
            getPullRequestsForBranch: () => ok({ prs: [] }),
            registerRepository: () => ok(),
            unregisterRepository: () => ok(),
            sync: () => ok(),
            forceFullSync: () => ok(),
            syncSingle: () => ok({ pr: pullRequestFixture() }),
            syncChecks: () => ok({ hasRunning: false }),
            cancelSync: () => ok(),
            createPullRequest: () => ok({ url: `${repositoryUrl}/pull/1`, number: 1 }),
            mergePullRequest: () => {
              syncInstance!.states.state.produce(() => ({
                phase: 'idle',
                kind: 'single',
                lastSyncedAt: 2,
              }));
              return ok({ sha: null, merged: true });
            },
            markReadyForReview: () => ok(),
            getPullRequestFiles: () => ok({ files: [] }),
            getPullRequestComments: () => ok({ comments: [] }),
            syncState,
          }),
        });
      },
    });
    const component = testComponent.create({
      scope,
      dependencies: {},
      config: {},
      validate: 'full',
    });
    const store = new PullRequestsStore(component.client, [repositoryUrl]);
    await store.ready;
    const reload = vi.spyOn(store, 'reload').mockResolvedValue();

    syncInstance!.states.state.produce(() => ({
      phase: 'running',
      kind: 'incremental',
      synced: 0,
    }));
    syncInstance!.states.state.produce(() => ({
      phase: 'idle',
      kind: 'incremental',
      synced: 1,
      lastSyncedAt: 1,
    }));

    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    await expect(store.mergePullRequest(repositoryUrl, 1, { strategy: 'merge' })).resolves.toEqual(
      ok({ sha: null, merged: true })
    );
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(2));
    await store.dispose();
    await component.dispose();
  });

  it('ignores stale filter options after repositories change', async () => {
    const secondRepositoryUrl = 'https://github.com/emdash/second';
    const scope = createScope({ label: 'pull-requests-filter-race-test' });
    type FilterOptionsResult = Awaited<
      ReturnType<ContractClient<PullRequestsContract>['getFilterOptions']>
    >;
    const pending = new Map<string, () => void>();
    const getFilterOptions = vi.fn(
      ({ repositoryUrls }: { repositoryUrls: string[] }) =>
        new Promise<FilterOptionsResult>((resolve) => {
          const repository = repositoryUrls[0]!;
          pending.set(repository, () =>
            resolve(
              ok({
                authors: [],
                labels: [{ name: repository, color: null }],
                assignees: [],
              })
            )
          );
        })
    );
    const testComponent = defineWireComponent({
      id: 'pull-requests-filter-race-test',
      contract: pullRequestsContract,
      requirements: {},
      configSchema: z.object({}),
      create: ({ instance, scope: componentScope }) => {
        const syncState = componentScope.use(createLiveModelHost(pullRequestsContract.syncState));
        syncState.create({ repositoryUrl }, { state: { phase: 'idle', kind: null } });
        syncState.create(
          { repositoryUrl: secondRepositoryUrl },
          { state: { phase: 'idle', kind: null } }
        );
        return instance({
          scope: componentScope,
          controller: createController(pullRequestsContract, {
            listPullRequests: () => ok({ prs: [], nextCursor: null }),
            getFilterOptions,
            getPullRequestsForBranch: () => ok({ prs: [] }),
            registerRepository: () => ok(),
            unregisterRepository: () => ok(),
            sync: () => ok(),
            forceFullSync: () => ok(),
            syncSingle: () => ok({ pr: pullRequestFixture() }),
            syncChecks: () => ok({ hasRunning: false }),
            cancelSync: () => ok(),
            createPullRequest: () => ok({ url: `${repositoryUrl}/pull/1`, number: 1 }),
            mergePullRequest: () => ok({ sha: null, merged: true }),
            markReadyForReview: () => ok(),
            getPullRequestFiles: () => ok({ files: [] }),
            getPullRequestComments: () => ok({ comments: [] }),
            syncState,
          }),
        });
      },
    });
    const component = testComponent.create({
      scope,
      dependencies: {},
      config: {},
      validate: 'full',
    });
    const store = new PullRequestsStore(component.client, [repositoryUrl]);
    await vi.waitFor(() => expect(pending.has(repositoryUrl)).toBe(true));

    store.setRepositoryUrls([secondRepositoryUrl]);
    await vi.waitFor(() => expect(pending.has(secondRepositoryUrl)).toBe(true));
    pending.get(secondRepositoryUrl)!();
    await vi.waitFor(() =>
      expect(store.filterOptions.labels).toEqual([{ name: secondRepositoryUrl, color: null }])
    );
    pending.get(repositoryUrl)!();
    await store.ready;

    expect(store.filterOptions.labels).toEqual([{ name: secondRepositoryUrl, color: null }]);
    await store.dispose();
    await component.dispose();
  });
});

function pullRequestFixture(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    url: `${repositoryUrl}/pull/1`,
    provider: 'github',
    repositoryUrl,
    baseRefName: 'main',
    baseRefOid: 'base',
    headRepositoryUrl: repositoryUrl,
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
    updatedAt: '2026-01-01T00:00:00.000Z',
    author: null,
    labels: [],
    assignees: [],
    checks: [],
    ...overrides,
  };
}
