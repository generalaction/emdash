/** TranscriptApi — unit tests for the new history + activeTurn API. */

import { describe, expect, it } from 'vitest';
import type { ChatItem, ChatMessage } from '@/model';
import { createTranscript } from './transcript';
import { applyTurnEvent } from './turn-reducer';

function msg(id: string, text = 'hi'): ChatItem {
  return { kind: 'message', id, role: 'user', text };
}

function drive(
  tx: ReturnType<typeof createTranscript>,
  ...events: Parameters<typeof applyTurnEvent>[1][]
) {
  for (const event of events) {
    tx.activeTurn.set(applyTurnEvent(tx.activeTurn.get(), event), 'generating');
  }
}

// ── findIndexById ─────────────────────────────────────────────────────────────

describe('findIndexById', () => {
  it('returns -1 for an empty transcript', () => {
    const tx = createTranscript();
    expect(tx.findIndexById('x')).toBe(-1);
  });

  it('finds seeded committed items by index', () => {
    const tx = createTranscript();
    tx.history.seed([msg('a'), msg('b'), msg('c')]);
    expect(tx.findIndexById('a')).toBe(0);
    expect(tx.findIndexById('b')).toBe(1);
    expect(tx.findIndexById('c')).toBe(2);
  });

  it('returns -1 for unknown id in seeded transcript', () => {
    const tx = createTranscript();
    tx.history.seed([msg('a')]);
    expect(tx.findIndexById('z')).toBe(-1);
  });

  it('finds items in activeTurn (after committed)', () => {
    const tx = createTranscript();
    tx.history.seed([msg('a'), msg('b')]);
    drive(tx, { type: 'message_chunk', id: 'c', role: 'assistant', text: 'hi' });
    expect(tx.findIndexById('c')).toBe(2);
  });

  it('indices update after turn_done moves activeTurn into committed', () => {
    const tx = createTranscript();
    tx.history.seed([msg('a')]);
    drive(tx, { type: 'message_chunk', id: 'b', role: 'assistant', text: 'hi' });
    expect(tx.findIndexById('b')).toBe(1);
    tx.activeTurn.commit('done');
    // After commit, b is now in committed at index 1
    expect(tx.findIndexById('b')).toBe(1);
    expect(tx.state.activeTurn).toBeNull();
  });

  it('reset clears all indices', () => {
    const tx = createTranscript();
    tx.history.seed([msg('a'), msg('b')]);
    tx.reset();
    expect(tx.findIndexById('a')).toBe(-1);
  });
});

// ── history.prepend ────────────────────────────────────────────────────────────

describe('prependHistory', () => {
  it('no-op for empty array', () => {
    const tx = createTranscript();
    tx.history.seed([msg('a')]);
    tx.history.prepend([]);
    expect(tx.state.committed.length).toBe(1);
  });

  it('prepends items before existing committed items', () => {
    const tx = createTranscript();
    tx.history.seed([msg('c'), msg('d')]);
    tx.history.prepend([msg('a'), msg('b')]);
    expect(tx.state.committed.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('indices are correct after prepend', () => {
    const tx = createTranscript();
    tx.history.seed([msg('c')]);
    tx.history.prepend([msg('a'), msg('b')]);
    expect(tx.findIndexById('a')).toBe(0);
    expect(tx.findIndexById('b')).toBe(1);
    expect(tx.findIndexById('c')).toBe(2);
  });

  it('successive prepends update indices correctly', () => {
    const tx = createTranscript();
    tx.history.seed([msg('c')]);
    tx.history.prepend([msg('b')]);
    tx.history.prepend([msg('a')]);
    expect(tx.findIndexById('a')).toBe(0);
    expect(tx.findIndexById('b')).toBe(1);
    expect(tx.findIndexById('c')).toBe(2);
  });

  it('does not affect activeTurn', () => {
    const tx = createTranscript();
    drive(tx, { type: 'message_chunk', id: 'x', role: 'assistant', text: 'hi' });
    tx.history.prepend([msg('a')]);
    expect(tx.state.activeTurn?.length).toBe(1);
    expect(tx.state.activeTurn?.[0].id).toBe('x');
  });
});

// ── TurnStatus ────────────────────────────────────────────────────────────────

describe('turnStatus', () => {
  it('starts as done', () => {
    const tx = createTranscript();
    expect(tx.state.turnStatus).toBe('done');
  });

  it('is reset to done by seed()', () => {
    const tx = createTranscript();
    drive(tx, { type: 'message_chunk', id: 'x', role: 'assistant', text: 'hi' });
    tx.history.seed([]);
    expect(tx.state.turnStatus).toBe('done');
  });

  it('is reset to done by reset()', () => {
    const tx = createTranscript();
    drive(tx, { type: 'message_chunk', id: 'x', role: 'assistant', text: 'hi' });
    tx.reset();
    expect(tx.state.turnStatus).toBe('done');
  });

  it('becomes generating when the first content event opens a new activeTurn', () => {
    const tx = createTranscript();
    drive(tx, { type: 'message_chunk', id: 'x', role: 'assistant', text: 'hi' });
    expect(tx.state.turnStatus).toBe('generating');
  });

  it('stays generating on subsequent events within the same turn', () => {
    const tx = createTranscript();
    drive(
      tx,
      { type: 'message_chunk', id: 'x', role: 'assistant', text: 'hello' },
      { type: 'message_chunk', id: 'x', role: 'assistant', text: ' world' }
    );
    expect(tx.state.turnStatus).toBe('generating');
  });

  it('becomes done when commit(done) is called', () => {
    const tx = createTranscript();
    drive(tx, { type: 'message_chunk', id: 'x', role: 'assistant', text: 'hi' });
    tx.activeTurn.commit('done');
    expect(tx.state.turnStatus).toBe('done');
  });
});

// ── history.seed ─────────────────────────────────────────────────────────────

describe('history.seed', () => {
  it('replaces committed and clears activeTurn', () => {
    const tx = createTranscript();
    drive(tx, { type: 'message_chunk', id: 'x', role: 'assistant', text: 'live' });
    tx.history.seed([msg('a'), msg('b')]);
    expect(tx.state.committed.map((i) => i.id)).toEqual(['a', 'b']);
    expect(tx.state.activeTurn).toBeNull();
  });

  it('rebuilds the id map', () => {
    const tx = createTranscript();
    tx.history.seed([msg('old')]);
    tx.history.seed([msg('new1'), msg('new2')]);
    expect(tx.findIndexById('old')).toBe(-1);
    expect(tx.findIndexById('new1')).toBe(0);
    expect(tx.findIndexById('new2')).toBe(1);
  });
});

// ── history.append ────────────────────────────────────────────────────────────

describe('history.append', () => {
  it('appends items after committed', () => {
    const tx = createTranscript();
    tx.history.seed([msg('a')]);
    tx.history.append([msg('b'), msg('c')]);
    expect(tx.state.committed.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('patches idMap incrementally', () => {
    const tx = createTranscript();
    tx.history.seed([msg('a')]);
    tx.history.append([msg('b')]);
    expect(tx.findIndexById('a')).toBe(0);
    expect(tx.findIndexById('b')).toBe(1);
  });

  it('no-op for empty array', () => {
    const tx = createTranscript();
    tx.history.seed([msg('a')]);
    tx.history.append([]);
    expect(tx.state.committed.length).toBe(1);
  });
});

// ── activeTurn.set ────────────────────────────────────────────────────────────

describe('activeTurn.set', () => {
  it('sets activeTurn items and status', () => {
    const tx = createTranscript();
    tx.activeTurn.set([msg('x')], 'generating');
    expect(tx.state.activeTurn?.length).toBe(1);
    expect(tx.state.activeTurn?.[0].id).toBe('x');
    expect(tx.state.turnStatus).toBe('generating');
  });

  it('reconcile: in-place text growth (same id)', () => {
    const tx = createTranscript();
    tx.activeTurn.set(
      [{ kind: 'message', id: 'm1', role: 'assistant', text: 'Hello', streaming: true }],
      'generating'
    );
    const ref1 = tx.state.activeTurn![0];
    tx.activeTurn.set(
      [{ kind: 'message', id: 'm1', role: 'assistant', text: 'Hello world', streaming: true }],
      'generating'
    );
    // Same item id → reconcile patches in place (same array slot)
    expect(tx.state.activeTurn![0].id).toBe('m1');
    expect((tx.state.activeTurn![0] as ChatMessage).text).toBe('Hello world');
    // The object reference may change but the slot is reused by reconcile
    expect(tx.state.activeTurn!.length).toBe(1);
    // ref1 is the proxy — it should reflect the updated value
    expect((ref1 as ChatMessage).text).toBe('Hello world');
  });
});

// ── activeTurn.commit ─────────────────────────────────────────────────────────

describe('activeTurn.commit', () => {
  it('moves items to history and clears activeTurn', () => {
    const tx = createTranscript();
    drive(tx, { type: 'message_chunk', id: 'a1', role: 'assistant', text: 'hi' });
    tx.activeTurn.commit('done');
    expect(tx.state.activeTurn).toBeNull();
    expect(tx.state.turnStatus).toBe('done');
    expect(tx.state.committed.find((i) => i.id === 'a1')).toBeDefined();
  });

  it('commit cancelled sets turnStatus to cancelled', () => {
    const tx = createTranscript();
    drive(tx, { type: 'message_chunk', id: 'a1', role: 'assistant', text: 'partial' });
    tx.activeTurn.commit('cancelled');
    expect(tx.state.turnStatus).toBe('cancelled');
    expect(tx.state.activeTurn).toBeNull();
    expect(tx.state.committed.find((i) => i.id === 'a1')).toBeDefined();
  });

  it('commit finalizes streaming flags', () => {
    const tx = createTranscript();
    drive(tx, { type: 'message_chunk', id: 'a1', role: 'assistant', text: 'hi' });
    // Before commit: message is streaming
    expect((tx.state.activeTurn![0] as ChatMessage).streaming).toBe(true);
    tx.activeTurn.commit('done');
    const committed = tx.state.committed.find((i) => i.id === 'a1') as ChatMessage;
    expect(committed?.streaming).toBe(false);
  });

  it('commit on null activeTurn is a no-op for history', () => {
    const tx = createTranscript();
    tx.history.seed([msg('a')]);
    tx.activeTurn.commit('done');
    // Nothing appended since activeTurn was null
    expect(tx.state.committed.length).toBe(1);
  });

  it('indices are correct after commit', () => {
    const tx = createTranscript();
    tx.history.seed([msg('a')]);
    drive(tx, { type: 'message_chunk', id: 'b', role: 'assistant', text: 'reply' });
    tx.activeTurn.commit('done');
    expect(tx.findIndexById('a')).toBe(0);
    expect(tx.findIndexById('b')).toBe(1);
  });

  it('multiple commits accumulate history', () => {
    const tx = createTranscript();
    drive(tx, { type: 'message_chunk', id: 'a1', role: 'assistant', text: 'first' });
    tx.activeTurn.commit('done');
    drive(tx, { type: 'message_chunk', id: 'a2', role: 'assistant', text: 'second' });
    tx.activeTurn.commit('done');
    expect(tx.state.committed.length).toBe(2);
    expect(tx.state.committed[0].id).toBe('a1');
    expect(tx.state.committed[1].id).toBe('a2');
  });
});

// ── activeTurn.get ────────────────────────────────────────────────────────────

describe('activeTurn.get', () => {
  it('returns null when no active turn', () => {
    const tx = createTranscript();
    expect(tx.activeTurn.get()).toBeNull();
  });

  it('returns current items after set', () => {
    const tx = createTranscript();
    const items: ChatItem[] = [msg('x')];
    tx.activeTurn.set(items, 'generating');
    const got = tx.activeTurn.get();
    expect(got?.length).toBe(1);
    expect(got?.[0].id).toBe('x');
  });
});

// ── activeTurn.status ─────────────────────────────────────────────────────────

describe('activeTurn.status', () => {
  it('starts as done', () => {
    const tx = createTranscript();
    expect(tx.activeTurn.status()).toBe('done');
  });

  it('reflects the status passed to set', () => {
    const tx = createTranscript();
    tx.activeTurn.set([msg('x')], 'generating');
    expect(tx.activeTurn.status()).toBe('generating');
  });
});

// ── reset ─────────────────────────────────────────────────────────────────────

describe('reset', () => {
  it('clears committed, activeTurn, and status', () => {
    const tx = createTranscript();
    tx.history.seed([msg('a'), msg('b')]);
    drive(tx, { type: 'message_chunk', id: 'c', role: 'assistant', text: 'hi' });
    tx.reset();
    expect(tx.state.committed.length).toBe(0);
    expect(tx.state.activeTurn).toBeNull();
    expect(tx.state.turnStatus).toBe('done');
    expect(tx.findIndexById('a')).toBe(-1);
  });
});
