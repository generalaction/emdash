import { defineContract } from '@emdash/wire/rpc';
import { createTestWire } from '@emdash/wire/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { workspaceRegistryContract as registry } from './contract';

/** The verbs that wait on host work with no fixed bound, each with a valid input. */
const longRunningVerbs = {
  createWorktree: {
    workspaceId: 'ws-task',
    repositoryId: 'ws-repo',
    branch: 'emdash/task',
    baseRef: 'origin/main',
    path: '/worktrees/task',
    preservePatterns: [],
  },
  activateWorkspace: { workspaceId: 'ws-task' },
  deactivateWorkspace: { workspaceId: 'ws-task' },
  deleteWorkspace: { workspaceId: 'ws-task' },
  deleteWorktree: { workspaceId: 'ws-task', deleteBranch: false },
  updateWorktree: { workspaceId: 'ws-task', remote: 'origin', sourceRef: 'refs/pull/7/head' },
  retryStep: { workspaceId: 'ws-task', step: 'push-branch' },
  measureUsage: { workspaceId: 'ws-task' },
} as const;

type LongRunningVerb = keyof typeof longRunningVerbs;

const longRunningContract = defineContract({
  createWorktree: registry.createWorktree,
  activateWorkspace: registry.activateWorkspace,
  deactivateWorkspace: registry.deactivateWorkspace,
  deleteWorkspace: registry.deleteWorkspace,
  deleteWorktree: registry.deleteWorktree,
  updateWorktree: registry.updateWorktree,
  retryStep: registry.retryStep,
  measureUsage: registry.measureUsage,
});

/** A host whose verbs are still working — `git worktree add`, prepare, teardown. */
function busyHost() {
  const started = vi.fn();
  const working = () =>
    new Promise<never>(() => {
      started();
    });
  const wire = createTestWire(longRunningContract, {
    createWorktree: working,
    activateWorkspace: working,
    deactivateWorkspace: working,
    deleteWorkspace: working,
    deleteWorktree: working,
    updateWorktree: working,
    retryStep: working,
    measureUsage: working,
  });
  return { wire, started };
}

function call(client: ReturnType<typeof busyHost>['wire']['client'], verb: LongRunningVerb) {
  const invoke = client[verb] as (input: unknown) => Promise<unknown>;
  return invoke(longRunningVerbs[verb]);
}

describe('workspace registry call deadlines', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(Object.keys(longRunningVerbs) as LongRunningVerb[])(
    '%s waits for host work that outlasts the default call deadline',
    async (verb) => {
      const host = busyHost();
      try {
        let settled = false;
        const pending = call(host.wire.client, verb).finally(() => {
          settled = true;
        });
        void pending.catch(() => undefined);

        await vi.advanceTimersByTimeAsync(10 * 60_000);

        expect(host.started).toHaveBeenCalledOnce();
        expect(settled).toBe(false);
      } finally {
        await host.wire.dispose();
      }
    }
  );

  it.each(Object.keys(longRunningVerbs) as LongRunningVerb[])(
    '%s still reports a lost host connection as a transport failure',
    async (verb) => {
      const host = busyHost();
      try {
        const pending = call(host.wire.client, verb).catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(60_000);

        host.wire.pair.disconnect();

        expect(await pending).toMatchObject({
          code: 'DISCONNECTED',
          message: 'Wire transport disconnected',
        });
      } finally {
        await host.wire.dispose();
      }
    }
  );

  it('keeps the default deadline for quick verbs', async () => {
    const wire = createTestWire(defineContract({ createWorkspace: registry.createWorkspace }), {
      createWorkspace: () => new Promise<never>(() => undefined),
    });
    try {
      const registered = wire.client
        .createWorkspace({ workspaceId: 'ws-repo', path: '/repo' })
        .catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(30_000);

      expect(await registered).toMatchObject({ code: 'TIMEOUT' });
    } finally {
      await wire.dispose();
    }
  });
});
