/**
 * createStreamSmoother — unit tests.
 *
 * Uses an injected synchronous scheduler so no real timers are needed and
 * tests are fully deterministic.
 *
 * The smoother wraps a target TranscriptApi.  We observe the underlying
 * transcript via `collectSets` which wraps `transcript.activeTurn.set` and
 * captures every (items, status) pair the smoother forwards.
 */

import { describe, expect, it } from 'vitest';
import type { ChatItem } from '@/model';
import type { SmootherScheduler } from './stream-smoother';
import { createStreamSmoother } from './stream-smoother';
import type { TurnStatus } from './transcript';
import { createTranscript } from './transcript';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** A synchronous scheduler: tick() fires the callback immediately on demand. */
function makeSyncScheduler(): SmootherScheduler & { tick(): void } {
  let fn: (() => void) | null = null;
  return {
    schedule(cb) {
      fn = cb;
      return () => {
        fn = null;
      };
    },
    tick() {
      fn?.();
    },
  };
}

type SetCall = { items: readonly ChatItem[] | null; status: TurnStatus };

/**
 * Wrap `transcript.activeTurn.set` and capture every call made by the smoother.
 * Returns the mutable capture array so callers can inspect and reset it.
 */
function collectSets(transcript: ReturnType<typeof createTranscript>): SetCall[] {
  const calls: SetCall[] = [];
  const origSet = transcript.activeTurn.set.bind(transcript.activeTurn);
  transcript.activeTurn.set = (items, status) => {
    calls.push({ items, status });
    origSet(items, status);
  };
  return calls;
}

/** Return the text of the first message item in a snapshot, or '' if absent. */
function firstMsgText(items: readonly ChatItem[] | null): string {
  if (!items) return '';
  const msg = items.find((it) => it.kind === 'message' && it.role === 'assistant');
  return msg && msg.kind === 'message' ? msg.text : '';
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createStreamSmoother — buffering', () => {
  it('passes empty initial message_chunk through immediately (row creation)', () => {
    const tx = createTranscript();
    const sched = makeSyncScheduler();
    const sets = collectSets(tx);
    const smoother = createStreamSmoother(tx, { scheduler: sched });

    smoother.dispatch({ type: 'message_chunk', id: 'a', role: 'assistant', text: '' });

    // Empty chunk forwarded synchronously: one activeTurn.set with empty message.
    expect(sets).toHaveLength(1);
    expect(firstMsgText(sets[0].items)).toBe('');

    // Tick has no pending words → no additional sets.
    sched.tick();
    expect(sets).toHaveLength(1);
  });

  it('buffers words and releases one atom per tick', () => {
    const tx = createTranscript();
    const sched = makeSyncScheduler();
    const sets = collectSets(tx);
    const smoother = createStreamSmoother(tx, { scheduler: sched, wordsPerTick: 1 });

    // Row creation.
    smoother.dispatch({ type: 'message_chunk', id: 'a', role: 'assistant', text: '' });
    sets.length = 0; // clear creation set

    // Feed 3 words in one chunk — atoms: ['one', ' ', 'two', ' ', 'three']
    smoother.dispatch({ type: 'message_chunk', id: 'a', role: 'assistant', text: 'one two three' });
    // The smoother forwards a partial snapshot immediately (delivered text = '' still).
    expect(sets).toHaveLength(1);
    expect(firstMsgText(sets[0].items)).toBe('');
    sets.length = 0;

    // First tick: one atom released → activeTurn.set called once with 'one'.
    sched.tick();
    expect(sets.length).toBeGreaterThanOrEqual(1);
    expect(firstMsgText(sets[0].items)).toBe('one');

    // Drain all remaining atoms.
    for (let i = 0; i < 10; i++) sched.tick();

    // Final text equals the full original.
    const delivered = firstMsgText(sets[sets.length - 1].items);
    expect(delivered).toBe('one two three');
  });

  it('delivered text after draining equals the original', () => {
    const tx = createTranscript();
    const sched = makeSyncScheduler();
    const sets = collectSets(tx);
    const smoother = createStreamSmoother(tx, { scheduler: sched, wordsPerTick: 1 });

    const original = 'Hello world, this is a test sentence.';
    smoother.dispatch({ type: 'message_chunk', id: 'b', role: 'assistant', text: '' });
    smoother.dispatch({ type: 'message_chunk', id: 'b', role: 'assistant', text: original });
    // Clear all sets so far (including the partial-forward from the dispatch above).
    sets.length = 0;

    // Drain all ticks.
    for (let i = 0; i < 100; i++) sched.tick();

    const delivered = firstMsgText(sets[sets.length - 1].items);
    expect(delivered).toBe(original);
  });
});

describe('createStreamSmoother — catch-up', () => {
  it('releases more atoms per tick when backlog exceeds threshold', () => {
    const tx = createTranscript();
    const sched = makeSyncScheduler();
    const sets = collectSets(tx);
    const smoother = createStreamSmoother(tx, {
      scheduler: sched,
      wordsPerTick: 1,
      catchUpThreshold: 4,
    });

    smoother.dispatch({ type: 'message_chunk', id: 'c', role: 'assistant', text: '' });

    // 10 words → exceeds catchUpThreshold (4) → first tick should release > 1 atom.
    const tenWords = 'a b c d e f g h i j';
    smoother.dispatch({ type: 'message_chunk', id: 'c', role: 'assistant', text: tenWords });
    sets.length = 0;

    sched.tick();
    // Should have forwarded at least 2 word atoms (catch-up).
    const delivered = firstMsgText(sets[sets.length - 1]?.items ?? null);
    const wordCount = delivered.trim().split(/\s+/).filter(Boolean).length;
    expect(wordCount).toBeGreaterThan(1);
  });
});

describe('createStreamSmoother — commit flush', () => {
  it('flushes all pending words before forwarding commit(done)', () => {
    const tx = createTranscript();
    const sched = makeSyncScheduler();
    const sets = collectSets(tx);
    const smoother = createStreamSmoother(tx, { scheduler: sched, wordsPerTick: 1 });

    smoother.dispatch({ type: 'message_chunk', id: 'd', role: 'assistant', text: '' });
    smoother.dispatch({ type: 'message_chunk', id: 'd', role: 'assistant', text: 'hello world' });
    sets.length = 0;

    // turn_done via dispatch (convenience wrapper) — must flush synchronously.
    smoother.dispatch({ type: 'turn_done' });

    // At least one activeTurn.set call must have happened (full text flushed).
    expect(sets.length).toBeGreaterThan(0);

    // The final delivered text should equal the original.
    const lastSetBeforeCommit = sets[sets.length - 1];
    const delivered = firstMsgText(lastSetBeforeCommit.items);
    expect(delivered).toBe('hello world');

    // The committed history should now contain the message.
    const committed = tx.state.committed;
    const msg = committed.find((it) => it.kind === 'message' && it.id === 'd');
    expect(msg).toBeDefined();
  });

  it('flushes all pending words before forwarding commit(cancelled)', () => {
    const tx = createTranscript();
    const sched = makeSyncScheduler();
    const sets = collectSets(tx);
    const smoother = createStreamSmoother(tx, { scheduler: sched, wordsPerTick: 1 });

    smoother.dispatch({ type: 'message_chunk', id: 'e', role: 'assistant', text: '' });
    smoother.dispatch({ type: 'message_chunk', id: 'e', role: 'assistant', text: 'foo bar baz' });
    sets.length = 0;

    smoother.dispatch({ type: 'turn_cancelled' });

    // Full text flushed.
    expect(sets.length).toBeGreaterThan(0);
    const delivered = firstMsgText(sets[sets.length - 1].items);
    expect(delivered).toBe('foo bar baz');

    // Committed history has the message.
    const committed = tx.state.committed;
    expect(committed.some((it) => it.kind === 'message' && it.id === 'e')).toBe(true);
  });
});

describe('createStreamSmoother — ordering with non-message events', () => {
  it('forwards non-chunk events without flushing unrelated message buffers', () => {
    const tx = createTranscript();
    const sched = makeSyncScheduler();
    const sets = collectSets(tx);
    const smoother = createStreamSmoother(tx, { scheduler: sched, wordsPerTick: 1 });

    smoother.dispatch({ type: 'message_chunk', id: 'g', role: 'assistant', text: '' });
    smoother.dispatch({ type: 'message_chunk', id: 'g', role: 'assistant', text: 'buffered' });
    sets.length = 0;

    // Event with a different id — should not flush 'g'.
    smoother.dispatch({ type: 'tool_start', id: 'tool-1', name: 'OtherTool' });

    // The forwarded set should contain a tool item, not the buffered message text.
    const lastItems = sets[sets.length - 1]?.items ?? [];
    const toolItem = lastItems.find((it) => it.kind === 'tool' && it.id === 'tool-1');
    expect(toolItem).toBeDefined();
    // The message text is still partially delivered (only initial empty was forwarded).
    const msgText = firstMsgText(lastItems);
    expect(msgText).toBe('');
  });
});

describe('createStreamSmoother — activeTurn.get returns desired state', () => {
  it('get() returns full text even before smoother has ticked', () => {
    const tx = createTranscript();
    const sched = makeSyncScheduler();
    const smoother = createStreamSmoother(tx, { scheduler: sched, wordsPerTick: 1 });

    smoother.dispatch({ type: 'message_chunk', id: 'm', role: 'assistant', text: '' });
    smoother.dispatch({ type: 'message_chunk', id: 'm', role: 'assistant', text: 'full text' });

    // get() returns the desired (full) snapshot immediately, not the partial delivered one.
    const desired = smoother.activeTurn.get();
    expect(firstMsgText(desired)).toBe('full text');
  });
});

describe('createStreamSmoother — dispose', () => {
  it('cancels the timer on dispose — no further sets after dispose', () => {
    const tx = createTranscript();
    const sched = makeSyncScheduler();
    const sets = collectSets(tx);
    const smoother = createStreamSmoother(tx, { scheduler: sched, wordsPerTick: 1 });

    smoother.dispatch({ type: 'message_chunk', id: 'h', role: 'assistant', text: 'hello world' });
    smoother.dispose();

    sets.length = 0;
    sched.tick();
    // No sets after dispose.
    expect(sets).toHaveLength(0);
  });
});
