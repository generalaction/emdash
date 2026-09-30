import { describe, expect, it } from 'vitest';
import type { ChatMessage, TranscriptTurn } from '@/model';
import { applyTurnEvent } from '@/stories/_harness/turn-reducer';
import { createTranscript } from './transcript';

function msg(id: string, seq = 0, text = 'hi'): ChatMessage {
  return { kind: 'message', id, seq, role: 'user', text };
}

function turn(id: string, seq: number, ...items: ChatMessage[]): TranscriptTurn {
  return {
    id,
    seq,
    initiator: items.some((item) => item.role === 'user') ? 'user' : 'agent',
    items: items as TranscriptTurn['items'],
  };
}

function drive(
  tx: ReturnType<typeof createTranscript>,
  ...events: Parameters<typeof applyTurnEvent>[1][]
) {
  for (const event of events) {
    tx.activeTurn.set(applyTurnEvent(tx.activeTurn.get(), event), 'generating');
  }
}

describe('findItemById', () => {
  it('returns undefined for an empty transcript', () => {
    const tx = createTranscript();
    expect(tx.findItemById('x')).toBeUndefined();
  });

  it('finds seeded committed items', () => {
    const tx = createTranscript();
    tx.history.seed([turn('t1', 0, msg('a', 0), msg('b', 1), msg('c', 2))]);
    expect(tx.findItemById('a')?.id).toBe('a');
    expect(tx.findItemById('b')?.id).toBe('b');
    expect(tx.findItemById('c')?.id).toBe('c');
  });

  it('finds items in the active turn', () => {
    const tx = createTranscript();
    tx.history.seed([turn('t1', 0, msg('a', 0), msg('b', 1))]);
    drive(tx, { type: 'message_chunk', id: 'c', role: 'assistant', text: 'hi' });
    expect(tx.findItemById('c')?.id).toBe('c');
  });

  it('reset clears lookup state', () => {
    const tx = createTranscript();
    tx.history.seed([turn('t1', 0, msg('a', 0), msg('b', 1))]);
    tx.reset();
    expect(tx.findItemById('a')).toBeUndefined();
  });
});

describe('history', () => {
  it('retires a live snapshot when the response already includes that committed turn', () => {
    const tx = createTranscript();
    tx.activeTurn.set(turn('current', 1, msg('current-message')), 'generating');
    tx.history.replace([turn('current', 1, msg('current-message', 0, 'Final content'))]);
    expect(tx.state.activeTurnSnapshot).toBeNull();
    expect(tx.state.committedTurns).toHaveLength(1);
    expect(tx.findItemById('current-message')).toMatchObject({ text: 'Final content' });
  });

  it('replaces committed history without clearing an independently received live turn', () => {
    const tx = createTranscript();
    tx.activeTurn.set(turn('current', 2, msg('current-message')), 'generating');
    tx.history.replace([turn('previous', 1, msg('previous-message'))]);
    expect(tx.state.activeTurnSnapshot?.id).toBe('current');
    expect(tx.state.turnStatus).toBe('generating');
    expect(tx.findItemById('current-message')?.id).toBe('current-message');
    expect(tx.findItemById('previous-message')?.id).toBe('previous-message');
  });

  it('seed replaces committed turns and clears active turn', () => {
    const tx = createTranscript();
    drive(tx, { type: 'message_chunk', id: 'x', role: 'assistant', text: 'live' });
    tx.history.seed([turn('t1', 0, msg('a', 0)), turn('t2', 1, msg('b', 0))]);
    expect(tx.state.committedTurns.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(tx.state.activeTurnSnapshot).toBeNull();
  });

  it('prepends older turns before existing committed turns', () => {
    const tx = createTranscript();
    tx.history.seed([turn('t2', 2, msg('c', 0))]);
    tx.history.prepend([turn('t0', 0, msg('a', 0)), turn('t1', 1, msg('b', 0))]);
    expect(tx.state.committedTurns.map((t) => t.id)).toEqual(['t0', 't1', 't2']);
  });

  it('append adds turns after committed history', () => {
    const tx = createTranscript();
    tx.history.seed([turn('t0', 0, msg('a', 0))]);
    tx.history.append([turn('t1', 1, msg('b', 0)), turn('t2', 2, msg('c', 0))]);
    expect(tx.state.committedTurns.map((t) => t.id)).toEqual(['t0', 't1', 't2']);
  });
});

describe('activeTurn', () => {
  it('sets active turn snapshot and status', () => {
    const tx = createTranscript();
    tx.activeTurn.set(turn('active', 0, msg('x', 0)), 'generating');
    expect(tx.state.activeTurnSnapshot?.items).toHaveLength(1);
    expect(tx.state.activeTurnSnapshot?.items[0].id).toBe('x');
    expect(tx.state.turnStatus).toBe('generating');
  });

  it('reconcile patches in-place text growth for same item id', () => {
    const tx = createTranscript();
    tx.activeTurn.set(
      turn('active', 0, { kind: 'message', id: 'm1', seq: 0, role: 'assistant', text: 'Hello' }),
      'generating'
    );
    const ref1 = tx.state.activeTurnSnapshot!.items[0];
    tx.activeTurn.set(
      turn('active', 0, {
        kind: 'message',
        id: 'm1',
        seq: 0,
        role: 'assistant',
        text: 'Hello world',
      }),
      'generating'
    );
    expect(tx.state.activeTurnSnapshot!.items[0].id).toBe('m1');
    expect((tx.state.activeTurnSnapshot!.items[0] as ChatMessage).text).toBe('Hello world');
    expect((ref1 as ChatMessage).text).toBe('Hello world');
  });

  it('commit moves the active turn into committed turns and clears active state', () => {
    const tx = createTranscript();
    drive(tx, { type: 'message_chunk', id: 'a1', role: 'assistant', text: 'hi' });
    tx.activeTurn.commit('done');
    expect(tx.state.activeTurnSnapshot).toBeNull();
    expect(tx.state.turnStatus).toBe('done');
    expect(tx.findItemById('a1')).toBeDefined();
    expect(tx.state.committedTurns[0].outcome?.kind).toBe('done');
  });

  it('commit cancelled records cancelled outcome', () => {
    const tx = createTranscript();
    drive(tx, { type: 'message_chunk', id: 'a1', role: 'assistant', text: 'partial' });
    tx.activeTurn.commit('cancelled');
    expect(tx.state.turnStatus).toBe('cancelled');
    expect(tx.state.committedTurns[0].outcome?.kind).toBe('cancelled');
  });
});

describe('reset', () => {
  it('clears committed turns, active turn, and status', () => {
    const tx = createTranscript();
    tx.history.seed([turn('t1', 0, msg('a', 0))]);
    drive(tx, { type: 'message_chunk', id: 'c', role: 'assistant', text: 'hi' });
    tx.reset();
    expect(tx.state.committedTurns).toHaveLength(0);
    expect(tx.state.activeTurnSnapshot).toBeNull();
    expect(tx.state.turnStatus).toBe('done');
    expect(tx.findItemById('a')).toBeUndefined();
  });
});

const position = (
  historyRevision: number,
  lastCommittedTurnSeq: number | null,
  generation = 'one'
) => ({ generation, historyRevision, lastCommittedTurnSeq });
const page = (
  turns: TranscriptTurn[],
  historyRevision = 1,
  generation = 'one',
  fromSeq: number | null = null,
  beforeSeq: number | null = null
) => ({
  kind: 'available' as const,
  turns,
  nextCursor: fromSeq,
  position: position(historyRevision, turns.at(-1)?.seq ?? null, generation),
  coverage: { fromSeq, beforeSeq },
});

describe('versioned transcript reconciliation', () => {
  it('leaves the first history read to bootstrap and requests catch-up after later changes', () => {
    const tx = createTranscript();
    expect(tx.observe({ ...position(0, null), activeTurn: null })).toBe(false);
    expect(tx.needsHistory).toBe(true);
    tx.applyPage(page([], 0));
    expect(tx.needsHistory).toBe(false);
    expect(tx.observe({ ...position(1, 0), activeTurn: null })).toBe(true);
  });

  it('retains outgoing content without inventing an outcome or completing running tools', () => {
    const tx = createTranscript();
    const first: TranscriptTurn = {
      ...turn('one', 0, msg('user')),
      items: [
        {
          kind: 'execute-tool-call',
          id: 'tool',
          seq: 0,
          toolCallId: 'tool',
          title: 'Command',
          status: 'running',
        },
      ],
    };
    tx.observe({ ...position(0, null), activeTurn: first });
    tx.observe({ ...position(1, 0), activeTurn: turn('two', 1, msg('next')) });
    expect(tx.state.committedTurns).toEqual([]);
    expect(tx.state.displayTurns).toEqual([first]);
    expect(tx.state.displayTurns[0].outcome).toBeUndefined();
    expect(tx.findItemById('tool')).toMatchObject({ status: 'running' });
    tx.applyPage(page([{ ...first, outcome: { kind: 'cancelled' } }]));
    expect(tx.state.displayTurns).toHaveLength(1);
    expect(tx.state.displayTurns[0].outcome).toEqual({ kind: 'cancelled' });
    expect(tx.state.activeTurnSnapshot?.id).toBe('two');
  });

  it('does not drop an outgoing turn when an older initial page finally arrives', () => {
    const tx = createTranscript();
    tx.observe({ ...position(0, null), activeTurn: turn('one', 0, msg('first')) });
    tx.observe({ ...position(1, 0), activeTurn: turn('two', 1, msg('second')) });
    tx.applyPage(page([], 0));
    expect(tx.state.displayTurns.map((turn) => turn.id)).toEqual(['one']);
    expect(tx.needsHistory).toBe(true);
  });

  it('detects an entirely unobserved completed turn from the history revision', () => {
    const tx = createTranscript();
    tx.observe({ ...position(0, null), activeTurn: null });
    tx.applyPage(page([], 0));
    expect(tx.observe({ ...position(1, 0), activeTurn: null })).toBe(true);
    expect(tx.needsHistory).toBe(true);
    tx.applyPage(page([turn('one', 0, msg('first'))]));
    expect(tx.needsHistory).toBe(false);
  });

  it('merges pagination and latest refreshes without losing either end', () => {
    const tx = createTranscript();
    tx.applyPage(page([turn('recent', 5, msg('recent'))], 1, 'one', 5));
    tx.applyPage(page([turn('old', 0, msg('old'))], 1, 'one', null, 5));
    tx.applyPage(
      page(
        [turn('recent', 5, msg('recent', 0, 'amended')), turn('new', 6, msg('new'))],
        2,
        'one',
        5
      )
    );
    expect(tx.state.committedTurns.map((turn) => turn.id)).toEqual(['old', 'recent', 'new']);
    expect(tx.findItemById('recent')).toMatchObject({ text: 'amended' });
  });

  it('rejects an older page after an amendment, including deleted rows', () => {
    const tx = createTranscript();
    tx.applyPage(page([turn('one', 0, msg('first'))]));
    tx.applyPage(page([], 2));
    expect(tx.applyPage(page([turn('one', 0, msg('first'))]))).toBe(false);
    expect(tx.state.committedTurns).toEqual([]);
  });

  it('ignores unavailable history without clearing displayed turns', () => {
    const tx = createTranscript();
    tx.applyPage(page([turn('one', 0, msg('first'))]));
    expect(tx.applyPage({ kind: 'unavailable' })).toBe(false);
    expect(tx.state.committedTurns).toHaveLength(1);
  });

  it('retains observed content during suspension and replaces it after replay', () => {
    const tx = createTranscript();
    const active = turn('active', 1, msg('active'));
    tx.observe({ ...position(1, 0), activeTurn: active });
    tx.applyPage(page([turn('old', 0, msg('old'))]));

    expect(tx.observe(null)).toBe(false);
    expect(tx.needsHistory).toBe(false);
    expect(tx.state.activeTurnSnapshot).toBeNull();
    expect(tx.state.displayTurns.map((turn) => turn.id)).toEqual(['old', 'active']);
    // A delayed read cannot resurrect the live turn while the runtime is unavailable.
    tx.applyPage(page([turn('old', 0, msg('old'))]));
    expect(tx.state.activeTurnSnapshot).toBeNull();

    expect(tx.observe({ ...position(1, 0, 'replayed'), activeTurn: null })).toBe(true);
    expect(tx.state.displayTurns.map((turn) => turn.id)).toEqual(['old', 'active']);
    tx.applyPage(page([turn('restored', 0, msg('restored'))], 1, 'replayed'));
    expect(tx.state.displayTurns.map((turn) => turn.id)).toEqual(['restored']);
    expect(tx.needsHistory).toBe(false);
  });

  it('replaces generations atomically even when replay recreates identical ids', () => {
    const tx = createTranscript();
    const old = turn('same', 0, msg('same', 0, 'old'));
    tx.observe({ ...position(1, 0), activeTurn: turn('old-live', 1, msg('old-live')) });
    tx.applyPage(page([old]));
    tx.observe({ ...position(0, null, 'two'), activeTurn: turn('same', 0, msg('same', 0, 'new')) });
    expect(tx.state.committedTurns).toEqual([old]);
    expect(tx.state.activeTurnSnapshot?.id).toBe('old-live');
    tx.applyPage(page([], 0, 'two'));
    expect(tx.state.displayTurns).toEqual([]);
    expect(tx.state.activeTurnSnapshot?.items[0]).toMatchObject({ text: 'new' });
    expect(tx.applyPage(page([old], 999))).toBe(false);
    expect(tx.observe({ ...position(999, 0), activeTurn: old })).toBe(false);
    expect(tx.state.activeTurnSnapshot?.items[0]).toMatchObject({ text: 'new' });
  });

  it('does not merge generations when the transcript resets before the first history page', () => {
    const tx = createTranscript();
    const old = turn('old-live', 5, msg('old'));
    const current = turn('new-live', 0, msg('new'));
    tx.observe({ ...position(0, null), activeTurn: old });
    tx.observe({ ...position(0, null, 'two'), activeTurn: current });
    expect(tx.state.activeTurnSnapshot?.id).toBe('old-live');
    tx.applyPage(page([], 0, 'two'));
    expect(tx.state.displayTurns).toEqual([]);
    expect(tx.state.activeTurnSnapshot?.id).toBe('new-live');
  });

  it('ignores stale live snapshots after history has committed their turn', () => {
    const tx = createTranscript();
    const active = turn('one', 0, msg('one'));
    tx.observe({ ...position(0, null), activeTurn: active });
    tx.applyPage(page([active], 1));
    tx.observe({ ...position(0, null), activeTurn: active });
    expect(tx.state.activeTurnSnapshot).toBeNull();
    expect(tx.state.displayTurns).toHaveLength(1);
  });
});
