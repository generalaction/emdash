/**
 * AcpTranscriptParser — stateful wrapper around the pure transcript reducer.
 *
 * Two usage modes:
 *
 *   Live streaming (push/endTurn):
 *     const parser = new AcpTranscriptParser({ conversationId, transform });
 *     parser.push(sessionUpdate);   // called for each notification
 *     parser.endTurn();             // called when prompt() resolves
 *     parser.history;               // committed turns
 *     parser.activeTurn;            // in-flight turn, or null
 *
 *   Bounded replay (static):
 *     const state = AcpTranscriptParser.replay(updates, { conversationId, transform });
 *     state.committed;              // all turns, including trailing
 *     state.active;                 // null (trailing turn closed at EOF)
 *
 * Provider transform injection:
 *   Import decodeSessionUpdate and an optional EnrichHook, compose via
 *   composeTransform, and pass as the `transform` dep. The parser itself
 *   has no provider-specific logic.
 */

import type { SessionUpdate } from '@agentclientprotocol/sdk';
import type { ProviderTransform } from './normalized-event';
import type { TranscriptState, TranscriptTurn } from './model';
import { closeActive, initialState, reduce, type ReducerDeps } from './reducer';

export interface AcpTranscriptParserDeps {
  conversationId: string;
  transform: ProviderTransform;
}

export class AcpTranscriptParser {
  private state: TranscriptState;
  private readonly deps: ReducerDeps;

  constructor(deps: AcpTranscriptParserDeps) {
    this.state = initialState();
    this.deps = { ...deps, source: 'live' };
  }

  // ── Live streaming API ────────────────────────────────────────────────────

  /**
   * Feed one raw ACP SessionUpdate into the parser.
   * May open a new turn (user message) or fold content into the active turn.
   */
  push(update: SessionUpdate): void {
    this.state = reduce(this.state, { kind: 'update', update }, this.deps);
  }

  /**
   * Explicitly close the active turn.
   * Call this when prompt() resolves (the stopReason itself is discarded here —
   * it belongs to the session state machine, not the transcript).
   * No-op when there is no active turn.
   */
  endTurn(): void {
    this.state = reduce(this.state, { kind: 'close' }, this.deps);
  }

  /**
   * Reset all state. Use before restarting a session or in tests.
   */
  reset(): void {
    this.state = initialState();
  }

  // ── Read access ───────────────────────────────────────────────────────────

  /** All finalized, committed turns in chronological order. */
  get history(): readonly TranscriptTurn[] {
    return this.state.committed;
  }

  /** The in-flight turn, or null when the session is idle. */
  get activeTurn(): TranscriptTurn | null {
    return this.state.active;
  }

  /** Full transcript state snapshot (committed + active). */
  get snapshot(): TranscriptState {
    return this.state;
  }

  /**
   * Fold a finite iterable of SessionUpdates into a TranscriptState.
   *
   * Turn boundaries are derived from user messages in the stream. The trailing
   * active turn (if any) is closed at EOF — there is no stopReason available
   * during replay. Use the instance push/endTurn API for live streaming.
   *
   * @param updates  An iterable of raw ACP SessionUpdate notifications.
   * @param deps     conversationId + ProviderTransform.
   * @returns        A TranscriptState with `active === null`.
   */
  static replay(
    updates: Iterable<SessionUpdate>,
    deps: AcpTranscriptParserDeps
  ): TranscriptState {
    const replayDeps: ReducerDeps = { ...deps, source: 'replay' };
    let state = initialState();

    for (const update of updates) {
      state = reduce(state, { kind: 'update', update }, replayDeps);
    }

    // Close the trailing active turn at EOF.
    state = closeActive(state);

    return state;
  }
}
