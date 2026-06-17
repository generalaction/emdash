/**
 * Shared turn model for ACP conversation history.
 *
 * AcpSessionManager is the single authority on turn state: it owns history
 * (committed turns) and the at-most-one active turn, committing turns via
 * prompt() stopReason.  The renderer queries this data on mount rather than
 * reconstructing it from a replay event stream.
 */

import type { SessionUpdate } from '@agentclientprotocol/sdk';

/** Final state of a turn once it leaves the active slot. */
export type TurnStatus = 'active' | 'complete' | 'error' | 'cancelled';

/**
 * How the turn was driven.
 * - `live`   – originated from a prompt() call initiated by the user.
 * - `replay` – originated from a loadSession replay (app restart / cold start).
 */
export type TurnSource = 'live' | 'replay';

/** A single prompt–response exchange, with its ordered SessionUpdate stream. */
export interface AcpTurn {
  id: string;
  status: TurnStatus;
  source: TurnSource;
  /** Conversation-global seq of the first update in this turn. */
  startSeq: number;
  /** Conversation-global seq after the last update (null while active). */
  endSeq: number | null;
  updates: { seq: number; update: SessionUpdate }[];
}

/**
 * Coarse lifecycle of a conversation's ACP session.
 *
 * Transitions:
 *   starting → replaying | ready
 *   replaying → ready
 *   ready → working | closed
 *   working → ready | closed
 */
export type SessionLifecycle = 'starting' | 'replaying' | 'ready' | 'working' | 'closed';

/** The committed history snapshot returned by getChatHistory(). */
export interface ChatHistory {
  /** Committed turns only (status !== 'active'). */
  turns: AcpTurn[];
  /**
   * False while the session is still starting or a loadSession replay is in
   * flight — the renderer can show a loading state in this window.
   */
  complete: boolean;
}

/** Current session state returned by getSessionState(). */
export interface SessionState {
  lifecycle: SessionLifecycle;
  /** The in-flight turn, if any. */
  activeTurn: AcpTurn | null;
  /** Currently selected model (null if none configured). */
  model: string | null;
}
