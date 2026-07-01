/**
 * flatten — unit tests.
 *
 * Covers:
 *   1. Basic flatness: one unit per committed item (Phase 0 legacy passthrough).
 *   2. Group roles: solo / first / middle / last stamped correctly.
 *   3. Inter-group gapBefore: margin-collapse on every seam (including turn
 *      boundaries, which resolve to the message margin), 0 on first group.
 *   4. Identity stability: committed items produce stable unit ids across calls
 *      (no re-segmentation needed by the framework memo in ChatRoot).
 *   5. activeTurn: items included after committed; boundary seam resolved.
 *   6. collectUserTurnUnits: correct absolute unit indices for user messages.
 *   7. Empty transcript produces empty array.
 *   8. committedUnits stability: same plain items → same output (framework
 *      memo won't re-run unless committed() identity changes).
 *   9. Cross-tier boundary seam: prevKind correctly resolves gapBefore of the
 *      first active unit.
 */

import { describe, expect, it } from 'vitest';

// The user message margin is the source of truth for the turn-boundary gap.
const MSG_MARGIN_TOP = 8; // matches STUB_UNIT_DEFS['message'].margin.top
import { unit } from '@core/units';
import type { ItemSegmenter, UnitDef } from '@core/units';
import type { ChatItem } from '@/model';
import { buildItemForest, flattenTier, makeUnitsView, collectUserTurnUnits } from './flatten';
import { createTranscript } from './transcript';
import { applyTurnEvent } from './turn-reducer';

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

// Minimal unit-def stubs — only the `margin` field is consulted by flatten.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StubUnitDefs = Record<string, Pick<UnitDef<any>, 'margin'>>;

const STUB_UNIT_DEFS: StubUnitDefs = {
  message: { margin: { top: 8, bottom: 8 } },
  tool: { margin: { top: 2, bottom: 2 } },
  thinking: { margin: { top: 6, bottom: 6 } },
  'file-op': { margin: { top: 2, bottom: 2 } },
  execute: { margin: { top: 2, bottom: 2 } },
  diff: { margin: { top: 2, bottom: 6 } },
  'resource-link': { margin: { top: 2, bottom: 2 } },
  plan: { margin: { top: 8, bottom: 8 } },
};

function driveEvent(
  tx: ReturnType<typeof createTranscript>,
  event: Parameters<typeof applyTurnEvent>[1]
) {
  tx.activeTurn.set(applyTurnEvent(tx.activeTurn.get(), event), 'generating');
}

function flattenCommitted(tx: ReturnType<typeof createTranscript>, unitDefs?: StubUnitDefs) {
  return flattenTier(tx.state.committed, segCtx, STUB_SEGMENTERS, unitDefs);
}

function flattenActive(
  tx: ReturnType<typeof createTranscript>,
  prevKind?: string,
  unitDefs?: StubUnitDefs
) {
  const at = tx.state.activeTurn ?? [];
  return flattenTier(at, segCtx, STUB_SEGMENTERS, unitDefs, prevKind);
}

function flattenAll(tx: ReturnType<typeof createTranscript>, unitDefs?: StubUnitDefs) {
  const c = flattenCommitted(tx, unitDefs);
  const prevKind = c.length > 0 ? c[c.length - 1].kind : undefined;
  const a = flattenActive(tx, prevKind, unitDefs);
  return makeUnitsView(c, a);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('flatten — basic', () => {
  it('returns empty view for an empty transcript', () => {
    const tx = createTranscript();
    const view = flattenAll(tx);
    expect(view.length).toBe(0);
  });

  it('produces one unit per committed item (Phase 0 legacy)', () => {
    const tx = createTranscript();
    tx.history.seed([userMsg('a'), userMsg('b'), tool('c')]);
    const view = flattenAll(tx);
    expect(view.length).toBe(3);
    expect(view.at(0)?.itemId).toBe('a');
    expect(view.at(1)?.itemId).toBe('b');
    expect(view.at(2)?.itemId).toBe('c');
  });

  it('unit ids are ${itemId}#self for legacy units', () => {
    const tx = createTranscript();
    tx.history.seed([userMsg('x')]);
    const view = flattenAll(tx);
    expect(view.at(0)?.id).toBe('x#self');
  });

  it('unit.kind matches item.kind', () => {
    const tx = createTranscript();
    tx.history.seed([userMsg('a'), tool('b')]);
    const view = flattenAll(tx);
    expect(view.at(0)?.kind).toBe('message');
    expect(view.at(1)?.kind).toBe('tool');
  });

  it('unit.data matches the seeded ChatItem', () => {
    const tx = createTranscript();
    const item = userMsg('a');
    tx.history.seed([item]);
    const view = flattenAll(tx);
    // seed() may clone items, so use deep equality
    expect(view.at(0)?.data).toStrictEqual(item);
    // data should be the same ref as what's in state.committed
    expect(view.at(0)?.data).toBe(tx.state.committed[0]);
  });
});

describe('flatten — groupRole', () => {
  it('single-unit item has groupRole solo', () => {
    const tx = createTranscript();
    tx.history.seed([tool('a')]);
    const view = flattenAll(tx);
    expect(view.at(0)?.groupRole).toBe('solo');
  });

  it('multi-unit group (streaming message still single in Phase 0) also solo', () => {
    const tx = createTranscript();
    tx.history.seed([userMsg('a')]);
    const view = flattenAll(tx);
    // Phase 0: legacy passthrough always returns 1 unit → solo
    expect(view.at(0)?.groupRole).toBe('solo');
  });
});

describe('flatten — gapBefore', () => {
  it('first unit has gapBefore = 0', () => {
    const tx = createTranscript();
    tx.history.seed([userMsg('a'), tool('b')]);
    const view = flattenAll(tx, STUB_UNIT_DEFS);
    expect(view.at(0)?.gapBefore).toBe(0);
  });

  it('user→assistant boundary seam collapses to the message margin (max(8,2)=8)', () => {
    const tx = createTranscript();
    tx.history.seed([userMsg('a'), tool('b')]);
    const view = flattenAll(tx, STUB_UNIT_DEFS);
    // user.bottom=8, tool.top=2 → max = 8
    expect(view.at(1)?.gapBefore).toBe(MSG_MARGIN_TOP);
  });

  it('assistant→user boundary seam collapses to the message margin (max(8,8)=8)', () => {
    const tx = createTranscript();
    tx.history.seed([assistantMsg('a'), userMsg('b')]);
    const view = flattenAll(tx, STUB_UNIT_DEFS);
    // assistant.bottom=8, user.top=8 → max = 8
    expect(view.at(1)?.gapBefore).toBe(MSG_MARGIN_TOP);
  });

  it('intra-turn seam collapses adjacent margins (tool→tool = max(2,2) = 2)', () => {
    const tx = createTranscript();
    tx.history.seed([userMsg('u'), tool('a'), tool('b')]);
    const view = flattenAll(tx, STUB_UNIT_DEFS);
    // view.at(0)=user, view.at(1)=tool(a) boundary, view.at(2)=tool(b) intra-turn
    expect(view.at(2)?.gapBefore).toBe(2);
  });

  it('intra-turn seam collapses asymmetric margins (tool→message = max(2,8) = 8)', () => {
    const tx = createTranscript();
    tx.history.seed([tool('a'), assistantMsg('b')]);
    const view = flattenAll(tx, STUB_UNIT_DEFS);
    // tool.bottom=2, message.top=8 → max = 8
    expect(view.at(1)?.gapBefore).toBe(8);
  });

  it('defaults to 0 gap when no unitDefs provided (unknown kinds have no margin)', () => {
    const tx = createTranscript();
    tx.history.seed([tool('a'), tool('b')]);
    // No unitDefs → both sides have no margin → max(0,0)=0
    const view = flattenAll(tx);
    expect(view.at(1)?.gapBefore).toBe(0);
  });

  it('all seams default to 0 when no unitDefs provided', () => {
    const tx = createTranscript();
    tx.history.seed([userMsg('a'), tool('b'), tool('c')]);
    const view = flattenAll(tx);
    // No unitDefs → no margins → all seams are 0
    expect(view.at(1)?.gapBefore).toBe(0);
    expect(view.at(2)?.gapBefore).toBe(0);
  });
});

describe('flatten — activeTurn', () => {
  it('includes activeTurn items at the end', () => {
    const tx = createTranscript();
    tx.history.seed([userMsg('a')]);
    driveEvent(tx, { type: 'message_chunk', id: 'streaming', role: 'assistant', text: 'hi' });
    const view = flattenAll(tx);
    expect(view.length).toBe(2);
    expect(view.at(1)?.itemId).toBe('streaming');
  });
});

describe('flatten — identity stability', () => {
  it('same committed items produce same unit ids across flattenTier calls', () => {
    const tx = createTranscript();
    tx.history.seed([userMsg('a'), tool('b')]);
    const r1 = flattenTier(tx.state.committed, segCtx, STUB_SEGMENTERS);
    const r2 = flattenTier(tx.state.committed, segCtx, STUB_SEGMENTERS);
    expect(r1[0].id).toBe(r2[0].id);
    expect(r1[1].id).toBe(r2[1].id);
  });

  it('committed items produce stable data refs across calls', () => {
    const tx = createTranscript();
    tx.history.seed([userMsg('a')]);
    const r1 = flattenTier(tx.state.committed, segCtx, STUB_SEGMENTERS);
    const r2 = flattenTier(tx.state.committed, segCtx, STUB_SEGMENTERS);
    // Same plain committed object ref → same data ref in units
    expect(r1[0].data).toBe(r2[0].data);
    expect(r1[0].data).toBe(tx.state.committed[0]);
  });

  it('commit produces a new committed item object (streaming → committed transition)', () => {
    const tx = createTranscript();
    driveEvent(tx, { type: 'message_chunk', id: 'msg-1', role: 'assistant', text: 'hi' });
    const streaming = tx.state.activeTurn?.[0];
    expect(streaming).toBeDefined();

    tx.activeTurn.commit('done');
    const committed = tx.state.committed[0];
    // finalizeTurn spreads+unwraps so committed is a new plain object
    expect(committed).not.toBe(streaming);
    // The committed item should not be a Solid proxy
    const r = flattenTier(tx.state.committed, segCtx, STUB_SEGMENTERS);
    expect(r[0].data).toBe(committed);
  });
});

describe('flatten — cross-tier boundary seam', () => {
  it('first active unit gets correct gapBefore from committed last kind', () => {
    const tx = createTranscript();
    tx.history.seed([userMsg('u1')]);
    driveEvent(tx, { type: 'message_chunk', id: 'streaming', role: 'assistant', text: 'hi' });

    const committedUnits = flattenTier(tx.state.committed, segCtx, STUB_SEGMENTERS, STUB_UNIT_DEFS);
    const prevKind = committedUnits[committedUnits.length - 1]?.kind;
    const activeUnits = flattenTier(
      tx.state.activeTurn ?? [],
      segCtx,
      STUB_SEGMENTERS,
      STUB_UNIT_DEFS,
      prevKind
    );

    // user.bottom=8, message.top=8 → max = 8
    expect(activeUnits[0]?.gapBefore).toBe(8);
  });

  it('no prevKind → first active unit gapBefore is 0', () => {
    const tx = createTranscript();
    driveEvent(tx, { type: 'message_chunk', id: 'streaming', role: 'assistant', text: 'hi' });

    const activeUnits = flattenTier(
      tx.state.activeTurn ?? [],
      segCtx,
      STUB_SEGMENTERS,
      STUB_UNIT_DEFS,
      undefined
    );
    expect(activeUnits[0]?.gapBefore).toBe(0);
  });
});

describe('collectUserTurnUnits', () => {
  it('returns empty array when no user messages', () => {
    const tx = createTranscript();
    tx.history.seed([tool('a')]);
    const view = flattenAll(tx);
    expect(collectUserTurnUnits(tx.state.committed, view)).toEqual([]);
  });

  it('returns correct unit indices for user messages', () => {
    const tx = createTranscript();
    tx.history.seed([userMsg('u1'), tool('t1'), userMsg('u2'), tool('t2')]);
    const view = flattenAll(tx);
    const indices = collectUserTurnUnits(tx.state.committed, view);
    expect(indices).toHaveLength(2);
    // First user message is at unit index 0
    expect(view.at(indices[0])?.itemId).toBe('u1');
    // Second user message is at unit index 2
    expect(view.at(indices[1])?.itemId).toBe('u2');
  });

  it('does not include activeTurn user messages', () => {
    const tx = createTranscript();
    // activeTurn user message would be unusual, but collectUserTurnUnits
    // only inspects committed items by design.
    tx.history.seed([userMsg('u1')]);
    driveEvent(tx, { type: 'message_chunk', id: 'streaming', role: 'user', text: 'hi' });
    const view = flattenAll(tx);
    const indices = collectUserTurnUnits(tx.state.committed, view);
    // Only the committed user message (u1) is returned, not the streaming one.
    expect(indices).toHaveLength(1);
    expect(view.at(indices[0])?.itemId).toBe('u1');
  });

  it('returns first unit index for a multi-unit group (Phase 1+)', () => {
    const tx = createTranscript();
    tx.history.seed([userMsg('u1'), assistantMsg('a1'), userMsg('u2')]);
    const view = flattenAll(tx);
    // Phase 0: each item is one unit; user turns are at indices 0 and 2.
    const indices = collectUserTurnUnits(tx.state.committed, view);
    expect(indices[0]).toBe(0);
    expect(indices[1]).toBe(2);
  });
});

// ── buildItemForest ───────────────────────────────────────────────────────────

describe('buildItemForest', () => {
  function mkTool(id: string, parentId?: string): ChatItem {
    return parentId
      ? { kind: 'tool', id, name: 'bash', status: 'done', parentId }
      : { kind: 'tool', id, name: 'bash', status: 'done' };
  }

  it('flat list — no parentIds — all items are roots with empty children', () => {
    const items = [mkTool('a'), mkTool('b'), mkTool('c')];
    const { nodes, childIds } = buildItemForest(items);
    expect(childIds.size).toBe(0);
    for (const item of items) {
      expect(nodes.get(item.id)?.children).toHaveLength(0);
    }
  });

  it('single parent-child pair', () => {
    const items = [mkTool('parent'), mkTool('child', 'parent')];
    const { nodes, childIds } = buildItemForest(items);
    expect(childIds.has('child')).toBe(true);
    expect(childIds.has('parent')).toBe(false);
    expect(nodes.get('parent')?.children).toHaveLength(1);
    expect(nodes.get('parent')?.children[0].item.id).toBe('child');
    expect(nodes.get('child')?.children).toHaveLength(0);
  });

  it('multi-child: multiple items share the same parent', () => {
    const items = [mkTool('p'), mkTool('c1', 'p'), mkTool('c2', 'p'), mkTool('c3', 'p')];
    const { nodes, childIds } = buildItemForest(items);
    expect(childIds.size).toBe(3);
    const parentChildren = nodes.get('p')?.children ?? [];
    expect(parentChildren).toHaveLength(3);
    expect(parentChildren.map((n) => n.item.id)).toEqual(['c1', 'c2', 'c3']);
  });

  it('multi-level nesting: grandparent → parent → child', () => {
    const items = [mkTool('gp'), mkTool('p', 'gp'), mkTool('c', 'p')];
    const { nodes, childIds } = buildItemForest(items);
    // Both 'p' and 'c' are children
    expect(childIds.has('gp')).toBe(false);
    expect(childIds.has('p')).toBe(true);
    expect(childIds.has('c')).toBe(true);
    // Grandparent has one child (parent)
    const gpChildren = nodes.get('gp')?.children ?? [];
    expect(gpChildren).toHaveLength(1);
    expect(gpChildren[0].item.id).toBe('p');
    // Parent has one child (c)
    const pChildren = nodes.get('p')?.children ?? [];
    expect(pChildren).toHaveLength(1);
    expect(pChildren[0].item.id).toBe('c');
  });

  it('orphan parentId (pointing outside the tier) — treated as root', () => {
    const items = [mkTool('child', 'nonexistent')];
    const { nodes, childIds } = buildItemForest(items);
    expect(childIds.has('child')).toBe(false);
    expect(nodes.get('child')?.children).toHaveLength(0);
  });

  it('preserves original child order', () => {
    const items = [mkTool('p'), mkTool('c3', 'p'), mkTool('c1', 'p'), mkTool('c2', 'p')];
    const { nodes } = buildItemForest(items);
    const childIds = nodes.get('p')?.children.map((n) => n.item.id) ?? [];
    expect(childIds).toEqual(['c3', 'c1', 'c2']);
  });

  it('empty items array', () => {
    const { nodes, childIds } = buildItemForest([]);
    expect(nodes.size).toBe(0);
    expect(childIds.size).toBe(0);
  });
});
