import { createManualClock } from '@emdash/shared/testing';
import { describe, expect, it, vi } from 'vitest';
import {
  compileIdlePolicy,
  createIdleSweeper,
  createIoActivityTracker,
  type IoActivitySnapshot,
} from './index';

const baseSnapshot: IoActivitySnapshot = {
  running: true,
  busy: false,
  attachedClients: 0,
  detachedAt: 0,
  lastInputAt: null,
  lastOutputAt: null,
};

describe('compileIdlePolicy', () => {
  it('deactivates while-attached entries after the detach grace period', () => {
    const policy = compileIdlePolicy({ kind: 'while-attached', graceMs: 1_000 });

    expect(policy({ ...baseSnapshot, detachedAt: 0 }, 1_000)).toEqual({ action: 'keep' });
    expect(policy({ ...baseSnapshot, detachedAt: 0 }, 1_001)).toEqual({
      action: 'deactivate',
      reason: 'detached',
    });
    expect(policy({ ...baseSnapshot, attachedClients: 1, detachedAt: null }, 10_000)).toEqual({
      action: 'keep',
    });
  });

  it('deactivates idle entries only when input and output are stale', () => {
    const policy = compileIdlePolicy({ kind: 'idle-after', outputMs: 1_000, inputMs: 2_000 });

    expect(policy({ ...baseSnapshot, lastInputAt: 1_000, lastOutputAt: 2_000 }, 2_500)).toEqual({
      action: 'keep',
    });
    expect(policy({ ...baseSnapshot, lastInputAt: 1_000, lastOutputAt: 2_000 }, 3_000)).toEqual({
      action: 'keep',
    });
    expect(policy({ ...baseSnapshot, lastInputAt: 1_000, lastOutputAt: 2_000 }, 3_500)).toEqual({
      action: 'deactivate',
      reason: 'idle',
    });
  });

  it('keeps busy and always/until-complete entries', () => {
    expect(compileIdlePolicy({ kind: 'idle-after', outputMs: 1_000 })(
      { ...baseSnapshot, busy: true },
      10_000
    )).toEqual({ action: 'keep' });
    expect(compileIdlePolicy({ kind: 'always' })(baseSnapshot, 10_000)).toEqual({
      action: 'keep',
    });
    expect(compileIdlePolicy({ kind: 'until-complete' })(baseSnapshot, 10_000)).toEqual({
      action: 'keep',
    });
  });
});

describe('createIoActivityTracker', () => {
  it('tracks input/output and throttles output updates', async () => {
    const clock = createManualClock(1_000);
    const tracker = createIoActivityTracker(() => clock.now(), { outputThrottleMs: 100 });

    tracker.attach();
    tracker.recordInput();
    tracker.recordOutput();
    expect(tracker.snapshot()).toEqual({
      attachedClients: 1,
      detachedAt: null,
      lastInputAt: 1_000,
      lastOutputAt: 1_000,
    });

    await clock.advanceBy(50);
    tracker.recordOutput();
    expect(tracker.snapshot().lastOutputAt).toBe(1_000);

    await clock.advanceBy(50);
    tracker.recordOutput();
    expect(tracker.snapshot().lastOutputAt).toBe(1_100);

    tracker.detach();
    expect(tracker.snapshot()).toMatchObject({ attachedClients: 0, detachedAt: 1_100 });
  });
});

describe('createIdleSweeper', () => {
  it('runs beforeSweep once per sweep and deactivates matching entries', async () => {
    const clock = createManualClock(0);
    const beforeSweep = vi.fn();
    const deactivate = vi.fn();
    const sweeper = createIdleSweeper({
      clock,
      intervalMs: 1_000,
      beforeSweep,
      entries: () => ['a', 'b'],
      snapshot: (entry) => ({ ...baseSnapshot, detachedAt: entry === 'a' ? 0 : 900 }),
      policy: () => compileIdlePolicy({ kind: 'while-attached', graceMs: 500 }),
      deactivate,
    });

    await clock.advanceBy(1_000);

    expect(beforeSweep).toHaveBeenCalledTimes(1);
    expect(deactivate).toHaveBeenCalledTimes(1);
    expect(deactivate).toHaveBeenCalledWith('a', 'detached');
    sweeper.dispose();
  });

  it('continues with stale data when beforeSweep fails', async () => {
    const clock = createManualClock(0);
    const onError = vi.fn();
    const deactivate = vi.fn();
    const sweeper = createIdleSweeper({
      clock,
      intervalMs: 1_000,
      beforeSweep: async () => {
        throw new Error('probe failed');
      },
      entries: () => ['entry'],
      snapshot: () => baseSnapshot,
      policy: () => () => ({ action: 'deactivate', reason: 'idle' }),
      deactivate,
      onError,
    });

    await clock.advanceBy(1_000);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(deactivate).toHaveBeenCalledWith('entry', 'idle');
    sweeper.dispose();
  });
});
