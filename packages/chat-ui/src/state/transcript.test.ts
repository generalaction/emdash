/** TranscriptApi — unit tests for findIndexById, prependHistory, and turnStatus lifecycle. */

import { describe, expect, it } from 'vitest';
import type { ChatItem } from '@/model';
import { createTranscript } from './transcript';

function msg(id: string, text = 'hi'): ChatItem {
  return { kind: 'message', id, role: 'user', text };
}

describe('findIndexById', () => {
  it('returns -1 for an empty transcript', () => {
    const tx = createTranscript();
    expect(tx.findIndexById('x')).toBe(-1);
  });

  it('finds seeded committed items by index', () => {
    const tx = createTranscript();
    tx.seed([msg('a'), msg('b'), msg('c')]);
    expect(tx.findIndexById('a')).toBe(0);
    expect(tx.findIndexById('b')).toBe(1);
    expect(tx.findIndexById('c')).toBe(2);
  });

  it('returns -1 for unknown id in seeded transcript', () => {
    const tx = createTranscript();
    tx.seed([msg('a')]);
    expect(tx.findIndexById('z')).toBe(-1);
  });

  it('finds items in activeTurn (after committed)', () => {
    const tx = createTranscript();
    tx.seed([msg('committed-1')]);
    tx.dispatch({ type: 'message_chunk', id: 'streaming-1', role: 'assistant', text: 'hello' });
    expect(tx.findIndexById('streaming-1')).toBe(1); // index 1 = committed(1) + activeTurn offset 0
  });

  it('indices update after turn_done moves activeTurn into committed', () => {
    const tx = createTranscript();
    tx.dispatch({ type: 'message_chunk', id: 'msg-1', role: 'assistant', text: 'hi' });
    expect(tx.findIndexById('msg-1')).toBe(0);
    tx.dispatch({ type: 'turn_done' });
    // After turn_done, it's in committed — idMap must be patched
    expect(tx.findIndexById('msg-1')).toBe(0);
  });

  it('reset clears all indices', () => {
    const tx = createTranscript();
    tx.seed([msg('a')]);
    tx.reset();
    expect(tx.findIndexById('a')).toBe(-1);
  });
});

describe('prependHistory', () => {
  it('no-op for empty array', () => {
    const tx = createTranscript();
    tx.seed([msg('a')]);
    tx.prependHistory([]);
    expect(tx.state.committed.length).toBe(1);
    expect(tx.findIndexById('a')).toBe(0);
  });

  it('prepends items before existing committed items', () => {
    const tx = createTranscript();
    tx.seed([msg('c'), msg('d')]);
    tx.prependHistory([msg('a'), msg('b')]);
    expect(tx.state.committed.length).toBe(4);
    expect(tx.state.committed[0].id).toBe('a');
    expect(tx.state.committed[1].id).toBe('b');
    expect(tx.state.committed[2].id).toBe('c');
    expect(tx.state.committed[3].id).toBe('d');
  });

  it('indices are correct after prepend', () => {
    const tx = createTranscript();
    tx.seed([msg('c'), msg('d')]);
    tx.prependHistory([msg('a'), msg('b')]);
    expect(tx.findIndexById('a')).toBe(0);
    expect(tx.findIndexById('b')).toBe(1);
    expect(tx.findIndexById('c')).toBe(2);
    expect(tx.findIndexById('d')).toBe(3);
  });

  it('successive prepends update indices correctly', () => {
    const tx = createTranscript();
    tx.seed([msg('z')]);
    tx.prependHistory([msg('y')]);
    tx.prependHistory([msg('x')]);
    expect(tx.findIndexById('x')).toBe(0);
    expect(tx.findIndexById('y')).toBe(1);
    expect(tx.findIndexById('z')).toBe(2);
  });

  it('does not affect activeTurn', () => {
    const tx = createTranscript();
    tx.dispatch({ type: 'message_chunk', id: 'streaming', role: 'assistant', text: 'hi' });
    tx.prependHistory([msg('old')]);
    // activeTurn offset increases by 1 (the prepended item)
    expect(tx.findIndexById('streaming')).toBe(1);
    expect(tx.state.activeTurn?.length).toBe(1);
  });
});

// ── turnStatus lifecycle ──────────────────────────────────────────────────────

describe('turnStatus', () => {
  it('starts as done', () => {
    const tx = createTranscript();
    expect(tx.state.turnStatus).toBe('done');
  });

  it('is reset to done by seed()', () => {
    const tx = createTranscript();
    tx.dispatch({ type: 'message_chunk', id: 'a1', role: 'assistant', text: 'hi' });
    expect(tx.state.turnStatus).toBe('generating');
    tx.seed([msg('u1')]);
    expect(tx.state.turnStatus).toBe('done');
  });

  it('is reset to done by reset()', () => {
    const tx = createTranscript();
    tx.dispatch({ type: 'message_chunk', id: 'a1', role: 'assistant', text: 'hi' });
    tx.reset();
    expect(tx.state.turnStatus).toBe('done');
  });

  it('becomes generating when the first content event opens a new activeTurn', () => {
    const tx = createTranscript();
    expect(tx.state.activeTurn).toBeNull();
    tx.dispatch({ type: 'message_chunk', id: 'a1', role: 'assistant', text: 'hello' });
    expect(tx.state.turnStatus).toBe('generating');
    expect(tx.state.activeTurn).not.toBeNull();
  });

  it('stays generating on subsequent events within the same turn', () => {
    const tx = createTranscript();
    tx.dispatch({ type: 'message_chunk', id: 'a1', role: 'assistant', text: 'hello' });
    tx.dispatch({ type: 'message_chunk', id: 'a1', role: 'assistant', text: ' world' });
    expect(tx.state.turnStatus).toBe('generating');
  });

  it('becomes done when turn_done is dispatched', () => {
    const tx = createTranscript();
    tx.dispatch({ type: 'message_chunk', id: 'a1', role: 'assistant', text: 'hi' });
    tx.dispatch({ type: 'turn_done' });
    expect(tx.state.turnStatus).toBe('done');
    expect(tx.state.activeTurn).toBeNull();
  });

  it('becomes cancelled when turn_cancelled is dispatched', () => {
    const tx = createTranscript();
    tx.dispatch({ type: 'message_chunk', id: 'a1', role: 'assistant', text: 'hi' });
    tx.dispatch({ type: 'turn_cancelled' });
    expect(tx.state.turnStatus).toBe('cancelled');
    expect(tx.state.activeTurn).toBeNull();
  });

  it('turn_cancelled commits partial activeTurn content like turn_done', () => {
    const tx = createTranscript();
    tx.dispatch({ type: 'message_chunk', id: 'a1', role: 'assistant', text: 'partial' });
    tx.dispatch({ type: 'turn_cancelled' });
    const committed = tx.state.committed.find((it) => it.id === 'a1');
    expect(committed).toBeDefined();
    expect(committed?.kind).toBe('message');
  });

  it('becomes generating again when the next turn starts after cancelled', () => {
    const tx = createTranscript();
    tx.dispatch({ type: 'message_chunk', id: 'a1', role: 'assistant', text: 'hi' });
    tx.dispatch({ type: 'turn_cancelled' });
    expect(tx.state.turnStatus).toBe('cancelled');

    // Next turn starts
    tx.dispatch({ type: 'message_chunk', id: 'a2', role: 'assistant', text: 'hello again' });
    expect(tx.state.turnStatus).toBe('generating');
  });

  it('becomes generating again when the next turn starts after done', () => {
    const tx = createTranscript();
    tx.dispatch({ type: 'message_chunk', id: 'a1', role: 'assistant', text: 'hi' });
    tx.dispatch({ type: 'turn_done' });
    expect(tx.state.turnStatus).toBe('done');

    tx.dispatch({ type: 'message_chunk', id: 'a2', role: 'assistant', text: 'hello again' });
    expect(tx.state.turnStatus).toBe('generating');
  });

  it('turn_done on an empty activeTurn is a no-op for turnStatus', () => {
    const tx = createTranscript();
    tx.dispatch({ type: 'turn_done' });
    // activeTurn was null, so the turn_done case bails early, status stays done
    expect(tx.state.turnStatus).toBe('done');
  });
});
