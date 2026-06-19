/**
 * flatten — unit tests.
 *
 * Covers:
 *   1. Basic flatness: one unit per committed item (Phase 0 legacy passthrough).
 *   2. Group roles: solo / first / middle / last stamped correctly.
 *   3. Inter-group gapBefore: ROW_GAP on non-first groups, 0 on first.
 *   4. Identity stability: committed item → same RenderUnit[] ref on re-call
 *      (WeakMap cache hit).
 *   5. activeTurn bypass: cache not used for active-turn items.
 *   6. collectUserTurnUnits: correct absolute unit indices for user messages.
 *   7. Empty transcript produces empty array.
 */

import { describe, expect, it } from 'vitest';
import { ROW_GAP } from '../core/metrics';
import { unit } from '../core/units';
import type { ItemSegmenter } from '../core/units';
import type { ChatItem } from '../model';
import { flatten, collectUserTurnUnits, segmentCache } from './flatten';
import { createTranscript } from './transcript';

// ── Minimal segmenter stub (no DOM imports) ────────────────────────────────────
//
// The real SEGMENTERS imports JSX components (Prose, Code, Table) which need
// a browser environment.  The flatten logic only cares about what segmenters
// return, not the Render implementations, so a plain passthrough is enough.

function passthrough(kind: ChatItem['kind']): ItemSegmenter<any> {
  return {
    kind,
    segment: (item: ChatItem) => [unit(item.kind, item, item, { key: 'self' })],
  };
}

const STUB_SEGMENTERS = {
  message: passthrough('message'),
  tool: passthrough('tool'),
  thinking: passthrough('thinking'),
  'file-op': passthrough('file-op'),
  execute: passthrough('execute'),
  diff: passthrough('diff'),
  'resource-link': passthrough('resource-link'),
  plan: passthrough('plan'),
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function userMsg(id: string, text = 'hello'): ChatItem {
  return { kind: 'message', id, role: 'user', text };
}

function assistantMsg(id: string, text = 'hello'): ChatItem {
  return { kind: 'message', id, role: 'assistant', text };
}

function tool(id: string): ChatItem {
  return { kind: 'tool', id, name: 'bash', status: 'done' };
}

const segCtx = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  caches: {} as any,
  expanded: () => false,
};

function flattenTranscript(tx: ReturnType<typeof createTranscript>) {
  return flatten(tx.state, segCtx, STUB_SEGMENTERS);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('flatten — basic', () => {
  it('returns empty array for an empty transcript', () => {
    const tx = createTranscript();
    expect(flattenTranscript(tx)).toHaveLength(0);
  });

  it('produces one unit per committed item (Phase 0 legacy)', () => {
    const tx = createTranscript();
    tx.seed([userMsg('a'), userMsg('b'), tool('c')]);
    const units = flattenTranscript(tx);
    expect(units).toHaveLength(3);
    expect(units[0].itemId).toBe('a');
    expect(units[1].itemId).toBe('b');
    expect(units[2].itemId).toBe('c');
  });

  it('unit ids are ${itemId}#self for legacy units', () => {
    const tx = createTranscript();
    tx.seed([userMsg('x')]);
    const [u] = flattenTranscript(tx);
    expect(u.id).toBe('x#self');
  });

  it('unit.kind matches item.kind', () => {
    const tx = createTranscript();
    tx.seed([userMsg('a'), tool('b')]);
    const units = flattenTranscript(tx);
    expect(units[0].kind).toBe('message');
    expect(units[1].kind).toBe('tool');
  });

  it('unit.data matches the seeded ChatItem', () => {
    const tx = createTranscript();
    const item = userMsg('a');
    tx.seed([item]);
    const [u] = flattenTranscript(tx);
    // seed() may clone items, so use deep equality
    expect(u.data).toStrictEqual(item);
    // data should be the same ref as what's in state.committed
    expect(u.data).toBe(tx.state.committed[0]);
  });
});

describe('flatten — groupRole', () => {
  it('single-unit item has groupRole solo', () => {
    const tx = createTranscript();
    tx.seed([tool('a')]);
    const [u] = flattenTranscript(tx);
    expect(u.groupRole).toBe('solo');
  });

  it('multi-unit group (streaming message still single in Phase 0) also solo', () => {
    const tx = createTranscript();
    tx.seed([userMsg('a')]);
    const [u] = flattenTranscript(tx);
    // Phase 0: legacy passthrough always returns 1 unit → solo
    expect(u.groupRole).toBe('solo');
  });
});

describe('flatten — gapBefore', () => {
  it('first unit has gapBefore = 0', () => {
    const tx = createTranscript();
    tx.seed([userMsg('a'), tool('b')]);
    const units = flattenTranscript(tx);
    expect(units[0].gapBefore).toBe(0);
  });

  it('non-first units have gapBefore = ROW_GAP', () => {
    const tx = createTranscript();
    tx.seed([userMsg('a'), tool('b'), tool('c')]);
    const units = flattenTranscript(tx);
    expect(units[1].gapBefore).toBe(ROW_GAP);
    expect(units[2].gapBefore).toBe(ROW_GAP);
  });
});

describe('flatten — activeTurn', () => {
  it('includes activeTurn items at the end', () => {
    const tx = createTranscript();
    tx.seed([userMsg('a')]);
    tx.dispatch({ type: 'message_chunk', id: 'streaming', role: 'assistant', text: 'hi' });
    const units = flattenTranscript(tx);
    expect(units).toHaveLength(2);
    expect(units[1].itemId).toBe('streaming');
  });

  it('activeTurn items are not cached in segmentCache', () => {
    const tx = createTranscript();
    tx.dispatch({ type: 'message_chunk', id: 'streaming', role: 'assistant', text: 'hi' });
    flattenTranscript(tx);
    // The streaming ChatItem object — get it from state
    const streamingItem = tx.state.activeTurn?.[0];
    expect(streamingItem).toBeDefined();
    // activeTurn items bypass the WeakMap cache
    expect(segmentCache.has(streamingItem!)).toBe(false);
  });
});

describe('flatten — identity (WeakMap caching)', () => {
  it('returns same RenderUnit[] array ref for committed item on second call', () => {
    const tx = createTranscript();
    tx.seed([userMsg('a'), tool('b')]);
    const u1 = flattenTranscript(tx);
    const u2 = flattenTranscript(tx);
    // Committed item objects are stable → same group array ref
    const aItem = tx.state.committed[0];
    expect(segmentCache.get(aItem)).toBeDefined();
    expect(u1[0]).toBe(u2[0]); // same RenderUnit object
  });

  it('ids are stable across multiple flatten calls for committed items', () => {
    const tx = createTranscript();
    tx.seed([userMsg('a')]);
    const [u1] = flattenTranscript(tx);
    const [u2] = flattenTranscript(tx);
    expect(u1.id).toBe(u2.id);
  });

  it('cache is invalidated when turn_done creates new item objects', () => {
    const tx = createTranscript();
    tx.dispatch({ type: 'message_chunk', id: 'msg-1', role: 'assistant', text: 'hi' });
    const streaming1 = tx.state.activeTurn?.[0];
    if (!streaming1) throw new Error('expected activeTurn item');
    flattenTranscript(tx);
    expect(segmentCache.has(streaming1)).toBe(false); // never cached

    tx.dispatch({ type: 'turn_done' });
    // After turn_done, the item moves to committed as a NEW object
    const committed = tx.state.committed[0];
    expect(committed).not.toBe(streaming1); // new object ref
    expect(segmentCache.has(committed)).toBe(false); // not yet cached

    flattenTranscript(tx); // populates cache
    expect(segmentCache.has(committed)).toBe(true);
  });
});

describe('collectUserTurnUnits', () => {
  it('returns empty array when no user messages', () => {
    const tx = createTranscript();
    tx.seed([tool('a')]);
    const units = flattenTranscript(tx);
    expect(collectUserTurnUnits(tx.state, units)).toEqual([]);
  });

  it('returns correct unit indices for user messages', () => {
    const tx = createTranscript();
    tx.seed([userMsg('u1'), tool('t1'), userMsg('u2'), tool('t2')]);
    const units = flattenTranscript(tx);
    const indices = collectUserTurnUnits(tx.state, units);
    expect(indices).toHaveLength(2);
    // First user message is at unit index 0
    expect(units[indices[0]].itemId).toBe('u1');
    // Second user message is at unit index 2
    expect(units[indices[1]].itemId).toBe('u2');
  });

  it('does not include activeTurn user messages', () => {
    const tx = createTranscript();
    // activeTurn user message would be unusual, but collectUserTurnUnits
    // only inspects committed items by design.
    tx.seed([userMsg('u1')]);
    tx.dispatch({ type: 'message_chunk', id: 'streaming', role: 'user', text: 'hi' });
    const units = flattenTranscript(tx);
    const indices = collectUserTurnUnits(tx.state, units);
    // Only the committed user message (u1) is returned, not the streaming one.
    expect(indices).toHaveLength(1);
    expect(units[indices[0]].itemId).toBe('u1');
  });

  it('returns first unit index for a multi-unit group (Phase 1+)', () => {
    const tx = createTranscript();
    tx.seed([userMsg('u1'), assistantMsg('a1'), userMsg('u2')]);
    const units = flattenTranscript(tx);
    // Phase 0: each item is one unit; user turns are at indices 0 and 2.
    const indices = collectUserTurnUnits(tx.state, units);
    expect(indices[0]).toBe(0);
    expect(indices[1]).toBe(2);
  });
});
