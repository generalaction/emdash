import { describe, expect, test } from 'vitest';
import { dispatchPass, RunningClaims, waitingOn, type PendingOperation } from './dispatch';
import type { ResourceClaim } from './resources';

const claim = (key: string, mode: ResourceClaim['mode']): ResourceClaim => ({
  resource: 'resource',
  key,
  mode,
  implicit: false,
});

function pending(
  id: string,
  seq: number,
  claims: ResourceClaim[]
): PendingOperation & { starts: string[] } {
  const starts: string[] = [];
  return {
    id,
    seq,
    claims,
    ancestors: new Set(),
    starts,
    start: () => {
      starts.push(id);
    },
  };
}

describe('RunningClaims', () => {
  test('allows shared claims to coexist and blocks exclusive claims', () => {
    const running = new RunningClaims();
    running.acquire('scan-1', [claim('worktree:a', 'shared')]);

    expect(running.compatible([claim('worktree:a', 'shared')])).toBe(true);
    expect(running.compatible([claim('worktree:a', 'exclusive')])).toBe(false);
    expect(running.blockers([claim('worktree:a', 'exclusive')])).toEqual(['scan-1']);
  });

  test('ignores ancestor holders', () => {
    const running = new RunningClaims();
    running.acquire('parent', [claim('worktree:a', 'exclusive')]);

    expect(running.blockers([claim('worktree:a', 'exclusive')], new Set(['parent']))).toEqual([]);
  });
});

describe('dispatchPass', () => {
  test('starts compatible operations in seq order', () => {
    const running = new RunningClaims();
    const first = pending('first', 1, [claim('worktree:a', 'shared')]);
    const second = pending('second', 2, [claim('worktree:a', 'shared')]);

    expect(dispatchPass([second, first], running)).toEqual({
      started: ['first', 'second'],
      skipped: [],
      deferred: [],
    });
    expect(first.starts).toEqual(['first']);
    expect(second.starts).toEqual(['second']);
  });

  test('reports blockers and fairness barriers', () => {
    const running = new RunningClaims();
    running.acquire('scan-running', [claim('worktree:a', 'shared')]);

    const teardown = pending('teardown', 1, [claim('worktree:a', 'exclusive')]);
    const scan = pending('scan-new', 2, [claim('worktree:a', 'shared')]);
    const report = dispatchPass([teardown, scan], running);

    expect(report.started).toEqual([]);
    expect(waitingOn('teardown', report)).toEqual({
      blockedBy: ['scan-running'],
      barredOn: [],
    });
    expect(waitingOn('scan-new', report)).toEqual({
      blockedBy: [],
      barredOn: ['resource:worktree:a'],
    });
  });

  test('gated skips do not plant fairness barriers', () => {
    const running = new RunningClaims();
    const gated = pending('gated', 1, [claim('worktree:a', 'exclusive')]);
    const shared = pending('shared', 2, [claim('worktree:a', 'shared')]);

    const report = dispatchPass([gated, shared], running, (op) => op.id !== 'gated');

    expect(report).toEqual({
      started: ['shared'],
      skipped: [],
      deferred: [{ id: 'gated', reason: 'gated' }],
    });
  });

  test('treats resource name as part of claim identity', () => {
    const running = new RunningClaims();
    running.acquire('repo-op', [{ ...claim('same', 'exclusive'), resource: 'repo' }]);

    expect(running.compatible([{ ...claim('same', 'exclusive'), resource: 'worktree' }])).toBe(
      true
    );
  });
});
