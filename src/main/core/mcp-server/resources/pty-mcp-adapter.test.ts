/**
 * Unit tests for `PtyMcpAdapter`.
 *
 * Covers:
 *  - `snapshot()` returns the ring buffer without registering an IPC consumer
 *    (i.e. doesn't touch `activeConsumers`).
 *  - `subscribeForResource()` returns an unsubscribe whose call leaves the
 *    registry's listener set empty.
 *  - Multiple subscribers receive independent deltas and unsubscribing one
 *    doesn't disturb the other.
 *
 * `@main/lib/events` is stubbed out because `pty-session-registry` imports
 * it eagerly, and the real module pulls in `electron` → `@main/db/...`
 * (which calls `app.getPath()` at import — fatal outside Electron). The stub
 * exposes the same `emit` / `on` shape the registry uses; we don't care
 * about the IPC fan-out in these adapter tests.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Pty } from '@main/core/pty/pty';
import { PtySessionRegistry } from '@main/core/pty/pty-session-registry';
import { PtyMcpAdapter } from './pty-mcp-adapter';

vi.mock('@main/lib/events', () => ({
  events: {
    emit: vi.fn(),
    on: vi.fn(() => () => undefined),
  },
}));

// Minimal fake Pty — we only need onData / onExit hooks so the registry can
// install its data pipeline. `write`/`resize`/`kill` are no-ops.
function makeFakePty(): { pty: Pty; emit: (chunk: string) => void; exit: () => void } {
  let dataHandler: ((d: string) => void) | undefined;
  let exitHandler: ((info: { exitCode?: number }) => void) | undefined;
  const pty: Pty = {
    write: () => undefined,
    resize: () => undefined,
    kill: () => undefined,
    onData: (h) => {
      dataHandler = h;
    },
    onExit: (h) => {
      exitHandler = h;
    },
    getPid: () => 1234,
  };
  return {
    pty,
    emit: (chunk: string) => dataHandler?.(chunk),
    exit: () => exitHandler?.({ exitCode: 0 }),
  };
}

describe('PtyMcpAdapter', () => {
  describe('snapshot', () => {
    it('returns the ring-buffer contents without affecting active consumers', () => {
      const registry = new PtySessionRegistry();
      const { pty, emit } = makeFakePty();
      registry.register('sess-1', pty);
      emit('hello ');
      emit('world');

      const adapter = new PtyMcpAdapter(registry);
      // Drive snapshot a handful of times; even after many reads the
      // renderer-facing consumer set must stay empty (the subscribe() leak
      // T4 flagged would manifest here).
      for (let i = 0; i < 5; i++) {
        const snap = adapter.snapshot('sess-1');
        expect(snap.data).toBe('hello world');
        expect(snap.cursor).toBe('hello world'.length);
        expect(snap.eof).toBe(false);
      }

      // `activeConsumers` is private — assert via internals cast. The
      // important invariant: never grew past 0 from snapshot calls.
      const internals = registry as unknown as { activeConsumers: Set<string> };
      expect(internals.activeConsumers.size).toBe(0);
    });

    it('returns eof=true when the session has no live PTY', () => {
      const registry = new PtySessionRegistry();
      const adapter = new PtyMcpAdapter(registry);
      const snap = adapter.snapshot('unknown');
      expect(snap.data).toBe('');
      expect(snap.eof).toBe(true);
    });

    it('returns the latest buffer slice when emissions exceed individual reads', () => {
      const registry = new PtySessionRegistry();
      const { pty, emit } = makeFakePty();
      registry.register('sess-1', pty);
      const adapter = new PtyMcpAdapter(registry);

      emit('AAA');
      expect(adapter.snapshot('sess-1').data).toBe('AAA');
      emit('BBB');
      expect(adapter.snapshot('sess-1').data).toBe('AAABBB');
    });
  });

  describe('subscribeForResource', () => {
    it('delivers live deltas to the listener and stops after unsubscribe', () => {
      const registry = new PtySessionRegistry();
      const { pty, emit } = makeFakePty();
      registry.register('sess-1', pty);
      const adapter = new PtyMcpAdapter(registry);

      const received: string[] = [];
      const off = adapter.subscribeForResource('sess-1', (d) => received.push(d.data));

      emit('one');
      emit('two');
      off();
      emit('three');

      expect(received).toEqual(['one', 'two']);

      // After unsubscribe the registry's data-listener bucket should be
      // gone (size drops to zero → entry removed).
      const internals = registry as unknown as {
        dataListeners: Map<string, Set<unknown>>;
        activeConsumers: Set<string>;
      };
      expect(internals.dataListeners.has('sess-1')).toBe(false);
      // And subscriptions must never have leaked into activeConsumers.
      expect(internals.activeConsumers.size).toBe(0);
    });

    it('supports multiple independent subscribers', () => {
      const registry = new PtySessionRegistry();
      const { pty, emit } = makeFakePty();
      registry.register('sess-1', pty);
      const adapter = new PtyMcpAdapter(registry);

      const a: string[] = [];
      const b: string[] = [];
      const offA = adapter.subscribeForResource('sess-1', (d) => a.push(d.data));
      const offB = adapter.subscribeForResource('sess-1', (d) => b.push(d.data));

      emit('x');
      offA();
      emit('y');
      offB();
      emit('z');

      expect(a).toEqual(['x']);
      expect(b).toEqual(['x', 'y']);

      const internals = registry as unknown as { dataListeners: Map<string, Set<unknown>> };
      expect(internals.dataListeners.has('sess-1')).toBe(false);
    });

    it('does not deliver the historical buffer to late subscribers', () => {
      const registry = new PtySessionRegistry();
      const { pty, emit } = makeFakePty();
      registry.register('sess-1', pty);
      const adapter = new PtyMcpAdapter(registry);

      emit('earlier');
      const got: string[] = [];
      const off = adapter.subscribeForResource('sess-1', (d) => got.push(d.data));
      emit('later');
      off();

      // Subscribe is delta-only by contract — backfill is the caller's job
      // (read snapshot first if you want history).
      expect(got).toEqual(['later']);
    });
  });
});
