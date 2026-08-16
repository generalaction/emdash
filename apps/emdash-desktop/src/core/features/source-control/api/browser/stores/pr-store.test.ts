import { createManualClock } from '@emdash/shared/testing';
import { observable } from 'mobx';
import { describe, expect, it } from 'vitest';
import type { ProjectHostAccessState } from '@core/features/projects/api/browser/stores/project-context';
import type { TaskStore } from '@core/features/tasks/api/browser/stores/task-store';
import type { PullRequest } from '@core/services/pull-requests/api';
import type { GitCheckoutStore } from '../../../browser/stores/git-checkout-store';
import type { GitRepositoryStore } from './git-repository-store';
import { PrStore } from './pr-store';

const pullRequest = {
  url: 'https://github.com/example/repo/pull/1',
  status: 'open',
  title: 'Retained pull request',
} as PullRequest;

describe('PrStore Host observations', () => {
  it('retains observed PRs as stale and distinguishes never-observed data', () => {
    const state = observable.box<ProjectHostAccessState>(
      { kind: 'ready', hostGeneration: 1 },
      { deep: false }
    );
    const repository = {
      observeHost: <T>(
        observation: { kind: 'never-observed' } | { kind: 'observed'; value: T; observedAt: number }
      ) => {
        if (observation.kind === 'never-observed') return { kind: 'unavailable' as const };
        return state.get().kind === 'ready'
          ? { ...observation, kind: 'fresh' as const }
          : { ...observation, kind: 'stale' as const };
      },
    } as GitRepositoryStore;
    const task = observable({
      state: 'provisioned' as const,
      data: { prs: [pullRequest] },
    }) as unknown as TaskStore;
    const store = new PrStore(
      'project-1',
      'workspace-1',
      repository,
      {} as GitCheckoutStore,
      task,
      createManualClock(1_786_000_000_000)
    );

    expect(store.pullRequestsObservation).toMatchObject({
      kind: 'fresh',
      value: [pullRequest],
      observedAt: 1_786_000_000_000,
    });

    state.set({ kind: 'degraded', situation: 'offline', recovery: 'automatic' });
    expect(store.pullRequestsObservation).toMatchObject({
      kind: 'stale',
      value: [pullRequest],
    });

    task.state = 'unregistered';
    expect(store.pullRequests).toEqual([pullRequest]);
    expect(store.pullRequestsObservation.kind).toBe('stale');
    store.dispose();

    const neverObservedTask = observable({
      state: 'unregistered' as const,
      data: {},
    }) as unknown as TaskStore;
    const neverObserved = new PrStore(
      'project-1',
      'workspace-2',
      repository,
      {} as GitCheckoutStore,
      neverObservedTask
    );
    expect(neverObserved.pullRequestsObservation).toEqual({ kind: 'unavailable' });
    neverObserved.dispose();
  });
});
