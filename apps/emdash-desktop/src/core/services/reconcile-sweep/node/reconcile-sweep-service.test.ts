import { hostRef, LOCAL_HOST_REF, type HostRef } from '@emdash/core/primitives/host/api';
import { createScope, type Scope } from '@emdash/shared/concurrency';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ReconcileSweepService,
  type ReconcileSweepKind,
  type ReconcileTombstone,
  type RemovalAttemptOutcome,
} from './reconcile-sweep-service';

const REMOTE_HOST = hostRef('remote', 'ssh-1');

/**
 * The sweep seam (ADR 0006, spec §2): the entity-generic primitive driven against a
 * fake kind — an in-memory tombstone store plus a scripted removal function. The
 * tests pin the lifecycle the spec decided: per-tombstone single-flight, per-item
 * exponential backoff riding the backstop, purge gated on the store confirming the
 * record gone (never on the RPC return), the terminal-failure stop with its Retry
 * and Untrack-anyway affordances, and rows vanishing mid-sweep staying benign.
 */
describe('ReconcileSweepService', () => {
  let scope: Scope;
  let now: number;

  beforeEach(() => {
    scope = createScope({ label: 'reconcile-sweep-test' });
    now = 1_000_000;
  });

  afterEach(async () => {
    await scope.dispose();
  });

  function createService(options: { onError?: (context: string, error: unknown) => void } = {}) {
    return new ReconcileSweepService({
      scope,
      now: () => now,
      onError: options.onError ?? (() => {}),
    });
  }

  type FakeItem = ReconcileTombstone & { gone?: boolean };

  /** In-memory stand-in for the mirror: live tombstoned rows plus a gone flag. */
  function createFakeKind(
    options: {
      kind?: string;
      outcome?: RemovalAttemptOutcome | (() => RemovalAttemptOutcome);
      onRemoval?: (host: HostRef, id: string) => void | Promise<void>;
    } = {}
  ) {
    const items = new Map<string, FakeItem>();
    const executeRemoval = vi.fn(async (host: HostRef, id: string) => {
      await options.onRemoval?.(host, id);
      return typeof options.outcome === 'function' ? options.outcome() : (options.outcome ?? 'ok');
    });
    const kind: ReconcileSweepKind = {
      kind: options.kind ?? 'widgets',
      readTombstones: async () =>
        [...items.values()]
          .filter((item) => item.gone !== true)
          .map(({ gone: _gone, ...item }) => item),
      executeRemoval,
      confirmGone: async (_host, id) => items.get(id)?.gone !== false,
    };
    return {
      kind,
      executeRemoval,
      seed(id: string, overrides: Partial<FakeItem> = {}) {
        items.set(id, {
          id,
          tombstonedAt: now,
          lastRemovalAttempt: null,
          gone: false,
          ...overrides,
        });
      },
      markGone(id: string) {
        const item = items.get(id);
        if (item) item.gone = true;
      },
      annotate(id: string, lastRemovalAttempt: ReconcileTombstone['lastRemovalAttempt']) {
        const item = items.get(id);
        if (item) item.lastRemovalAttempt = lastRemovalAttempt;
      },
      forgetAll() {
        items.clear();
      },
    };
  }

  it('sweeps a host and calls the removal function once per tombstone', async () => {
    const fake = createFakeKind();
    fake.seed('a');
    fake.seed('b');
    const service = createService();
    service.registerKind(fake.kind);

    await service.sweepHost(LOCAL_HOST_REF);

    expect(fake.executeRemoval).toHaveBeenCalledTimes(2);
    expect(fake.executeRemoval).toHaveBeenCalledWith(LOCAL_HOST_REF, 'a');
    expect(fake.executeRemoval).toHaveBeenCalledWith(LOCAL_HOST_REF, 'b');
  });

  it('attachHost marks the host reachable and triggers an immediate sweep', async () => {
    const fake = createFakeKind();
    fake.seed('a');
    const service = createService();
    service.registerKind(fake.kind);

    service.attachHost(REMOTE_HOST);
    await vi.waitFor(() => expect(fake.executeRemoval).toHaveBeenCalledTimes(1));
    expect(fake.executeRemoval).toHaveBeenCalledWith(REMOTE_HOST, 'a');
  });

  it('single-flight: two overlapping triggers issue one RPC per tombstone', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fake = createFakeKind({ onRemoval: () => gate });
    fake.seed('a');
    const service = createService();
    service.registerKind(fake.kind);

    const first = service.sweepHost(LOCAL_HOST_REF);
    const second = service.sweepHost(LOCAL_HOST_REF);
    release?.();
    await Promise.all([first, second]);

    expect(fake.executeRemoval).toHaveBeenCalledTimes(1);
  });

  it('failed attempts back off exponentially, capped at one hour', async () => {
    const fake = createFakeKind({ outcome: 'failed' });
    fake.seed('a');
    const service = createService();
    service.registerKind(fake.kind);

    await service.sweepHost(LOCAL_HOST_REF);
    expect(fake.executeRemoval).toHaveBeenCalledTimes(1);

    // Inside the first backoff window (1 minute): skipped.
    now += 30_000;
    await service.sweepHost(LOCAL_HOST_REF);
    expect(fake.executeRemoval).toHaveBeenCalledTimes(1);

    // Past the window: retried, doubling the next window to 2 minutes.
    now += 31_000;
    await service.sweepHost(LOCAL_HOST_REF);
    expect(fake.executeRemoval).toHaveBeenCalledTimes(2);

    now += 60_000;
    await service.sweepHost(LOCAL_HOST_REF);
    expect(fake.executeRemoval).toHaveBeenCalledTimes(2);
    now += 61_000;
    await service.sweepHost(LOCAL_HOST_REF);
    expect(fake.executeRemoval).toHaveBeenCalledTimes(3);

    // After many failures the window never exceeds the one-hour cap.
    for (let i = 0; i < 10; i += 1) {
      now += 60 * 60_000 + 1_000;
      await service.sweepHost(LOCAL_HOST_REF);
    }
    const calls = fake.executeRemoval.mock.calls.length;
    now += 60 * 60_000 + 1_000;
    await service.sweepHost(LOCAL_HOST_REF);
    expect(fake.executeRemoval.mock.calls.length).toBe(calls + 1);
  });

  it('an unreachable host is not an attempt: no backoff is scheduled', async () => {
    const fake = createFakeKind({ outcome: 'unreachable' });
    fake.seed('a');
    const service = createService();
    service.registerKind(fake.kind);

    await service.sweepHost(LOCAL_HOST_REF);
    await service.sweepHost(LOCAL_HOST_REF);

    expect(fake.executeRemoval).toHaveBeenCalledTimes(2);
  });

  it('a successful RPC purges nothing: the item re-sweeps until the store confirms gone', async () => {
    const fake = createFakeKind({ outcome: 'ok' });
    fake.seed('a');
    const service = createService();
    service.registerKind(fake.kind);

    await service.sweepHost(LOCAL_HOST_REF);
    expect(fake.executeRemoval).toHaveBeenCalledTimes(1);

    // Still tombstoned in the store — the RPC return asserted nothing; re-issue.
    await service.sweepHost(LOCAL_HOST_REF);
    expect(fake.executeRemoval).toHaveBeenCalledTimes(2);

    // The store confirms the record gone (sync-delivered): no further RPCs.
    fake.markGone('a');
    await service.sweepHost(LOCAL_HOST_REF);
    expect(fake.executeRemoval).toHaveBeenCalledTimes(2);
  });

  it('skips the RPC when the record is confirmed gone between read and execute', async () => {
    const fake = createFakeKind();
    fake.seed('a');
    const service = createService();
    service.registerKind(fake.kind);
    // Simulate sync landing between readTombstones and the removal call.
    const original = fake.kind.confirmGone;
    fake.kind.confirmGone = async (host, id) => {
      fake.markGone('a');
      return original(host, id);
    };

    await service.sweepHost(LOCAL_HOST_REF);

    expect(fake.executeRemoval).not.toHaveBeenCalled();
  });

  it('terminal failures stop auto-retry for that item only', async () => {
    const fake = createFakeKind();
    fake.seed('stuck', {
      tombstonedAt: now - 60_000,
      lastRemovalAttempt: { class: 'terminal', at: now - 1_000 },
    });
    fake.seed('fine');
    const service = createService();
    service.registerKind(fake.kind);

    await service.sweepHost(LOCAL_HOST_REF);

    expect(fake.executeRemoval).toHaveBeenCalledTimes(1);
    expect(fake.executeRemoval).toHaveBeenCalledWith(LOCAL_HOST_REF, 'fine');
  });

  it('a transient failure mark never stops the sweep', async () => {
    const fake = createFakeKind();
    fake.seed('a', {
      tombstonedAt: now - 60_000,
      lastRemovalAttempt: { class: 'transient', at: now - 1_000 },
    });
    const service = createService();
    service.registerKind(fake.kind);

    await service.sweepHost(LOCAL_HOST_REF);

    expect(fake.executeRemoval).toHaveBeenCalledTimes(1);
  });

  it('a terminal mark that predates the tombstone does not block the fresh intent', async () => {
    const fake = createFakeKind();
    fake.seed('a', {
      tombstonedAt: now,
      lastRemovalAttempt: { class: 'terminal', at: now - 10_000 },
    });
    const service = createService();
    service.registerKind(fake.kind);

    await service.sweepHost(LOCAL_HOST_REF);

    expect(fake.executeRemoval).toHaveBeenCalledTimes(1);
  });

  it('retry clears the terminal stop and backoff, and sweeps immediately', async () => {
    const fake = createFakeKind({ outcome: 'failed' });
    fake.seed('a', {
      tombstonedAt: now - 60_000,
      lastRemovalAttempt: { class: 'terminal', at: now - 1_000 },
    });
    const service = createService();
    service.registerKind(fake.kind);

    await service.sweepHost(LOCAL_HOST_REF);
    expect(fake.executeRemoval).not.toHaveBeenCalled();

    service.retry('widgets', LOCAL_HOST_REF, 'a');
    await vi.waitFor(() => expect(fake.executeRemoval).toHaveBeenCalledTimes(1));
  });

  it('a new terminal failure after a retry stops the item again', async () => {
    const fake = createFakeKind({ outcome: 'failed' });
    fake.seed('a', {
      tombstonedAt: now - 60_000,
      lastRemovalAttempt: { class: 'terminal', at: now - 1_000 },
    });
    const service = createService();
    service.registerKind(fake.kind);

    service.retry('widgets', LOCAL_HOST_REF, 'a');
    await vi.waitFor(() => expect(fake.executeRemoval).toHaveBeenCalledTimes(1));

    // The retried attempt failed terminally again — the host stamps a newer mark.
    now += 5_000;
    fake.annotate('a', { class: 'terminal', at: now });
    now += 120_000;
    await service.sweepHost(LOCAL_HOST_REF);
    expect(fake.executeRemoval).toHaveBeenCalledTimes(1);
  });

  it('drop forgets the in-memory state for an untracked-anyway item', async () => {
    const fake = createFakeKind({ outcome: 'failed' });
    fake.seed('a');
    const service = createService();
    service.registerKind(fake.kind);
    await service.sweepHost(LOCAL_HOST_REF);

    // Untrack-anyway purges the row client-side; the store stops serving it.
    fake.markGone('a');
    service.drop('widgets', 'a');
    await service.sweepHost(LOCAL_HOST_REF);

    expect(fake.executeRemoval).toHaveBeenCalledTimes(1);
  });

  it('forget-host mid-sweep is benign: rows vanish under an in-flight removal', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fake = createFakeKind({ onRemoval: () => gate, outcome: 'failed' });
    fake.seed('a');
    fake.seed('b');
    const onError = vi.fn();
    const service = createService({ onError });
    service.registerKind(fake.kind);

    const sweep = service.sweepHost(LOCAL_HOST_REF);
    fake.forgetAll();
    release?.();
    await sweep;

    expect(onError).not.toHaveBeenCalled();
    // The vanished items never resurrect: nothing left to sweep.
    fake.executeRemoval.mockClear();
    await service.sweepHost(LOCAL_HOST_REF);
    expect(fake.executeRemoval).not.toHaveBeenCalled();
  });

  it('a kind that throws reports the error and never breaks the sweep', async () => {
    const broken: ReconcileSweepKind = {
      kind: 'broken',
      readTombstones: async () => {
        throw new Error('store exploded');
      },
      executeRemoval: async () => 'ok',
      confirmGone: async () => false,
    };
    const fake = createFakeKind();
    fake.seed('a');
    const onError = vi.fn();
    const service = createService({ onError });
    service.registerKind(broken);
    service.registerKind(fake.kind);

    await service.sweepHost(LOCAL_HOST_REF);

    expect(onError).toHaveBeenCalled();
    expect(fake.executeRemoval).toHaveBeenCalledTimes(1);
  });

  it('kinds sweep in registration order — the fixed-order churn heuristic', async () => {
    const order: string[] = [];
    const first = createFakeKind({
      kind: 'worktrees',
      onRemoval: () => void order.push('worktrees'),
    });
    const second = createFakeKind({
      kind: 'conversations',
      onRemoval: () => void order.push('conversations'),
    });
    first.seed('a');
    second.seed('b');
    const service = createService();
    service.registerKind(first.kind);
    service.registerKind(second.kind);

    await service.sweepHost(LOCAL_HOST_REF);

    expect(order).toEqual(['worktrees', 'conversations']);
  });

  it('the backstop sweeps attached hosts only', async () => {
    const fake = createFakeKind();
    fake.seed('a');
    const service = createService();
    service.registerKind(fake.kind);

    await service.sweepAll();
    expect(fake.executeRemoval).not.toHaveBeenCalled();

    service.attachHost(LOCAL_HOST_REF);
    await vi.waitFor(() => expect(fake.executeRemoval).toHaveBeenCalledTimes(1));
    service.detachHost(LOCAL_HOST_REF);
    await service.sweepAll();
    expect(fake.executeRemoval).toHaveBeenCalledTimes(1);
  });
});
