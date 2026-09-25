/**
 * Node-level unit tests for the scroll-projection module (improvement-plan M1,
 * D7). Drives the state machine through its dependency port with a fake host —
 * no DOM, no Solid. These tests pin the CURRENT behavior contract as extracted
 * from ChatRoot; the M1 behavior tickets (single writer, same-frame
 * compensation, derived invalidation, mode-aware prepend) evolve them.
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
  extraContent: number;
  stickToBottom: boolean;
  mounted: boolean;
  now: number;
  anchor: ScrollMode;
  scrollTop: number | undefined;
  scrollWrites: number[];
  canvasWrites: number[];
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
    extraContent: 0,
    stickToBottom: opts.stickToBottom ?? true,
    mounted: true,
    now: 1_000,
    anchor: opts.anchor ?? { kind: 'tail' },
    scrollTop: undefined,
    scrollWrites: [],
    canvasWrites: [],
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
  const contentH = () => totalHeight() + h.padTop + h.extraContent;

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
    },
    setScrollTop: (px) => {
      h.scrollTop = px;
      h.scrollWrites.push(px);
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

describe('observeScroll', () => {
  it('classifies a self-write echo as idle and leaves intent alone', () => {
    const h = makeHarness({ anchor: { kind: 'anchor', itemId: 'b', edge: 'top', offset: 4 } });
    const s = createScrollProjection(h.deps);
    s.writeScrollTop(300);
    const obs = s.observeScroll(300.4); // sub-pixel divergence
    expect(obs.kind).toBe('idle');
    expect(h.anchor).toEqual({ kind: 'anchor', itemId: 'b', edge: 'top', offset: 4 });
  });

  it('user scroll near the bottom re-derives tail intent and reports atBottom', () => {
    const h = makeHarness({ anchor: { kind: 'anchor', itemId: 'a', edge: 'top', offset: 0 } });
    const s = createScrollProjection(h.deps);
    const st = h.deps.maxScrollTop() - STICK_THRESHOLD_PX + 1;
    const obs = s.observeScroll(st);
    expect(obs).toEqual({ kind: 'user', userDelta: st, atBottom: true });
    expect(h.anchor).toEqual({ kind: 'tail' });
  });

  it('user scroll mid-list re-derives a top-edge anchor with the exact offset', () => {
    const h = makeHarness();
    const s = createScrollProjection(h.deps);
    const obs = s.observeScroll(150); // 150-32=118 → inside unit b (top 100)
    expect(obs.kind).toBe('user');
    expect(h.anchor).toEqual({
      kind: 'anchor',
      itemId: 'b',
      edge: 'top',
      offset: 150 - (100 + 32),
    });
  });

  it('classifies tween-frame echoes as idle (expectedScrollTop stays in sync)', () => {
    const h = makeHarness();
    const s = createScrollProjection(h.deps);
    s.scrollToBottom({ behavior: 'smooth' });
    h.now += 100;
    s.advanceTween();
    const written = h.scrollWrites[h.scrollWrites.length - 1]!;
    expect(s.observeScroll(written).kind).toBe('idle');
    expect(h.anchor).toEqual({ kind: 'tail' }); // intent untouched by echoes
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
      if (!s.advanceTween() && positions.length > 0) break;
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
    expect(s.advanceTween()).toBe(false);
  });

  it('a user scroll mid-tween cancels the tween', () => {
    const h = makeHarness();
    const s = createScrollProjection(h.deps);
    h.now = 5_000;
    s.scrollToBottom({ behavior: 'smooth' });
    h.now += 32;
    s.advanceTween();
    // User wheels away mid-animation.
    const obs = s.observeScroll(50);
    expect(obs.kind).toBe('user');
    const writesBefore = h.scrollWrites.length;
    expect(s.advanceTween()).toBe(false);
    expect(h.scrollWrites.length).toBe(writesBefore);
  });

  it('defers projection while a tween is active and projects after it ends', () => {
    const h = makeHarness();
    const s = createScrollProjection(h.deps);
    h.now = 5_000;
    s.scrollToBottom({ behavior: 'smooth' });
    s.invalidate();
    h.now += 16;
    s.advanceTween();
    const before = h.frameRequests;
    expect(s.projectIfNeeded()).toBe(false); // tween owns the position
    expect(h.frameRequests).toBe(before + 1);

    // Finish the tween, then projection runs (tail: already at max → nop write
    // is fine; the projection itself must fire).
    h.now += 10_000;
    s.advanceTween();
    expect(s.projectIfNeeded()).toBe(true);
  });
});

describe('projectIfNeeded (settle window)', () => {
  it('does nothing when not invalidated', () => {
    const h = makeHarness();
    const s = createScrollProjection(h.deps);
    expect(s.projectIfNeeded()).toBe(false);
    expect(h.scrollWrites).toEqual([]);
  });

  it('projects immediately when no gesture happened', () => {
    const h = makeHarness();
    const s = createScrollProjection(h.deps);
    s.invalidate();
    expect(s.projectIfNeeded()).toBe(true);
    expect(h.scrollWrites).toEqual([632]); // tail projection
  });

  it('suppresses projection inside the settle window and re-arms the scheduler', () => {
    const h = makeHarness();
    const s = createScrollProjection(h.deps);
    h.now = 10_000;
    s.observeScroll(150); // user scroll at t=10000
    s.invalidate();
    h.now = 10_000 + SCROLL_SETTLE_MS - 20;
    const before = h.frameRequests;
    expect(s.projectIfNeeded()).toBe(false);
    expect(h.frameRequests).toBe(before + 1); // keeps the loop alive
    expect(h.scrollWrites).toEqual([]);

    // A row above the anchor settles from estimate to exact (+50px) while the
    // window is still open — the correction lands only after the window closes.
    h.units[0]!.size = 150;
    h.now = 10_000 + SCROLL_SETTLE_MS + 1;
    expect(s.projectIfNeeded()).toBe(true);
    // Anchor b (offset 18) now sits 50px lower: 150 + 32 + 18 = 200.
    expect(h.scrollWrites).toEqual([200]);
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

describe('prepend compensation', () => {
  it('captures the top-edge anchor and restores it after units shift', () => {
    const h = makeHarness();
    const s = createScrollProjection(h.deps);
    const st = 150; // inside unit b at offset 18
    const cap = s.capturePrependAnchor(st);
    expect(cap).toEqual({ anchorId: 'b', anchorOffset: 150 - (100 + 32) });

    // Simulate a prepend of 500px worth of older rows.
    h.units.unshift({ id: 'old-2', size: 300 }, { id: 'old-1', size: 200 });
    s.compensatePrepend(cap.anchorId!, cap.anchorOffset);
    // b's top is now 600 → 600 + 32 + 18 = 650
    expect(h.scrollWrites).toEqual([650]);
  });
});
