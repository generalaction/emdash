/**
 * createStreamSmoother — opt-in data-layer cadence smoother for streaming text.
 *
 * Wraps a `TranscriptApi` and intercepts `message_chunk` events. Bursty network
 * deltas are buffered and re-released one (or N) word(s) per tick at a steady
 * interval, so the per-word fade animation in Prose.tsx fires at even intervals
 * rather than in large bursts.
 *
 * Non-`message_chunk` events pass through immediately after flushing any pending
 * text for the relevant message, preserving global event ordering. `turn_done`
 * and `turn_cancelled` flush all buffers synchronously before forwarding.
 *
 * Usage (host side):
 *   const smoother = createStreamSmoother(transcript);
 *   smoother.dispatch(event);          // instead of transcript.dispatch(event)
 *   smoother.dispose();                // cancel timers on teardown
 *
 * The `scheduler` option accepts custom tick/cancel functions for deterministic
 * testing without real timers.
 */

import type { TranscriptApi, TranscriptEvent } from './transcript';

// ── Word splitting (mirrors chunkText 'word' mode) ────────────────────────────

/** Split text into alternating word/whitespace atoms (preserves all chars). */
function splitWords(text: string): string[] {
  return text.split(/(\s+)/).filter((a) => a.length > 0);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type SmootherScheduler = {
  /** Schedule a recurring callback at `intervalMs`. Returns a cancel fn. */
  schedule(fn: () => void, intervalMs: number): () => void;
};

export type StreamSmootherOptions = {
  /**
   * Target words to release per tick (default: 1).
   * Catch-up mode may release more when the backlog grows.
   */
  wordsPerTick?: number;
  /**
   * Tick interval in ms (default: 40 — ~25 fps, matches comfortable reading pace
   * at a typical ~150 wpm for single-word-per-tick).
   */
  intervalMs?: number;
  /**
   * Number of words in backlog before catch-up kicks in (default: 8).
   * When backlog exceeds this threshold, each tick releases `ceil(backlog / 4)`
   * words instead of `wordsPerTick` so display never lags far behind generation.
   */
  catchUpThreshold?: number;
  /** Injectable scheduler for deterministic tests. Defaults to setInterval. */
  scheduler?: SmootherScheduler;
};

// ── Default scheduler ─────────────────────────────────────────────────────────

const defaultScheduler: SmootherScheduler = {
  schedule(fn, intervalMs) {
    const id = setInterval(fn, intervalMs);
    return () => clearInterval(id);
  },
};

// ── Per-message word buffer ───────────────────────────────────────────────────

type MsgBuffer = {
  /** Queue of word atoms not yet forwarded. */
  words: string[];
  /** True once we've seen a turn_done or are flushing synchronously. */
  flushing: boolean;
};

// ── Smoother ──────────────────────────────────────────────────────────────────

export type StreamSmoother = TranscriptApi & {
  /** Cancel all pending timers and release resources. */
  dispose(): void;
};

/**
 * Wraps `target` with a per-word cadence smoother.
 *
 * @param target - The real TranscriptApi to forward events to.
 * @param opts   - Tuning parameters and optional test scheduler.
 */
export function createStreamSmoother(
  target: TranscriptApi,
  opts: StreamSmootherOptions = {},
): StreamSmoother {
  const {
    wordsPerTick = 1,
    intervalMs = 40,
    catchUpThreshold = 8,
    scheduler = defaultScheduler,
  } = opts;

  // Per-message id → pending word queue.
  const buffers = new Map<string, MsgBuffer>();

  let cancelTick: (() => void) | null = null;

  // ── Tick ────────────────────────────────────────────────────────────────────

  function releaseTick() {
    let anyPending = false;

    for (const [id, buf] of buffers.entries()) {
      if (buf.words.length === 0) continue;
      anyPending = true;

      // Catch-up: release proportionally more when the backlog is large.
      const backlog = buf.words.length;
      const releaseCount =
        backlog > catchUpThreshold ? Math.ceil(backlog / 4) : wordsPerTick;

      // Collect atoms to forward in this tick.
      const atoms = buf.words.splice(0, releaseCount);
      const text = atoms.join('');
      target.dispatch({ type: 'message_chunk', id, role: 'assistant', text });
    }

    // Stop the timer when nothing is buffered.
    if (!anyPending && cancelTick) {
      cancelTick();
      cancelTick = null;
    }
  }

  function ensureTicking() {
    if (!cancelTick) {
      cancelTick = scheduler.schedule(releaseTick, intervalMs);
    }
  }

  // ── Flush ───────────────────────────────────────────────────────────────────

  /** Synchronously forward all pending words for every buffered message. */
  function flushAll() {
    for (const [id, buf] of buffers.entries()) {
      if (buf.words.length === 0) continue;
      const text = buf.words.splice(0).join('');
      target.dispatch({ type: 'message_chunk', id, role: 'assistant', text });
    }
    buffers.clear();
    if (cancelTick) {
      cancelTick();
      cancelTick = null;
    }
  }

  /** Flush a single message's pending words before forwarding a non-chunk event for that id. */
  function flushId(id: string) {
    const buf = buffers.get(id);
    if (!buf || buf.words.length === 0) return;
    const text = buf.words.splice(0).join('');
    target.dispatch({ type: 'message_chunk', id, role: 'assistant', text });
    buffers.delete(id);
  }

  // ── dispatch ────────────────────────────────────────────────────────────────

  function dispatch(event: TranscriptEvent) {
    if (event.type === 'message_chunk') {
      const { id, role, text } = event;

      // Pass through non-text chunks or empty initial row-creation chunks immediately.
      if (!text) {
        target.dispatch(event);
        return;
      }

      // Buffer the words.
      let buf = buffers.get(id);
      if (!buf) {
        buf = { words: [], flushing: false };
        buffers.set(id, buf);
      }
      buf.words.push(...splitWords(text));
      ensureTicking();

      // Pass through any attachments by re-dispatching without text.
      if (event.attachments && event.attachments.length > 0) {
        target.dispatch({ type: 'message_chunk', id, role, text: '', attachments: event.attachments });
      }
      return;
    }

    // Turn-ending events: flush all pending buffers first.
    if (event.type === 'turn_done' || event.type === 'turn_cancelled') {
      flushAll();
      target.dispatch(event);
      return;
    }

    // Any event that references a specific id that has pending text: flush that id first
    // to preserve ordering (e.g. a tool event that follows the end of a message chunk run).
    if ('id' in event && typeof event.id === 'string' && buffers.has(event.id)) {
      flushId(event.id);
    }

    target.dispatch(event);
  }

  // ── Passthrough for non-dispatch API ────────────────────────────────────────

  function dispose() {
    if (cancelTick) {
      cancelTick();
      cancelTick = null;
    }
    buffers.clear();
  }

  return {
    get state() {
      return target.state;
    },
    seed: target.seed.bind(target),
    dispatch,
    reset: target.reset.bind(target),
    prependHistory: target.prependHistory.bind(target),
    findIndexById: target.findIndexById.bind(target),
    dispose,
  };
}
