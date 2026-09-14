import { createScope, type Scope } from '@emdash/shared/concurrency';
import { createController } from '@emdash/wire/rpc';
import { cell, expose, snapshot } from '@emdash/wire/state';
import { defineWireComponent } from '@emdash/wire/worker';
import { observable, reaction, runInAction } from 'mobx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { pullRequestsContract } from '@core/services/pull-requests/api/contract';
import type { PullRequest, PullRequestDetails } from '@core/services/pull-requests/api/schemas';
import type { GitCheckoutStore } from '../../../browser/stores/git-checkout-store';
import type { GitRepositoryStore } from './git-repository-store';
import { PrStore } from './pr-store';
import { TaskPrAssociationStore } from './task-pr-association-store';

const mocks = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock('@core/services/pull-requests/api/client', () => ({
  getPullRequestsRuntimeClient: mocks.client,
}));
const scopes: Scope[] = [];
afterEach(async () => {
  for (const scope of scopes.splice(0).reverse()) await scope.dispose();
  vi.resetAllMocks();
});

function harness() {
  const scope = createScope();
  scopes.push(scope);
  const pr = {
    repositoryUrl: 'https://github.com/example/repo',
    identifier: '#42',
    url: 'https://github.com/example/repo/pull/42',
    status: 'open',
    title: 'Original',
  } as PullRequest;
  const state = cell<PullRequestDetails>({
    pr,
    comments: [],
    commentsFetchedAt: null,
    refreshing: false,
    stale: false,
    errors: {},
  });
  const acquired = vi.fn();
  const released = vi.fn();
  const definition = defineWireComponent({
    id: 'pr-store-details-test',
    contract: pullRequestsContract,
    configSchema: z.object({}),
    requirements: {},
    create: ({ instance, scope: owner }) => {
      const details = expose(
        pullRequestsContract.details,
        {
          state: (key, lease) => {
            acquired(key);
            lease.add(() => released(key));
            return state;
          },
        },
        { lingerMs: 0 }
      );
      const syncState = expose(pullRequestsContract.syncState, {
        state: () => cell({ phase: 'idle' as const, kind: null }),
      });
      owner.add(() => details.dispose());
      owner.add(() => syncState.dispose());
      return instance({
        scope: owner,
        controller: createController(pullRequestsContract, { details, syncState }),
      });
    },
  });
  const component = definition.create({ scope, config: {}, dependencies: {} });
  mocks.client.mockResolvedValue(component.client);
  const association = new TaskPrAssociationStore();
  association.setAssociation([pr], { kind: 'unknown' });
  const store = new PrStore(
    'project',
    'workspace',
    {} as GitRepositoryStore,
    {} as GitCheckoutStore,
    association
  );
  scope.add(() => store.dispose());
  const demand = observable({ visible: false, comments: false });
  return {
    scope,
    store,
    component,
    pr,
    association,
    state,
    acquired,
    released,
    demand,
    bind: () => store.bindDetails(() => demand),
  };
}

describe('PrStore scoped detail interest', () => {
  it('observes pushed snapshots through MobX and releases when hidden or disposed', async () => {
    const h = harness();
    h.bind();
    expect(mocks.client).not.toHaveBeenCalled();
    runInAction(() => {
      h.demand.visible = true;
    });
    await vi.waitFor(() => expect(h.acquired).toHaveBeenCalledTimes(1));
    const seen = vi.fn();
    h.scope.add(reaction(() => h.store.details?.pr?.title, seen));
    h.state.set({ ...snapshot(h.state).value, pr: { ...h.pr, title: 'External update' } });
    await vi.waitFor(() => expect(h.store.details?.pr?.title).toBe('External update'));
    expect(seen).toHaveBeenCalled();
    runInAction(() => {
      h.demand.visible = false;
    });
    await vi.waitFor(() => expect(h.released).toHaveBeenCalledTimes(1));
    expect(h.store.details).toBeNull();
    runInAction(() => {
      h.demand.visible = true;
    });
    await vi.waitFor(() => expect(h.acquired).toHaveBeenCalledTimes(2));
    h.store.dispose();
    await vi.waitFor(() => expect(h.released).toHaveBeenCalledTimes(2));
    runInAction(() => {
      h.demand.comments = true;
    });
    expect(h.acquired).toHaveBeenCalledTimes(2);
  });

  it('changes comment demand and PR identity without resubscribing on metadata updates', async () => {
    const h = harness();
    runInAction(() => {
      h.demand.visible = true;
    });
    h.bind();
    await vi.waitFor(() => expect(h.acquired).toHaveBeenCalledTimes(1));
    h.association.updateAssociatedPr({ ...h.pr, title: 'Updated', headRefOid: 'next-head' });
    expect(h.acquired).toHaveBeenCalledTimes(1);
    runInAction(() => {
      h.demand.comments = true;
    });
    await vi.waitFor(() => expect(h.acquired).toHaveBeenCalledTimes(2));
    expect(h.acquired).toHaveBeenLastCalledWith({
      repositoryUrl: h.pr.repositoryUrl,
      number: 42,
      comments: true,
    });
    h.association.setAssociation(
      [{ ...h.pr, url: `${h.pr.repositoryUrl}/pull/43`, identifier: '#43' }],
      { kind: 'unknown' }
    );
    await vi.waitFor(() => expect(h.acquired).toHaveBeenCalledTimes(3));
    expect(h.acquired).toHaveBeenLastCalledWith({
      repositoryUrl: h.pr.repositoryUrl,
      number: 43,
      comments: true,
    });
    h.association.setAssociation([], { kind: 'unknown' });
    await vi.waitFor(() => expect(h.released).toHaveBeenCalledTimes(3));
    expect(h.store.details).toBeNull();
  });

  it('does not attach a late client after visibility has ended', async () => {
    const h = harness();
    let resolve!: (client: typeof h.component.client) => void;
    mocks.client.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    runInAction(() => {
      h.demand.visible = true;
    });
    h.bind();
    runInAction(() => {
      h.demand.visible = false;
    });
    resolve(h.component.client);
    await Promise.resolve();
    await Promise.resolve();
    expect(h.acquired).not.toHaveBeenCalled();
    expect(h.store.details).toBeNull();
  });

  it('reports client failure and retries when interest is reacquired', async () => {
    const h = harness();
    mocks.client.mockRejectedValueOnce(new Error('Worker unavailable'));
    runInAction(() => {
      h.demand.visible = true;
    });
    h.bind();
    await vi.waitFor(() =>
      expect(h.store.details?.errors.metadata).toMatchObject({
        message: 'Error: Worker unavailable',
      })
    );
    expect(h.store.details?.stale).toBe(true);
    runInAction(() => {
      h.demand.visible = false;
    });
    runInAction(() => {
      h.demand.visible = true;
    });
    await vi.waitFor(() => expect(h.acquired).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(h.store.details?.stale).toBe(false));
  });
});
