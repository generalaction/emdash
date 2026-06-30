/**
 * createStreamSmoother — opt-in data-layer cadence smoother for streaming text.
 *
 * Wraps a TranscriptApi and intercepts activeTurn.set. Bursty snapshots that
 * contain growing message text are buffered; the smoother re-delivers the text
 * one (or N) word(s) per tick so the per-word fade animation fires at even
 * intervals rather than in large bursts.
 *
 * Non-text activeTurn.set calls (tool starts, diff updates, etc.) pass through
 * immediately after flushing any pending text for affected message ids.
 * activeTurn.commit() flushes all pending text before delegating.
 *
 * Usage (host side):
 *   const smoother = createStreamSmoother(transcript);
 *   // Drive events via the helper, or via smoother.activeTurn.set directly:
 *   smoother.activeTurn.set(applyTurnEvent(smoother.activeTurn.get(), event), 'generating');
 *   smoother.activeTurn.commit('done');
 *   // — or use the convenience dispatch wrapper —
 *   smoother.dispatch(event);        // ActiveTurnEvent or turn_done/turn_cancelled
 *   smoother.dispose();              // cancel timers on teardown
 *
 * The smoother.activeTurn.get() returns the *desired* (full-text) snapshot so
 * that applyTurnEvent can extend it correctly even when the smoother has not yet
 * delivered all buffered words to the real transcript.
 *
 * The `scheduler` option accepts custom tick/cancel functions for deterministic
 * testing without real timers.
 */

import type { ChatItem, ChatMessage } from '@/model';
import type { TranscriptApi } from './transcript';
import type { TurnStatus } from './transcript';
import type { ActiveTurn } from './transcript';
import type { ActiveTurnEvent } from './turn-reducer';
import { applyTurnEvent } from './turn-reducer';

// ── Word splitting ─────────────────────────────────────────────────────────────

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
   * Tick interval in ms (default: 40 — ~25 fps).
   */
  intervalMs?: number;
  /**
   * Backlog size before catch-up kicks in (default: 8).
   * When backlog exceeds this, each tick releases `ceil(backlog / 4)` words.
   */
  catchUpThreshold?: number;
  /** Injectable scheduler for deterministic tests. Defaults to setInterval. */
  scheduler?: SmootherScheduler;
};

/** Full TranscriptEvent union for the convenience dispatch method. */
export type TranscriptEvent = ActiveTurnEvent | { type: 'turn_done' } | { type: 'turn_cancelled' };

export type StreamSmoother = TranscriptApi & {
  /**
   * Convenience wrapper: routes an event through applyTurnEvent and
   * activeTurn.set/commit. Equivalent to what a step-function helper does,
   * kept here so tests and the harness can still use a single dispatch call.
   */
  dispatch(event: TranscriptEvent): void;
  /** Cancel all pending timers and release resources. */
  dispose(): void;
};

// ── Default scheduler ─────────────────────────────────────────────────────────

const defaultScheduler: SmootherScheduler = {
  schedule(fn, intervalMs) {
    const id = setInterval(fn, intervalMs);
    return () => clearInterval(id);
  },
};

// ── Per-message buffer state ───────────────────────────────────────────────────

type MessageState = {
  /** Text that has been forwarded to the real transcript. */
  deliveredText: string;
  /** Word atoms buffered but not yet forwarded. */
  pendingWords: string[];
};

// ── createStreamSmoother ─────────────────────────────────────────────────────

/**
 * Wraps `target` with a per-word cadence smoother.
 *
 * Returns a full TranscriptApi so it can be used as a drop-in replacement
 * wherever TranscriptApi is expected (e.g. ScriptedChat.wrapTranscript).
 *
 * @param target - The real TranscriptApi to forward to.
 * @param opts   - Tuning parameters and optional test scheduler.
 */
export function createStreamSmoother(
  target: TranscriptApi,
  opts: StreamSmootherOptions = {}
): StreamSmoother {
  const {
    wordsPerTick = 1,
    intervalMs = 40,
    catchUpThreshold = 8,
    scheduler = defaultScheduler,
  } = opts;

  // Full desired snapshot — the last items passed to activeTurn.set.
  // activeTurn.get() returns this so callers can extend via applyTurnEvent.
  let desiredItems: ChatItem[] | null = null;
  // Last status passed to activeTurn.set (used when delivering tick updates).
  let currentStatus: TurnStatus = 'done';

  // Per streaming-message id → buffered delivery state.
  const messageStates = new Map<string, MessageState>();

  let cancelTick: (() => void) | null = null;

  // ── Snapshot builder ───────────────────────────────────────────────────────

  /** Build the partial snapshot: streaming messages use deliveredText, others pass through. */
  function buildPartialItems(): ChatItem[] | null {
    if (!desiredItems) return null;
    return desiredItems.map((item) => {
      if (item.kind === 'message' && (item as ChatMessage).streaming) {
        const ms = messageStates.get(item.id);
        if (ms) {
          return { ...item, text: ms.deliveredText } as ChatMessage;
        }
      }
      return item;
    });
  }

  // ── Tick ───────────────────────────────────────────────────────────────────

  function releaseTick() {
    let anyPending = false;

    for (const ms of messageStates.values()) {
      if (ms.pendingWords.length === 0) continue;
      anyPending = true;

      const backlog = ms.pendingWords.length;
      const releaseCount = backlog > catchUpThreshold ? Math.ceil(backlog / 4) : wordsPerTick;
      const atoms = ms.pendingWords.splice(0, releaseCount);
      ms.deliveredText += atoms.join('');
    }

    if (anyPending && desiredItems) {
      target.activeTurn.set(buildPartialItems(), currentStatus);
    }

    if (!anyPending) {
      cancelTick?.();
      cancelTick = null;
    }
  }

  function ensureTicking() {
    if (!cancelTick) {
      cancelTick = scheduler.schedule(releaseTick, intervalMs);
    }
  }

  // ── Flush helpers ──────────────────────────────────────────────────────────

  /** Synchronously deliver all pending words for all messages. */
  function flushAll() {
    for (const ms of messageStates.values()) {
      ms.deliveredText += ms.pendingWords.splice(0).join('');
    }
    cancelTick?.();
    cancelTick = null;
  }

  // ── Wrapped activeTurn API ─────────────────────────────────────────────────

  const wrappedActiveTurn: ActiveTurn = {
    // Return the DESIRED snapshot (not the partial delivered one) so callers
    // can safely call applyTurnEvent(activeTurn.get(), event) and get a
    // correct full-text base to extend.
    get() {
      return desiredItems;
    },

    status() {
      return target.activeTurn.status();
    },

    set(items, status) {
      currentStatus = status;

      if (items === null) {
        // Clearing the turn (e.g. after commit). Flush and propagate.
        flushAll();
        desiredItems = null;
        messageStates.clear();
        target.activeTurn.set(null, status);
        return;
      }

      // Compute text deltas for streaming messages and buffer new words.
      for (const item of items) {
        if (item.kind !== 'message' || !(item as ChatMessage).streaming) continue;
        const msg = item as ChatMessage;

        let ms = messageStates.get(msg.id);
        if (!ms) {
          ms = { deliveredText: '', pendingWords: [] };
          messageStates.set(msg.id, ms);
        }

        // "already accounted" = delivered + still-pending words
        const accounted =
          ms.deliveredText.length + ms.pendingWords.reduce((n, w) => n + w.length, 0);
        if (msg.text.length > accounted) {
          const newDelta = msg.text.slice(accounted);
          if (newDelta.length > 0) {
            ms.pendingWords.push(...splitWords(newDelta));
            ensureTicking();
          }
        }
      }

      desiredItems = [...items] as ChatItem[];

      // Forward the partial snapshot (delivered text only) to the real transcript.
      target.activeTurn.set(buildPartialItems(), status);
    },

    commit(status = 'done') {
      // Flush all buffers synchronously before delegating commit.
      flushAll();

      // Push the full desired snapshot before committing so the store has
      // the complete text (finalizeTurn in commit will settle streaming flags).
      if (desiredItems) {
        target.activeTurn.set(desiredItems, 'generating');
      }

      target.activeTurn.commit(status);

      desiredItems = null;
      messageStates.clear();
    },
  };

  // ── Convenience dispatch method ────────────────────────────────────────────

  function dispatch(event: TranscriptEvent) {
    if (event.type === 'turn_done') {
      wrappedActiveTurn.commit('done');
    } else if (event.type === 'turn_cancelled') {
      wrappedActiveTurn.commit('cancelled');
    } else {
      const current = wrappedActiveTurn.get();
      wrappedActiveTurn.set(applyTurnEvent(current, event), 'generating');
    }
  }

  function dispose() {
    cancelTick?.();
    cancelTick = null;
    messageStates.clear();
    desiredItems = null;
  }

  return {
    // history and non-activeTurn methods pass through unchanged.
    history: target.history,
    state: target.state,
    findIndexById: (id) => target.findIndexById(id),
    reset: () => {
      dispose();
      target.reset();
    },

    activeTurn: wrappedActiveTurn,
    dispatch,
    dispose,
  };
}
