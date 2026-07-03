/**
 * AcpTranscriptParser — stateful wrapper around the pure composite reducer.
 *
 * A single push() call folds one raw ACP SessionUpdate into all slices:
 *   - transcript (committed turns + active turn)
 *   - config     (modelOptions / efforts / modeOptions / availableCommands)
 *   - usage      (contextUsed / contextSize / cost)
 *   - title      (session info title)
 *
 * Two usage modes:
 *
 *   Live streaming (push / endTurn):
 *     const parser = new AcpTranscriptParser({ conversationId, transform });
 *     parser.push(sessionUpdate);
 *     parser.endTurn();             // called when prompt() resolves
 *     parser.history;               // committed turns
 *     parser.activeTurn;            // in-flight turn, or null
 *     parser.config;                // latest config state
 *     parser.usage;                 // latest usage, or null
 *     parser.title;                 // latest title, or null
 *
 *   Bounded replay (static):
 *     const result = AcpTranscriptParser.replay(updates, { conversationId, transform });
 *     result.transcript;            // TranscriptState (active === null)
 *     result.config;                // SessionConfigState
 *     result.usage;                 // SessionUsage | null
 *     result.title;                 // string | null
 *
 * Provider transform injection:
 *   Import decodeSessionUpdate and an optional EnrichHook, compose via
 *   composeTransform, and pass as the `transform` dep.
 */

import type { SessionUpdate } from '@agentclientprotocol/sdk';
import type { ProviderTransform } from './normalized-event';
import type { TranscriptState, TranscriptTurn } from './model';
import type { SessionConfigState, SessionUsage } from './session-model';
import { closeActive, initialState, reduce, type ParserState, type ReducerDeps } from './reducer';

export interface AcpTranscriptParserDeps {
  conversationId: string;
  transform: ProviderTransform;
}

export type ReplayResult = {
  transcript: TranscriptState;
  config: SessionConfigState;
  usage: SessionUsage | null;
  title: string | null;
};

export class AcpTranscriptParser {
  private state: ParserState;
  private readonly deps: ReducerDeps;

  constructor(deps: AcpTranscriptParserDeps) {
    this.state = initialState();
    this.deps = { ...deps, source: 'live' };
  }

  // ── Live streaming API ────────────────────────────────────────────────────

  /**
   * Feed one raw ACP SessionUpdate into the parser.
   * Routes to the appropriate slice (transcript or config/usage/title).
   * For transcript-affecting variants, may open or close a turn.
   */
  push(update: SessionUpdate): void {
    this.state = reduce(this.state, { kind: 'update', update }, this.deps);
  }

  /**
   * Explicitly close the active transcript turn.
   * Call this when prompt() resolves (stopReason is discarded — it belongs to
   * the session state machine, not the transcript).
   * No-op when there is no active turn.
   */
  endTurn(): void {
    this.state = reduce(this.state, { kind: 'close' }, this.deps);
  }

  /**
   * Reset all slices to their initial state.
   */
  reset(): void {
    this.state = initialState();
  }

  // ── Transcript access (backward-compatible) ───────────────────────────────

  /** All finalized, committed turns in chronological order. */
  get history(): readonly TranscriptTurn[] {
    return this.state.transcript.committed;
  }

  /** The in-flight turn, or null when the session is idle. */
  get activeTurn(): TranscriptTurn | null {
    return this.state.transcript.active;
  }

  /** Full transcript state snapshot (committed + active). */
  get snapshot(): TranscriptState {
    return this.state.transcript;
  }

  // ── Session slice access ──────────────────────────────────────────────────

  /** Latest materialized session config (models / efforts / modes / commands). */
  get config(): SessionConfigState {
    return this.state.config;
  }

  /** Latest context-window usage, or null until the first usage_update arrives. */
  get usage(): SessionUsage | null {
    return this.state.usage;
  }

  /** Latest session title from session_info_update, or null. */
  get title(): string | null {
    return this.state.title;
  }

  // ── Bounded replay (static) ───────────────────────────────────────────────

  /**
   * Fold a finite iterable of SessionUpdates and return all four slices.
   *
   * The trailing active transcript turn (if any) is closed at EOF — there is
   * no stopReason available during replay. Config / usage / title are returned
   * as-of the last update seen.
   *
   * @param updates  An iterable of raw ACP SessionUpdate notifications.
   * @param deps     conversationId + ProviderTransform.
   * @returns        { transcript (active===null), config, usage, title }
   */
  static replay(updates: Iterable<SessionUpdate>, deps: AcpTranscriptParserDeps): ReplayResult {
    const replayDeps: ReducerDeps = { ...deps, source: 'replay' };
    let state = initialState();

    for (const update of updates) {
      state = reduce(state, { kind: 'update', update }, replayDeps);
    }

    // Close the trailing active transcript turn at EOF.
    const transcript = closeActive(state.transcript);
    return {
      transcript,
      config: state.config,
      usage: state.usage,
      title: state.title,
    };
  }
}
