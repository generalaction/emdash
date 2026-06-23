/**
 * createStreamSmoother — unit tests.
 *
 * Uses an injected synchronous scheduler so no real timers are needed and
 * tests are fully deterministic.
 */

import { describe, expect, it, vi } from 'vitest';
import type { SmootherScheduler } from './stream-smoother';
import { createStreamSmoother } from './stream-smoother';
import { createTranscript } from './transcript';
import type { TranscriptEvent } from './transcript';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** A synchronous scheduler: tick() fires the callback immediately on demand. */
function makeSyncScheduler(): SmootherScheduler & { tick(): void; cancelCount: number } {
  let fn: (() => void) | null = null;
  const cancelCount = 0;
  return {
    cancelCount,
    schedule(cb) {
      fn = cb;
      return () => {
        fn = null;
        this.cancelCount++;
      };
    },
    tick() {
      fn?.();
    },
  };
}

/** Collect dispatched events from a transcript. */
function collectEvents(transcript: ReturnType<typeof createTranscript>): TranscriptEvent[] {
  const events: TranscriptEvent[] = [];
  const orig = transcript.dispatch.bind(transcript);
  vi.spyOn(transcript, 'dispatch').mockImplementation((evt) => {
    events.push(evt);
    orig(evt);
  });
  return events;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createStreamSmoother — buffering', () => {
  it('passes empty initial message_chunk through immediately (row creation)', () => {
    const tx = createTranscript();
    const sched = makeSyncScheduler();
    const events = collectEvents(tx);
    const smoother = createStreamSmoother(tx, { scheduler: sched });

    smoother.dispatch({ type: 'message_chunk', id: 'a', role: 'assistant', text: '' });

    // Empty chunk forwarded synchronously, nothing buffered.
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'message_chunk', text: '' });

    // Tick has no pending words → no additional events.
    sched.tick();
    expect(events).toHaveLength(1);
  });

  it('buffers words and releases one atom per tick', () => {
    const tx = createTranscript();
    const sched = makeSyncScheduler();
    const events = collectEvents(tx);
    const smoother = createStreamSmoother(tx, { scheduler: sched, wordsPerTick: 1 });

    // Row creation.
    smoother.dispatch({ type: 'message_chunk', id: 'a', role: 'assistant', text: '' });
    events.length = 0; // clear creation event

    // Feed 3 words in one chunk.
    // splitWords splits 'one two three' into 5 atoms: ['one', ' ', 'two', ' ', 'three']
    smoother.dispatch({ type: 'message_chunk', id: 'a', role: 'assistant', text: 'one two three' });
    // Not forwarded yet.
    expect(events).toHaveLength(0);

    // First tick: one atom released.
    sched.tick();
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]).toMatchObject({ type: 'message_chunk', id: 'a' });

    // Drain all remaining atoms.
    for (let i = 0; i < 10; i++) sched.tick();

    // Full text forwarded across all ticks.
    const forwarded = events.map((e) => ('text' in e ? e.text : '')).join('');
    expect(forwarded).toBe('one two three');
  });

  it('concatenation of forwarded chunks equals the original text', () => {
    const tx = createTranscript();
    const sched = makeSyncScheduler();
    const events = collectEvents(tx);
    const smoother = createStreamSmoother(tx, { scheduler: sched, wordsPerTick: 1 });

    const original = 'Hello world, this is a test sentence.';
    smoother.dispatch({ type: 'message_chunk', id: 'b', role: 'assistant', text: '' });
    smoother.dispatch({ type: 'message_chunk', id: 'b', role: 'assistant', text: original });
    events.length = 0;

    // Drain all ticks.
    for (let i = 0; i < 100; i++) sched.tick();

    const reassembled = events
      .filter((e) => e.type === 'message_chunk' && 'text' in e)
      .map((e) => ('text' in e ? e.text : ''))
      .join('');
    expect(reassembled).toBe(original);
  });
});

describe('createStreamSmoother — catch-up', () => {
  it('releases more words per tick when backlog exceeds threshold', () => {
    const tx = createTranscript();
    const sched = makeSyncScheduler();
    const events = collectEvents(tx);
    const smoother = createStreamSmoother(tx, {
      scheduler: sched,
      wordsPerTick: 1,
      catchUpThreshold: 4,
    });

    smoother.dispatch({ type: 'message_chunk', id: 'c', role: 'assistant', text: '' });

    // 10 words → exceeds catchUpThreshold (4) → first tick should release ceil(10/4) = 3
    const tenWords = 'a b c d e f g h i j';
    smoother.dispatch({ type: 'message_chunk', id: 'c', role: 'assistant', text: tenWords });
    events.length = 0;

    sched.tick();
    // Should have forwarded > 1 event worth of words in one tick.
    const forwarded = events
      .map((e) => ('text' in e ? e.text : ''))
      .join('');
    // At least 2 words released (catch-up releases ceil(backlog/4) = 3 or more atoms).
    const wordCount = forwarded.trim().split(/\s+/).filter(Boolean).length;
    expect(wordCount).toBeGreaterThan(1);
  });
});

describe('createStreamSmoother — turn_done flush', () => {
  it('flushes all pending words before forwarding turn_done', () => {
    const tx = createTranscript();
    const sched = makeSyncScheduler();
    const events = collectEvents(tx);
    const smoother = createStreamSmoother(tx, { scheduler: sched, wordsPerTick: 1 });

    smoother.dispatch({ type: 'message_chunk', id: 'd', role: 'assistant', text: '' });
    smoother.dispatch({ type: 'message_chunk', id: 'd', role: 'assistant', text: 'hello world' });
    events.length = 0;

    // turn_done without any ticks → must flush synchronously.
    smoother.dispatch({ type: 'turn_done' });

    const chunkEvents = events.filter((e) => e.type === 'message_chunk');
    const doneEvents = events.filter((e) => e.type === 'turn_done');

    // Words flushed before turn_done.
    expect(chunkEvents.length).toBeGreaterThan(0);
    expect(doneEvents).toHaveLength(1);

    // turn_done is the last event.
    expect(events[events.length - 1]).toMatchObject({ type: 'turn_done' });

    const flushedText = chunkEvents.map((e) => ('text' in e ? e.text : '')).join('');
    expect(flushedText).toBe('hello world');
  });

  it('flushes all pending words before forwarding turn_cancelled', () => {
    const tx = createTranscript();
    const sched = makeSyncScheduler();
    const events = collectEvents(tx);
    const smoother = createStreamSmoother(tx, { scheduler: sched, wordsPerTick: 1 });

    smoother.dispatch({ type: 'message_chunk', id: 'e', role: 'assistant', text: '' });
    smoother.dispatch({ type: 'message_chunk', id: 'e', role: 'assistant', text: 'foo bar baz' });
    events.length = 0;

    smoother.dispatch({ type: 'turn_cancelled' });

    const chunkEvents = events.filter((e) => e.type === 'message_chunk');
    const cancelEvents = events.filter((e) => e.type === 'turn_cancelled');

    expect(cancelEvents).toHaveLength(1);
    expect(events[events.length - 1]).toMatchObject({ type: 'turn_cancelled' });
    const flushedText = chunkEvents.map((e) => ('text' in e ? e.text : '')).join('');
    expect(flushedText).toBe('foo bar baz');
  });
});

describe('createStreamSmoother — ordering with non-message events', () => {
  it('flushes pending text for a message before forwarding a non-chunk event with the same id', () => {
    const tx = createTranscript();
    const sched = makeSyncScheduler();
    const events = collectEvents(tx);
    const smoother = createStreamSmoother(tx, { scheduler: sched, wordsPerTick: 1 });

    smoother.dispatch({ type: 'message_chunk', id: 'f', role: 'assistant', text: '' });
    smoother.dispatch({ type: 'message_chunk', id: 'f', role: 'assistant', text: 'pending text' });
    events.length = 0;

    // A tool_start with the same id (contrived but tests the ordering guarantee).
    smoother.dispatch({ type: 'tool_start', id: 'f', name: 'SomeTool' });

    const chunkIdx = events.findIndex((e) => e.type === 'message_chunk');
    const toolIdx = events.findIndex((e) => e.type === 'tool_start');

    // Flushed chunk comes before the tool event.
    expect(chunkIdx).toBeGreaterThanOrEqual(0);
    expect(toolIdx).toBeGreaterThan(chunkIdx);
  });

  it('passes through unrelated events without flushing other buffers', () => {
    const tx = createTranscript();
    const sched = makeSyncScheduler();
    const events = collectEvents(tx);
    const smoother = createStreamSmoother(tx, { scheduler: sched, wordsPerTick: 1 });

    smoother.dispatch({ type: 'message_chunk', id: 'g', role: 'assistant', text: '' });
    smoother.dispatch({ type: 'message_chunk', id: 'g', role: 'assistant', text: 'buffered' });
    events.length = 0;

    // Event with a different id — should not trigger flush of 'g'.
    smoother.dispatch({ type: 'tool_start', id: 'tool-1', name: 'OtherTool' });

    const chunkEvents = events.filter((e) => e.type === 'message_chunk');
    const toolEvents = events.filter((e) => e.type === 'tool_start');

    // 'g' not flushed yet.
    expect(chunkEvents).toHaveLength(0);
    expect(toolEvents).toHaveLength(1);
  });
});

describe('createStreamSmoother — dispose', () => {
  it('cancels the timer on dispose', () => {
    const tx = createTranscript();
    const sched = makeSyncScheduler();
    collectEvents(tx);
    const smoother = createStreamSmoother(tx, { scheduler: sched, wordsPerTick: 1 });

    smoother.dispatch({ type: 'message_chunk', id: 'h', role: 'assistant', text: 'hello world' });
    smoother.dispose();

    // Ticking after dispose should produce nothing.
    const events = collectEvents(tx);
    sched.tick();
    expect(events).toHaveLength(0);
  });
});
