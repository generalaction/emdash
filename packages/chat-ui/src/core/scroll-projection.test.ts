/**
 * Node-level unit tests for the scroll-projection module (improvement-plan M1,
 * D7). Drives the state machine through its dependency port with a fake host —
 * no DOM, no Solid.
 *
 * Behavior contract under test:
 *   - one clamped scrollTop writer; smooth scrolls are scheduler tweens
 *   - same-frame height compensation for rows above the viewport (ticket 05)
 *   - intent re-derivation deferred to the settle window (ticket 05)
 *   - projection coalesced, deferred while a tween runs or intent is dirty
 */

import type { ScrollMode } from '@state/chat-state';
import { describe, expect, it } from 'vitest';
import {
  SCROLL_SETTLE_MS,
  STICK_THRESHOLD_PX,
  createScrollProjection,
  type ScrollProjectionDeps,
} from './scroll-projection';

type Unit = { id: string; size: number };

type Harness = {
  units: Unit[];
  padTop: number;
  viewHeight: number;
  stickToBottom: boolean;
  mounted: boolean;
  now: number;
  anchor: ScrollMode;
  scrollTop: number | undefined;
  scrollWrites: number[];
  canvasWrites: number[];
  /** Interleaved effect log for ordering assertions. */
  ops: Array<['canvas' | 'scroll', number]>;
  frameRequests: number;
  rafQueue: Array<() => void>;
  deps: ScrollProjectionDeps;
};

function makeHarness(
  opts: {
    units?: Unit[];
    padTop?: number;
    viewHeight?: number;
    stickToBottom?: boolean;
    anchor?: ScrollMode;
  } = {}
): Harness {
  const h: Harness = {
    units: opts.units ?? [
      { id: 'a', size: 100 },
      { id: 'b', size: 200 },
      { id: 'c', size: 300 },
      { id: 'd', size: 400 },
    ],
    padTop: opts.padTop ?? 32,
    viewHeight: opts.viewHeight ?? 400,
    stickToBottom: opts.stickToBottom ?? true,
    mounted: true,
    now: 1_000,
    anchor: opts.anchor ?? { kind: 'tail' },
    scrollTop: undefined,
    scrollWrites: [],
    canvasWrites: [],
    ops: [],
    frameRequests: 0,
    rafQueue: [],
    deps: undefined as unknown as ScrollProjectionDeps,
  };

  const topOf = (index: number): number => {
    let top = 0;
    for (let i = 0; i < index; i++) top += h.units[i]?.size ?? 0;
    return top;
  };
  const totalHeight = () => topOf(h.units.length);
  // Mirrors ChatRoot: contentH = total + padTop + padBottom(0 here) + reserve.
  const contentH = () => totalHeight() + h.padTop;

  h.deps = {
    mounted: () => h.mounted,
    padTop: () => h.padTop,
    viewHeight: () => h.viewHeight,
    clientHeight: () => h.viewHeight,
    maxScrollTop: () => Math.max(0, contentH() - h.viewHeight),
    contentH,
    unitCount: () => h.units.length,
    unitIdAt: (i) => h.units[i]?.id,
    unitIndexOf: (id) => h.units.findIndex((u) => u.id === id),
    findIndexAt: (y) => {
      let acc = 0;
      for (let i = 0; i < h.units.length; i++) {
        acc += h.units[i]!.size;
        if (y < acc) return i;
      }
      return Math.max(0, h.units.length - 1);
    },
    topOf,
    sizeOf: (i) => h.units[i]?.size ?? 0,
    getAnchor: () => h.anchor,
    setAnchor: (mode) => {
      h.anchor = mode;
    },
    stickToBottom: () => h.stickToBottom,
    setCanvasHeight: (px) => {
      h.canvasWrites.push(px);
      h.ops.push(['canvas', px]);
    },
    setScrollTop: (px) => {
      h.scrollTop = px;
      h.scrollWrites.push(px);
      h.ops.push(['scroll', px]);
    },
    requestFrame: () => {
      h.frameRequests++;
    },
    raf: (fn) => {
      h.rafQueue.push(fn);
    },
    now: () => h.now,
  };

  return h;
}

const settle = (h: Harness) => {
  h.now += SCROLL_SETTLE_MS + 1;
};

describe('writeScrollTop', () => {
  it('clamps into [0, maxScrollTop] and arms the scheduler', () => {
    const h = makeHarness();
    const s = createScrollProjection(h.deps);
    // total 1000 + padTop 32 - view 400 = 632
    s.writeScrollTop(5000);
    expect(h.scrollWrites).toEqual([632]);
    s.writeScrollTop(-50);
    expect(h.scrollWrites).toEqual([632, 0]);
    expect(h.frameRequests).toBe(2);
  });

  it('is a no-op before mount', () => {
    const h = makeHarness();
    h.mounted = false;
    const s = createScrollProjection(h.deps);
    s.writeScrollTop(100);
    expect(h.scrollWrites).toEqual([]);
  });
});

describe('project', () => {
  it('tail intent flushes canvas height then pins to maxScrollTop', () => {
    const h = makeHarness();
    const s = createScrollProjection(h.deps);
    s.project({ kind: 'tail' });
    expect(h.canvasWrites).toEqual([1032]);
    expect(h.scrollWrites).toEqual([632]);
  });

  it('tail intent respects stickToBottom=false (canvas still flushed)', () => {
    const h = makeHarness({ stickToBottom: false });
    const s = createScrollProjection(h.deps);
    s.project({ kind: 'tail' });
    expect(h.canvasWrites).toEqual([1032]);
    expect(h.scrollWrites).toEqual([]);
  });

  it('top-edge anchor: scrollTop = unitTop + padTop + offset', () => {
    const h = makeHarness();
    const s = createScrollProjection(h.deps);
    s.project({ kind: 'anchor', itemId: 'c', edge: 'top', offset: 10 });
    // top(c)=300, +32 padTop +10 offset = 342
    expect(h.scrollWrites).toEqual([342]);
  });

  it('bottom-edge anchor: scrollTop = unitTop + size - viewHeight + offset', () => {
    const h = makeHarness();
    const s = createScrollProjection(h.deps);
    s.project({ kind: 'anchor', itemId: 'c', edge: 'bottom', offset: 0 });
    // 300+32+300-400 = 232
    expect(h.scrollWrites).toEqual([232]);
  });

  it('sub-pixel guard: skips the write when the correction is < 1px', () => {
    const h = makeHarness();
    const s = createScrollProjection(h.deps);
    s.project({ kind: 'anchor', itemId: 'c', edge: 'top', offset: 10 });
    expect(h.scrollWrites).toEqual([342]);
    s.project({ kind: 'anchor', itemId: 'c', edge: 'top', offset: 10.5 });
    expect(h.scrollWrites).toEqual([342]); // 342.5 vs expected 342 → skipped
  });

  it('anchor item missing falls back to tail', () => {
    const h = makeHarness();
    const s = createScrollProjection(h.deps);
    s.project({ kind: 'anchor', itemId: 'nope', edge: 'top', offset: 0 });
    expect(h.scrollWrites).toEqual([632]);
  });
});

describe('observeScroll + deferred intent re-derivation', () => {
  it('classifies a self-write echo as idle and leaves intent alone', () => {
    const h = makeHarness({ anchor: { kind: 'anchor', itemId: 'b', edge: 'top', offset: 4 } });
    const s = createScrollProjection(h.deps);
    s.writeScrollTop(300);
    const obs = s.observeScroll(300.4); // sub-pixel divergence
    expect(obs.kind).toBe('idle');
    expect(h.anchor).toEqual({ kind: 'anchor', itemId: 'b', edge: 'top', offset: 4 });
  });

  it('reports atBottom on user scrolls but defers intent to the settle window', () => {
    const h = makeHarness({ anchor: { kind: 'anchor', itemId: 'a', edge: 'top', offset: 0 } });
    const s = createScrollProjection(h.deps);
    const st = h.deps.maxScrollTop() - STICK_THRESHOLD_PX + 1;
    const obs = s.observeScroll(st);
    expect(obs).toEqual({ kind: 'user', userDelta: st, atBottom: true });
    // Not yet re-derived: mid-gesture derivation is the ticket-01 drift source.
    expect(h.anchor).toEqual({ kind: 'anchor', itemId: 'a', edge: 'top', offset: 0 });

    // Unsettled write phase keeps the loop alive and does not derive.
    const before = h.frameRequests;
    s.runWritePhase();
    expect(h.frameRequests).toBe(before + 1);
    expect(h.anchor.kind).toBe('anchor');

    settle(h);
    s.runWritePhase();
    expect(h.anchor).toEqual({ kind: 'tail' });
  });

  it('derives a top-edge anchor with the exact offset once settled', () => {
    const h = makeHarness();
    const s = createScrollProjection(h.deps);
    s.observeScroll(150); // 150-32=118 → inside unit b (top 100)
    settle(h);
    s.runWritePhase();
    expect(h.anchor).toEqual({
      kind: 'anchor',
      itemId: 'b',
      edge: 'top',
      offset: 150 - (100 + 32),
    });
  });

  it('an explicit command supersedes a pending gesture derivation', () => {
    const h = makeHarness();
    const s = createScrollProjection(h.deps);
    s.observeScroll(150); // gesture → intent dirty
    s.scrollToBottom(); // explicit intent
    expect(h.anchor).toEqual({ kind: 'tail' });
    settle(h);
    s.runWritePhase();
    // The settled derivation must NOT overwrite the explicit tail intent.
    expect(h.anchor).toEqual({ kind: 'tail' });
  });

  it('flushIntent derives immediately (dispose path)', () => {
    const h = makeHarness({ anchor: { kind: 'tail' } });
    const s = createScrollProjection(h.deps);
    s.observeScroll(150);
    s.flushIntent(); // still inside the settle window
    expect(h.anchor).toEqual({
      kind: 'anchor',
      itemId: 'b',
      edge: 'top',
      offset: 18,
    });
  });
});

describe('same-frame height compensation (ticket 05)', () => {
  it('applies estimate→exact deltas above the viewport in the same write phase, mid-gesture', () => {
    const h = makeHarness();
    const s = createScrollProjection(h.deps);
    h.now = 10_000;
    s.observeScroll(400); // active gesture; viewport top inside unit c
    // Row a (index 0, above viewport) settles +80.
    h.units[0]!.size = 180;
    s.compensateHeightChange(0, 80);
    s.runWritePhase(); // still unsettled — compensation must land anyway
    expect(h.scrollWrites).toEqual([480]);
    // Canvas was flushed before the write so the browser can't clamp stale.
    expect(h.canvasWrites[h.canvasWrites.length - 1]).toBe(1112);
  });

  it('ignores height changes at or below the viewport top', () => {
    const h = makeHarness();
    const s = createScrollProjection(h.deps);
    s.observeScroll(150); // viewport top inside unit b (index 1)
    h.units[2]!.size = 500; // below viewport
    s.compensateHeightChange(2, 200);
    h.units[1]!.size = 260; // the anchor row itself
    s.compensateHeightChange(1, 60);
    s.runWritePhase();
    expect(h.scrollWrites).toEqual([]);
  });

  it('coalesces multiple deltas into one write', () => {
    const h = makeHarness();
    const s = createScrollProjection(h.deps);
    s.observeScroll(400);
    h.units[0]!.size = 150;
    s.compensateHeightChange(0, 50);
    h.units[1]!.size = 170;
    s.compensateHeightChange(1, -30);
    s.runWritePhase();
    expect(h.scrollWrites).toEqual([420]);
  });

  it('keeps content stable across a continuous gesture with settling rows (drift repro)', () => {
    // Continuous upward wheel: each step moves the viewport up while rows above
    // settle. The offset of the content the user reads must be preserved:
    // final scrollTop = sum(user positions) compensated by every above-delta.
    const h = makeHarness({
      units: Array.from({ length: 20 }, (_, i) => ({ id: `u${i}`, size: 100 })),
      viewHeight: 300,
    });
    const s = createScrollProjection(h.deps);
    h.now = 10_000;
    let st = 1_500;
    s.observeScroll(st);
    for (let step = 0; step < 5; step++) {
      st -= 120; // wheel step upward
      h.now += 30; // gesture stays inside the settle window
      s.observeScroll(st);
      // A row far above the viewport settles +40 (estimate → exact).
      const idx = step;
      h.units[idx]!.size += 40;
      s.compensateHeightChange(idx, 40);
      const wrote = s.runWritePhase();
      expect(wrote).toBe(true);
      // Compensation shifted the viewport by exactly the delta.
      expect(h.scrollTop).toBe(st + 40);
      st = h.scrollTop!;
      s.observeScroll(st); // echo of our own write → idle, no drift into intent
    }
    // After settling, the derived anchor reflects the final compensated view.
    settle(h);
    s.runWritePhase();
    expect(h.anchor.kind).toBe('anchor');
  });
});

describe('projection gating', () => {
  it('does nothing when not invalidated', () => {
    const h = makeHarness();
    const s = createScrollProjection(h.deps);
    expect(s.runWritePhase()).toBe(false);
    expect(h.scrollWrites).toEqual([]);
  });

  it('projects immediately when idle (no gesture)', () => {
    const h = makeHarness();
    const s = createScrollProjection(h.deps);
    s.invalidate();
    expect(s.runWritePhase()).toBe(true);
    expect(h.scrollWrites).toEqual([632]); // tail projection
  });

  it('defers projection while intent is dirty, projects after settle', () => {
    const h = makeHarness();
    const s = createScrollProjection(h.deps);
    h.now = 10_000;
    s.observeScroll(150);
    s.invalidate();
    expect(s.runWritePhase()).toBe(false); // dirty intent → no projection
    expect(h.scrollWrites).toEqual([]);

    // A row above settles while still unsettled → compensation, not projection.
    h.units[0]!.size = 150;
    s.compensateHeightChange(0, 50);
    s.runWritePhase();
    expect(h.scrollWrites).toEqual([200]);

    settle(h);
    s.runWritePhase(); // derives intent, then projects
    // The projection's target equals the compensated position — no extra write.
    expect(h.scrollWrites).toEqual([200]);
    expect(h.anchor).toEqual({ kind: 'anchor', itemId: 'b', edge: 'top', offset: 18 });
  });
});

describe('smooth-scroll tween', () => {
  it('animates to the target through writeScrollTop and ends exactly on it', () => {
    const h = makeHarness();
    const s = createScrollProjection(h.deps);
    h.now = 5_000;
    s.scrollToBottom({ behavior: 'smooth' });
    expect(h.scrollWrites).toEqual([]); // no write until the write phase runs

    const positions: number[] = [];
    for (let frame = 0; frame < 40; frame++) {
      h.now += 16;
      if (!s.runWritePhase() && positions.length > 0) break;
      positions.push(h.scrollWrites[h.scrollWrites.length - 1]!);
    }
    expect(positions[positions.length - 1]).toBe(632);
    // Monotonic decelerating approach — never overshoots.
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]!).toBeGreaterThanOrEqual(positions[i - 1]!);
      expect(positions[i]!).toBeLessThanOrEqual(632);
    }
  });

  it('short hops (< 1px) write immediately without a tween', () => {
    const h = makeHarness();
    const s = createScrollProjection(h.deps);
    s.writeScrollTop(632);
    s.scrollToBottom({ behavior: 'smooth' }); // already there
    expect(h.scrollWrites).toEqual([632, 632]);
    expect(s.runWritePhase()).toBe(false);
  });

  it('a user scroll mid-tween cancels the tween', () => {
    const h = makeHarness();
    const s = createScrollProjection(h.deps);
    h.now = 5_000;
    s.scrollToBottom({ behavior: 'smooth' });
    h.now += 32;
    s.runWritePhase();
    // User wheels away mid-animation.
    const obs = s.observeScroll(50);
    expect(obs.kind).toBe('user');
    const writesBefore = h.scrollWrites.length;
    settle(h);
    s.runWritePhase(); // derives intent; tween must not write anymore
    expect(h.scrollWrites.length).toBe(writesBefore);
  });

  it('folds above-viewport height deltas into an active tween', () => {
    const h = makeHarness();
    const s = createScrollProjection(h.deps);
    h.now = 5_000;
    s.writeScrollTop(500);
    s.scrollToItem('d', { behavior: 'smooth' }); // target top(d)+pad = 632 clamped
    h.now += 16;
    s.runWritePhase();
    // Row a grows +100 above everything while the tween flies.
    h.units[0]!.size = 200;
    s.compensateHeightChange(0, 100);
    // Finish the tween: it must land on the shifted target, not the stale one.
    h.now += 10_000;
    s.runWritePhase();
    const last = h.scrollWrites[h.scrollWrites.length - 1]!;
    // Stale target was 632 (clamped max before growth: 1000+32-400); shifted
    // target is 732 — also the new maxScrollTop (1100+32-400).
    expect(last).toBe(732);
  });

  it('classifies tween-frame echoes as idle', () => {
    const h = makeHarness();
    const s = createScrollProjection(h.deps);
    s.scrollToBottom({ behavior: 'smooth' });
    h.now += 100;
    s.runWritePhase();
    const written = h.scrollWrites[h.scrollWrites.length - 1]!;
    expect(s.observeScroll(written).kind).toBe('idle');
    expect(h.anchor).toEqual({ kind: 'tail' }); // intent untouched by echoes
  });
});

describe('scroll commands', () => {
  it('scrollToTop writes 0 and anchors the first unit at -padTop', () => {
    const h = makeHarness();
    const s = createScrollProjection(h.deps);
    s.scrollToTop();
    expect(h.scrollWrites).toEqual([0]);
    expect(h.anchor).toEqual({ kind: 'anchor', itemId: 'a', edge: 'top', offset: -32 });
  });

  it('scrollToBottom sets tail intent and writes maxScrollTop', () => {
    const h = makeHarness({ anchor: { kind: 'anchor', itemId: 'a', edge: 'top', offset: 0 } });
    const s = createScrollProjection(h.deps);
    s.scrollToBottom();
    expect(h.anchor).toEqual({ kind: 'tail' });
    expect(h.scrollWrites).toEqual([632]);
  });

  it('scrollToItem start-aligned writes the row top and re-checks after a frame', () => {
    const h = makeHarness();
    const s = createScrollProjection(h.deps);
    s.scrollToItem('c');
    // top(c)=300 + padTop 32 = 332
    expect(h.scrollWrites).toEqual([332]);
    expect(h.anchor).toEqual({ kind: 'anchor', itemId: 'c', edge: 'top', offset: 0 });
    // Deferred correction re-computes the target (geometry may have settled).
    h.units[1]!.size = 250; // b grows by 50 → c's top moves to 350
    h.rafQueue.shift()!();
    expect(h.scrollWrites).toEqual([332, 382]);
  });

  it('scrollToItem center-aligned centers the item block', () => {
    const h = makeHarness();
    const s = createScrollProjection(h.deps);
    s.scrollToItem('b', { align: 'center' });
    // rowTop = 100+32 = 132; target = 132 - (400-200)/2 = 32
    expect(h.scrollWrites).toEqual([32]);
  });
});

describe('prepend compensation (mode-aware, write-phase committed)', () => {
  it('anchor intent: restores the captured anchor position exactly, in the write phase', () => {
    const h = makeHarness({ anchor: { kind: 'anchor', itemId: 'b', edge: 'top', offset: 18 } });
    const s = createScrollProjection(h.deps);
    const st = 150; // inside unit b at offset 18
    const cap = s.capturePrependAnchor(st);
    expect(cap).toEqual({ anchorId: 'b', anchorOffset: 150 - (100 + 32) });

    // Simulate a prepend of 500px worth of older rows.
    h.units.unshift({ id: 'old-2', size: 300 }, { id: 'old-1', size: 200 });
    s.schedulePrependCompensation(cap);
    expect(h.scrollWrites).toEqual([]); // nothing until the write phase

    s.runWritePhase();
    // b's top is now 600 → 600 + 32 + 18 = 650
    expect(h.scrollWrites).toEqual([650]);
    // Ordered commit: canvas height (1532) lands before the scrollTop write so
    // the browser can never clamp against the stale (shorter) canvas.
    expect(h.ops).toEqual([
      ['canvas', 1532],
      ['scroll', 650],
    ]);
  });

  it('tail intent: re-pins to the bottom instead of anchor math', () => {
    const h = makeHarness({ anchor: { kind: 'tail' } });
    const s = createScrollProjection(h.deps);
    s.writeScrollTop(h.deps.maxScrollTop()); // pinned at 632
    h.ops.length = 0;
    h.scrollWrites.length = 0;

    const cap = s.capturePrependAnchor(632);
    h.units.unshift({ id: 'old-1', size: 500 });
    s.schedulePrependCompensation(cap);
    s.runWritePhase();
    // New maxScrollTop = 1500 + 32 - 400 = 1132; the pin survives the prepend.
    expect(h.scrollWrites[0]).toBe(1132);
    expect(h.ops[0]).toEqual(['canvas', 1532]);
  });
});
