/**
 * Browser render performance tests — informational, NOT CI gates.
 *
 * These tests run in the `perf` Vitest browser project and are excluded from
 * `pnpm test`.  Run them with `pnpm --filter @emdash/chat-ui run test:perf`.
 *
 * All timings and heap numbers are logged via console.table so they can be
 * compared across runs.  Assertions use loose ceilings to catch regressions
 * only if something is dramatically wrong; they are not intended as strict
 * performance contracts.
 *
 * Test suite overview:
 *   1. Initial paint      — mountRows(200 items), measure first-paint latency.
 *   2. Update / render    — toggle collapse on collapsible rows, measure
 *                           update-to-paint time; then append more items.
 *   3. Memory             — heap before, after mount, and after dispose; assert
 *                           retained memory after dispose is within a ceiling.
 *                           Skipped when performance.memory is unavailable.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createViewState } from '../../state/view-state';
import { generateMockTranscript } from '../../mock-transcript';
import { now, nextPaint, heapUsed, gcHint, record, mountTranscript } from './harness';

// ── Transcript fixture ────────────────────────────────────────────────────────

let ITEMS_200: ReturnType<typeof generateMockTranscript>;

beforeAll(() => {
  ITEMS_200 = generateMockTranscript(200, 1);
});

// ── 1. Initial paint ──────────────────────────────────────────────────────────

describe('initial paint', () => {
  it('renders 200 rows in under 2500 ms', { timeout: 10000 }, async () => {
    const t0 = now();
    const { dispose } = mountTranscript(ITEMS_200);
    await nextPaint();
    const elapsed = now() - t0;

    record({ label: 'initial-paint-200', 'elapsed-ms': Math.round(elapsed) });

    dispose();
    expect(elapsed).toBeLessThan(2500);
  });
});

// ── 2. Update / render ────────────────────────────────────────────────────────

describe('update render', () => {
  it('toggles collapse state and paints in under 500 ms', { timeout: 10000 }, async () => {
    const viewState = createViewState();
    const collapsibleItems = ITEMS_200.filter(
      (i) => i.kind === 'thinking' || i.kind === 'file-op'
    ).slice(0, 20);

    const { dispose } = mountTranscript(ITEMS_200);
    await nextPaint();

    const t0 = now();
    for (const item of collapsibleItems) {
      viewState.toggleCollapsed(item.id);
    }
    await nextPaint();
    const elapsed = now() - t0;

    record({ label: 'collapse-toggle-20', 'elapsed-ms': Math.round(elapsed) });

    dispose();
    expect(elapsed).toBeLessThan(500);
  });

  it('appends 100 additional rows and paints in under 1500 ms', { timeout: 10000 }, async () => {
    const transcript = generateMockTranscript(100, 3);
    const extra = generateMockTranscript(100, 4);

    const { dispose } = mountTranscript(transcript);
    await nextPaint();

    const t0 = now();
    const { dispose: d2 } = mountTranscript([...transcript, ...extra]);
    await nextPaint();
    const elapsed = now() - t0;

    record({ label: 'append-100', 'elapsed-ms': Math.round(elapsed) });

    dispose();
    d2();
    expect(elapsed).toBeLessThan(1500);
  });
});

// ── 3. Memory ─────────────────────────────────────────────────────────────────

describe('memory', () => {
  it('heap retained after dispose is below 50 MB ceiling', { timeout: 15000 }, async () => {
    const baseline = heapUsed();
    if (baseline === undefined) {
      vi.waitFor(() => true); // noop — performance.memory not available
      console.warn('[perf] performance.memory unavailable — skipping memory assertions');
      return;
    }

    await gcHint();
    const before = heapUsed() ?? 0;

    const { dispose } = mountTranscript(ITEMS_200);
    await nextPaint();
    const afterMount = heapUsed() ?? 0;

    dispose();
    await gcHint();
    // Give GC a moment to run by double-rAF again.
    await nextPaint();
    const afterDispose = heapUsed() ?? 0;

    const mountDelta = afterMount - before;
    const retainedDelta = afterDispose - before;
    const CEILING_MB = 50 * 1024 * 1024; // 50 MB

    record({
      label: 'heap-200-items',
      'before-mb': +(before / 1e6).toFixed(2),
      'after-mount-mb': +(afterMount / 1e6).toFixed(2),
      'after-dispose-mb': +(afterDispose / 1e6).toFixed(2),
      'mount-delta-mb': +(mountDelta / 1e6).toFixed(2),
      'retained-delta-mb': +(retainedDelta / 1e6).toFixed(2),
    });

    expect(retainedDelta).toBeLessThan(CEILING_MB);
  });
});
