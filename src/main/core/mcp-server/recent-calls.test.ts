import { describe, expect, it, vi } from 'vitest';
import type { RecentCallEntry } from '@shared/events/mcpServerEvents';
import { RECENT_CALLS_CAPACITY, RecentCallsRing } from './recent-calls';

// Replace the main-process event bus with a stub so importing the ring's
// `recent-calls` module doesn't transitively load Electron / DB modules.
vi.mock('@main/lib/events', () => ({
  events: { emit: vi.fn(), on: vi.fn(), once: vi.fn() },
}));

/**
 * Unit tests for the in-memory recent-calls ring buffer. The singleton in
 * `recent-calls.ts` shares behaviour with this class — we exercise the class
 * directly so tests stay hermetic (no global emitter, no leaked state).
 */
describe('RecentCallsRing', () => {
  function makeRing(capacity?: number) {
    const emitter = { emit: vi.fn<(data: RecentCallEntry) => void>() };
    const ring = new RecentCallsRing(capacity, emitter);
    return { ring, emitter };
  }

  describe('record', () => {
    it('assigns id and ts on every entry', () => {
      const { ring } = makeRing();
      const before = Date.now();
      const entry = ring.record({ tool: 'task.create', status: 'ok', ms: 12 });
      const after = Date.now();
      expect(entry.id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(entry.ts).toBeGreaterThanOrEqual(before);
      expect(entry.ts).toBeLessThanOrEqual(after);
      expect(entry.tool).toBe('task.create');
      expect(entry.status).toBe('ok');
      expect(entry.ms).toBe(12);
    });

    it('emits the entry on the recent-call channel', () => {
      const { ring, emitter } = makeRing();
      const entry = ring.record({ tool: 'task.list', status: 'ok', ms: 4 });
      expect(emitter.emit).toHaveBeenCalledTimes(1);
      expect(emitter.emit).toHaveBeenCalledWith(entry);
    });

    it('returns the stored entry shape (id + ts + caller fields)', () => {
      const { ring } = makeRing();
      const entry = ring.record({
        tool: 'task.delete',
        status: 'error',
        ms: 7,
        errorCode: 'CONFIRM_REQUIRED',
        errorMessage: 'Set confirm: true to delete this task',
      });
      expect(entry.errorCode).toBe('CONFIRM_REQUIRED');
      expect(entry.errorMessage).toBe('Set confirm: true to delete this task');
    });
  });

  describe('snapshot', () => {
    it('returns entries most-recent first', () => {
      const { ring } = makeRing();
      ring.record({ tool: 'a', status: 'ok', ms: 1 });
      ring.record({ tool: 'b', status: 'ok', ms: 2 });
      ring.record({ tool: 'c', status: 'ok', ms: 3 });
      const snap = ring.snapshot();
      expect(snap.map((e) => e.tool)).toEqual(['c', 'b', 'a']);
    });

    it('wraps around at capacity, evicting the oldest entries', () => {
      const { ring } = makeRing(3);
      ring.record({ tool: 'a', status: 'ok', ms: 1 });
      ring.record({ tool: 'b', status: 'ok', ms: 1 });
      ring.record({ tool: 'c', status: 'ok', ms: 1 });
      ring.record({ tool: 'd', status: 'ok', ms: 1 });
      ring.record({ tool: 'e', status: 'ok', ms: 1 });
      const snap = ring.snapshot();
      expect(snap.map((e) => e.tool)).toEqual(['e', 'd', 'c']);
      expect(ring.size()).toBe(3);
    });

    it('saturates size() at the default capacity (200)', () => {
      const { ring } = makeRing();
      for (let i = 0; i < RECENT_CALLS_CAPACITY + 50; i += 1) {
        ring.record({ tool: `t${i}`, status: 'ok', ms: 0 });
      }
      expect(ring.size()).toBe(RECENT_CALLS_CAPACITY);
      const snap = ring.snapshot();
      expect(snap).toHaveLength(RECENT_CALLS_CAPACITY);
      // Most recent should be the very last write.
      expect(snap[0]?.tool).toBe(`t${RECENT_CALLS_CAPACITY + 49}`);
      // Oldest surviving entry should be at the eviction boundary.
      expect(snap[snap.length - 1]?.tool).toBe(`t${50}`);
    });

    it('respects the limit filter', () => {
      const { ring } = makeRing();
      ring.record({ tool: 'a', status: 'ok', ms: 0 });
      ring.record({ tool: 'b', status: 'ok', ms: 0 });
      ring.record({ tool: 'c', status: 'ok', ms: 0 });
      expect(ring.snapshot({ limit: 2 }).map((e) => e.tool)).toEqual(['c', 'b']);
    });

    it('filters by status', () => {
      const { ring } = makeRing();
      ring.record({ tool: 'a', status: 'ok', ms: 0 });
      ring.record({ tool: 'b', status: 'error', ms: 0, errorCode: 'X' });
      ring.record({ tool: 'c', status: 'ok', ms: 0 });
      expect(ring.snapshot({ status: 'error' }).map((e) => e.tool)).toEqual(['b']);
      expect(ring.snapshot({ status: 'ok' }).map((e) => e.tool)).toEqual(['c', 'a']);
    });

    it('filters by sinceTs (strict greater-than)', async () => {
      const { ring } = makeRing();
      const a = ring.record({ tool: 'a', status: 'ok', ms: 0 });
      // Force a different ts on subsequent entries.
      await new Promise((r) => setTimeout(r, 5));
      const b = ring.record({ tool: 'b', status: 'ok', ms: 0 });
      await new Promise((r) => setTimeout(r, 5));
      const c = ring.record({ tool: 'c', status: 'ok', ms: 0 });
      expect(b.ts).toBeGreaterThan(a.ts);
      expect(c.ts).toBeGreaterThan(b.ts);
      const sinceA = ring.snapshot({ sinceTs: a.ts });
      expect(sinceA.map((e) => e.tool)).toEqual(['c', 'b']);
      const sinceC = ring.snapshot({ sinceTs: c.ts });
      expect(sinceC).toEqual([]);
    });

    it('combines limit + filters', () => {
      const { ring } = makeRing();
      for (let i = 0; i < 5; i += 1) {
        ring.record({ tool: `t${i}`, status: i % 2 === 0 ? 'ok' : 'error', ms: 0 });
      }
      // Most-recent-first: t4(ok), t3(error), t2(ok), t1(error), t0(ok)
      const errs = ring.snapshot({ status: 'error', limit: 1 });
      expect(errs.map((e) => e.tool)).toEqual(['t3']);
    });
  });

  describe('clear', () => {
    it('drops every entry and resets size to 0', () => {
      const { ring } = makeRing();
      ring.record({ tool: 'a', status: 'ok', ms: 0 });
      ring.record({ tool: 'b', status: 'ok', ms: 0 });
      ring.clear();
      expect(ring.size()).toBe(0);
      expect(ring.snapshot()).toEqual([]);
    });

    it('lets the buffer be reused after clearing', () => {
      const { ring } = makeRing();
      ring.record({ tool: 'a', status: 'ok', ms: 0 });
      ring.clear();
      ring.record({ tool: 'z', status: 'ok', ms: 0 });
      expect(ring.snapshot().map((e) => e.tool)).toEqual(['z']);
    });
  });

  describe('constructor', () => {
    it('rejects non-positive capacity', () => {
      expect(() => new RecentCallsRing(0)).toThrow(/positive integer/);
      expect(() => new RecentCallsRing(-1)).toThrow(/positive integer/);
      expect(() => new RecentCallsRing(1.5)).toThrow(/positive integer/);
    });
  });
});
