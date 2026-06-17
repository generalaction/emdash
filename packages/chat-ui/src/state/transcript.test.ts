/**
 * TranscriptApi — unit tests for findIndexById and prependHistory.
 */

import { describe, expect, it } from 'vitest';
import type { ChatItem } from '../model';
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
