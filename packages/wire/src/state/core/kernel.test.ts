import { createScope } from '@emdash/shared/concurrency';
import { describe, expect, it } from 'vitest';
import { recordSnapshots } from '../testing';
import { batch, cell, derived, flushStateTurn, observe, peek, read, snapshot } from './index';

describe('state kernel', () => {
  it('publishes a diamond derived graph once per turn without glitches', async () => {
    const source = cell(1);
    const left = derived(() => read(source) + 1);
    const right = derived(() => read(source) * 2);
    const total = derived(() => (read(left) ?? 0) + (read(right) ?? 0));
    const recorded = recordSnapshots(total);

    source.set(2);
    flushStateTurn();

    expect(recorded.snapshots.map((current) => current.value)).toEqual([4, 7]);
    await recorded.dispose();
  });

  it('tracks dynamic dependencies and ignores dependencies that are no longer read', async () => {
    const useLeft = cell(true);
    const left = cell('left');
    const right = cell('right');
    const selected = derived(() => (read(useLeft) ? read(left) : read(right)));
    const recorded = recordSnapshots(selected);

    useLeft.set(false);
    flushStateTurn();
    left.set('ignored');
    flushStateTurn();
    right.set('updated');
    flushStateTurn();

    expect(recorded.snapshots.map((current) => current.value)).toEqual([
      'left',
      'right',
      'updated',
    ]);
    await recorded.dispose();
  });

  it('keeps dependencies from a failed first compute and retries when they publish', async () => {
    const input = cell(1);
    let shouldThrow = true;
    const computed = derived(() => {
      const value = read(input);
      if (shouldThrow) throw new Error('boom');
      return value * 2;
    });
    const recorded = recordSnapshots(computed);

    expect(snapshot(computed).status).toBe('error');
    shouldThrow = false;
    input.set(2);
    flushStateTurn();

    expect(recorded.snapshots.map((current) => current.status)).toEqual(['error', 'live']);
    expect(snapshot(computed).value).toBe(4);
    await recorded.dispose();
  });

  it('isolates observer failures so later notifications can still flush', async () => {
    const scope = createScope();
    const errors: unknown[] = [];
    const first = cell(0, {
      instrumentation: {
        observerError: (error) => errors.push(error),
      },
    });
    const second = cell(0);
    const seen: number[] = [];

    observe(
      first,
      () => {
        throw new Error('observer failed');
      },
      { scope }
    );
    observe(second, (current) => seen.push(current.value), { scope });

    first.set(1);
    second.set(1);
    flushStateTurn();
    second.set(2);
    flushStateTurn();

    expect(errors).toHaveLength(2);
    expect(seen).toEqual([0, 1, 2]);
    await scope.dispose();
  });

  it('folds mutation ids through derived state only for dependencies that advanced', async () => {
    const source = cell(1);
    const unrelated = cell(1);
    const view = derived(() => read(source) + read(unrelated));
    const recorded = recordSnapshots(view);

    source.set(2, { mutationIds: ['m1'] });
    flushStateTurn();
    unrelated.set(2);
    flushStateTurn();

    expect(recorded.snapshots.map((current) => current.mutationIds)).toEqual([
      undefined,
      ['m1'],
      undefined,
    ]);
    await recorded.dispose();
  });

  it('merges batch metadata and keeps peek untracked', async () => {
    const tracked = cell(1);
    const untracked = cell(10);
    const view = derived(() => read(tracked) + peek(untracked));
    const recorded = recordSnapshots(view);

    batch(
      () => {
        tracked.set(2, { mutationIds: ['inner'] });
        untracked.set(20);
      },
      { mutationIds: ['outer'] }
    );
    flushStateTurn();
    untracked.set(30);
    flushStateTurn();

    expect(recorded.snapshots.map((current) => current.value)).toEqual([11, 22]);
    expect(recorded.snapshots.at(-1)?.mutationIds).toEqual(['outer', 'inner']);
    await recorded.dispose();
  });
});
