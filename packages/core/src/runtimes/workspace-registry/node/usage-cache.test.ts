import { err, ok } from '@emdash/shared';
import { deferred, ManualClock, type Deferred } from '@emdash/shared/testing';
import { describe, expect, it } from 'vitest';
import type { WorkspaceUsage } from '../api/schemas';
import type { MeasureWorkspaceUsageError, MeasureWorkspaceUsageOptions } from './measure-usage';
import { WorkspaceUsageCache, type WorkspaceUsageTarget } from './usage-cache';

type UsageResult = Awaited<ReturnType<WorkspaceUsageCache['measure']>>;

const target: WorkspaceUsageTarget = {
  workspaceId: 'ws-repo',
  workspacePath: '/srv/repo',
  excludePaths: ['/srv/repo/.claude/worktrees/a'],
};

function usage(totalBytes: number): WorkspaceUsage {
  return { totalBytes, artifactBytes: 0, errors: [] };
}

/** A measure seam whose walks finish when the test settles them or their signal aborts. */
function controlledMeasure() {
  const calls: Array<{ options: MeasureWorkspaceUsageOptions; walk: Deferred<UsageResult> }> = [];
  const measure = (options: MeasureWorkspaceUsageOptions) => {
    const walk = deferred<UsageResult>();
    options.signal?.addEventListener('abort', () => walk.reject(options.signal!.reason));
    calls.push({ options, walk });
    return walk.promise;
  };
  return { calls, measure };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

describe('WorkspaceUsageCache', () => {
  it('shares one walk between concurrent callers and serves it until the ttl lapses', async () => {
    const clock = new ManualClock(0);
    const { calls, measure } = controlledMeasure();
    const cache = new WorkspaceUsageCache({ clock, ttlMs: 60_000, measure });

    const first = cache.measure(target);
    const second = cache.measure({ ...target, excludePaths: [...target.excludePaths] });
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.options).toMatchObject({
      workspacePath: '/srv/repo',
      excludePaths: ['/srv/repo/.claude/worktrees/a'],
    });
    calls[0]!.walk.resolve(ok(usage(100)));
    expect(await first).toEqual(ok(usage(100)));
    expect(await second).toEqual(ok(usage(100)));

    await clock.advanceBy(59_000);
    expect(await cache.measure(target)).toEqual(ok(usage(100)));
    expect(calls).toHaveLength(1);

    await clock.advanceBy(1_000);
    const refreshed = cache.measure(target);
    await flush();
    expect(calls).toHaveLength(2);
    calls[1]!.walk.resolve(ok(usage(200)));
    expect(await refreshed).toEqual(ok(usage(200)));
    cache.dispose();
  });

  it('measures separately when the nested workspaces to skip differ', async () => {
    const { calls, measure } = controlledMeasure();
    const cache = new WorkspaceUsageCache({ measure });

    const skipping = cache.measure(target);
    const whole = cache.measure({ ...target, excludePaths: [] });
    await flush();

    expect(calls.map((call) => call.options.excludePaths)).toEqual([
      ['/srv/repo/.claude/worktrees/a'],
      [],
    ]);
    calls[0]!.walk.resolve(ok(usage(100)));
    calls[1]!.walk.resolve(ok(usage(300)));
    expect(await skipping).toEqual(ok(usage(100)));
    expect(await whole).toEqual(ok(usage(300)));
    cache.dispose();
  });

  it('hands a failure to current callers and retries it on the next request', async () => {
    const { calls, measure } = controlledMeasure();
    const cache = new WorkspaceUsageCache({ measure });
    const failure: MeasureWorkspaceUsageError = {
      type: 'git-command-failed',
      message: 'not a git repository',
    };

    const failed = cache.measure(target);
    await flush();
    calls[0]!.walk.resolve(err(failure));
    expect(await failed).toEqual(err(failure));

    const retried = cache.measure(target);
    await flush();
    expect(calls).toHaveLength(2);
    calls[1]!.walk.resolve(ok(usage(100)));
    expect(await retried).toEqual(ok(usage(100)));
    cache.dispose();
  });

  it('cancels a walk only after every waiting caller has gone away', async () => {
    const { calls, measure } = controlledMeasure();
    const cache = new WorkspaceUsageCache({ measure });
    const firstView = new AbortController();
    const secondView = new AbortController();

    const first = cache.measure(target, firstView.signal);
    const second = cache.measure(target, secondView.signal);
    await flush();
    const walkSignal = calls[0]!.options.signal!;

    firstView.abort(new Error('first view closed'));
    await expect(first).rejects.toThrow('first view closed');
    expect(walkSignal.aborted).toBe(false);

    secondView.abort(new Error('second view closed'));
    await expect(second).rejects.toThrow('second view closed');
    expect(walkSignal.aborted).toBe(true);

    const reopened = cache.measure(target);
    await flush();
    expect(calls).toHaveLength(2);
    calls[1]!.walk.resolve(ok(usage(100)));
    expect(await reopened).toEqual(ok(usage(100)));
    cache.dispose();
  });

  it('keeps walking for a caller without a signal when another caller aborts', async () => {
    const { calls, measure } = controlledMeasure();
    const cache = new WorkspaceUsageCache({ measure });
    const view = new AbortController();

    const background = cache.measure(target);
    const closing = cache.measure(target, view.signal);
    await flush();
    view.abort();
    await expect(closing).rejects.toThrow();

    expect(calls[0]!.options.signal!.aborted).toBe(false);
    calls[0]!.walk.resolve(ok(usage(100)));
    expect(await background).toEqual(ok(usage(100)));
    cache.dispose();
  });
});
