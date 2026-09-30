import { err, ok } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import { createController, WireError, type ContractClient } from '@emdash/wire/rpc';
import { cell, expose, type Cell } from '@emdash/wire/state';
import { defineWireComponent } from '@emdash/wire/worker';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  pullRequestsContract,
  type PullRequest,
  type PullRequestsContract,
  type SyncState,
} from '../api';
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
  it('joins local history requests and cancels only the selected caller-owned operation', async () => {
    const h = historyHarness();
    const first = h.store.refreshHistory(repositoryUrl);
    const duplicate = h.store.refreshHistory('git@github.com:emdash/emdash.git');
    expect(duplicate).toBe(first);
    expect(h.refreshHistory).toHaveBeenCalledTimes(1);
    expect(h.store.canCancelHistory(repositoryUrl)).toBe(true);

    const otherRepository = 'https://github.com/emdash/other';
    const other = h.store.refreshHistory(otherRepository);
    const cancelled = expect(first).rejects.toMatchObject({ code: 'CANCELLED' });
    h.store.cancelHistory(repositoryUrl);
    expect(h.store.canCancelHistory(repositoryUrl)).toBe(false);
    expect(h.pending.get(otherRepository)?.signal.aborted).toBe(false);
    await cancelled;
    h.pending.get(otherRepository)?.resolve(ok());
    await other;
    expect(h.store.canCancelHistory(otherRepository)).toBe(false);
    expect(h.refreshRepository).not.toHaveBeenCalled();
    await h.store.dispose();
  });

  it('aborts locally owned history requests on disposal', async () => {
    const h = historyHarness();
    const pending = h.store.refreshHistory(repositoryUrl);
    const cancelled = expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    await h.store.dispose();
    await cancelled;
    expect(h.pending.get(repositoryUrl)?.signal.aborted).toBe(true);
    expect(h.store.canCancelHistory(repositoryUrl)).toBe(false);
    await expect(h.store.refreshHistory(repositoryUrl)).rejects.toThrow('disposed');
    expect(h.refreshHistory).toHaveBeenCalledTimes(1);
  });

  it('reloads the list exactly once when sync-backed data changes', async () => {
    const refreshRepository = vi.fn(() => ok(undefined));
    const scope = createScope({ label: 'pull-requests-browser-test' });
    const syncCells = new Map<string, Cell<SyncState>>();
    const testComponent = defineWireComponent({
      id: 'pull-requests-browser-test',
      contract: pullRequestsContract,
      requirements: {},
      configSchema: z.object({}),
      create: ({ instance, scope: componentScope }) => {
        const syncState = expose(pullRequestsContract.syncState, {
          state: (key) => syncCell(syncCells, key.repositoryUrl),
        });
        componentScope.add(() => syncState.dispose());
        const details = expose(pullRequestsContract.details, {
          state: () =>
            cell({
              pr: null,
              comments: [],
              commentsFetchedAt: null,
              refreshing: false,
              stale: true,
              errors: {},
            }),
        });
        componentScope.add(() => details.dispose());
        syncCell(syncCells, repositoryUrl);
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
            getPullRequestsForHead: () => ok({ prs: [] }),
            registerRepository: () => ok(),
            unregisterRepository: () => ok(),
            refreshRepository,
            refreshHistory: () => ok(),
            refreshPullRequest: () => ok(),
            createPullRequest: () => ok({ url: `${repositoryUrl}/pull/1`, number: 1 }),
            mergePullRequest: () => ok({ sha: null, merged: true }),
            markReadyForReview: () => ok(),
            getPullRequestFiles: () => ok({ files: [] }),
            syncState,
            details,
          }),
        });
      },
    });
    const component = testComponent.create({
      scope,
      dependencies: {},
      config: {},
    });
    const store = new PullRequestsStore(component.client, [repositoryUrl]);
    await store.ready;
    expect(refreshRepository).not.toHaveBeenCalled();
    const reload = vi.spyOn(store, 'reload').mockResolvedValue();

    syncCell(syncCells, repositoryUrl).set({
      phase: 'running',
      kind: 'repository',
      synced: 0,
    });
    syncCell(syncCells, repositoryUrl).set({
      phase: 'idle',
      kind: 'repository',
      synced: 1,
      lastSyncedAt: 1,
      revision: 1,
    });

    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    await expect(store.mergePullRequest(repositoryUrl, 1, { strategy: 'merge' })).resolves.toEqual(
      ok({ sha: null, merged: true })
    );
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(2));
    await store.dispose();
    await component.dispose();
  });

  it('ignores stale filter options after repositories change', async () => {
    const refreshRepository = vi.fn(() => ok(undefined));
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
        const syncCells = new Map<string, Cell<SyncState>>();
        const syncState = expose(pullRequestsContract.syncState, {
          state: (key) => syncCell(syncCells, key.repositoryUrl),
        });
        componentScope.add(() => syncState.dispose());
        const details = expose(pullRequestsContract.details, {
          state: () =>
            cell({
              pr: null,
              comments: [],
              commentsFetchedAt: null,
              refreshing: false,
              stale: true,
              errors: {},
            }),
        });
        componentScope.add(() => details.dispose());
        syncCell(syncCells, repositoryUrl);
        syncCell(syncCells, secondRepositoryUrl);
        return instance({
          scope: componentScope,
          controller: createController(pullRequestsContract, {
            listPullRequests: () => ok({ prs: [], nextCursor: null }),
            getFilterOptions,
            getPullRequestsForBranch: () => ok({ prs: [] }),
            getPullRequestsForHead: () => ok({ prs: [] }),
            registerRepository: () => ok(),
            unregisterRepository: () => ok(),
            refreshRepository,
            refreshHistory: () => ok(),
            refreshPullRequest: () => ok(),
            createPullRequest: () => ok({ url: `${repositoryUrl}/pull/1`, number: 1 }),
            mergePullRequest: () => ok({ sha: null, merged: true }),
            markReadyForReview: () => ok(),
            getPullRequestFiles: () => ok({ files: [] }),
            syncState,
            details,
          }),
        });
      },
    });
    const component = testComponent.create({
      scope,
      dependencies: {},
      config: {},
    });
    const store = new PullRequestsStore(component.client, [repositoryUrl]);
    await vi.waitFor(() => expect(pending.has(repositoryUrl)).toBe(true));

    store.setRepositoryUrls([secondRepositoryUrl]);
    await vi.waitFor(() => expect(pending.has(secondRepositoryUrl)).toBe(true));
    expect(refreshRepository).not.toHaveBeenCalled();
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

function historyHarness() {
  type HistoryResult = Awaited<ReturnType<ContractClient<PullRequestsContract>['refreshHistory']>>;
  const pending = new Map<
    string,
    { signal: AbortSignal; resolve: (result: HistoryResult) => void }
  >();
  const refreshHistory = vi.fn(
    ({ repositoryUrl }: { repositoryUrl: string }, { signal }: { signal: AbortSignal }) =>
      new Promise<HistoryResult>((resolve, reject) => {
        pending.set(repositoryUrl, { signal, resolve });
        signal.addEventListener(
          'abort',
          () => reject(new WireError('CANCELLED', 'History refresh cancelled')),
          { once: true }
        );
      })
  );
  const refreshRepository = vi.fn(async () => ok());
  const client = {
    refreshHistory,
    refreshRepository,
    syncState: {},
  } as unknown as ContractClient<PullRequestsContract>;
  const store = new PullRequestsStore(client, []);
  return { store, refreshHistory, refreshRepository, pending };
}

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

function syncCell(cells: Map<string, Cell<SyncState>>, repositoryUrl: string): Cell<SyncState> {
  let current = cells.get(repositoryUrl);
  if (!current) {
    current = cell<SyncState>({ phase: 'idle', kind: null });
    cells.set(repositoryUrl, current);
  }
  return current;
}
