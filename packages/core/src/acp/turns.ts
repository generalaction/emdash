/**
 * Shared turn model for ACP conversation history.
 *
 * AcpSessionRuntime is the single authority on turn state: it owns history
 * (committed turns) and the at-most-one active turn, committing turns via
 * prompt() stopReason.  The renderer queries this data on mount rather than
 * reconstructing it from a replay event stream.
 */

import type {
  AvailableCommand,
  SessionConfigOption,
  SessionModeState,
  StopReason,
} from '@agentclientprotocol/sdk';
import type { AgentUpdate } from './agent-update';
import type { AcpPermissionRequest } from './permissions';

/**
 * An image to include in a prompt, sent to the agent as an ACP `image` content
 * block. `data` is raw base64 (no `data:` URL prefix); `mimeType` is the image
 * media type (e.g. `image/png`).
 */
export interface AcpPromptImage {
  data: string;
  mimeType: string;
}

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
  updates: { seq: number; update: AgentUpdate }[];
  /**
   * The ACP stop reason for this turn. Non-null only for committed turns that
   * ended via a stopReason. Null for active turns, error turns, or replay turns.
   * Preserved so the composer can render the correct notice band (e.g.
   * max_tokens, max_turn_requests, refusal).
   */
  stopReason: StopReason | null;
}

/**
 * Coarse lifecycle of a conversation's ACP session.
 *
 * Transitions:
 *   starting → replaying | ready
 *   replaying → ready
 *   ready → working | closed
 *   working → cancelling | ready | closed
 *   cancelling → ready | closed
 */
export type SessionLifecycle =
  | 'starting'
  | 'replaying'
  | 'ready'
  | 'working'
  | 'cancelling'
  | 'closed';

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

/**
 * Lean snapshot of session-level state suitable for IPC mirroring to the
 * renderer. Excludes the heavy turn update stream (`activeTurn.updates`) —
 * the renderer tracks the transcript separately via the turn-update channel.
 */
export interface SessionSnapshot {
  lifecycle: SessionLifecycle;
  /** Id of the in-flight turn, if any. */
  activeTurnId: string | null;
  pendingPermissions: AcpPermissionRequest[];
  modes: SessionModeState | null;
  configOptions: SessionConfigOption[];
  availableCommands: AvailableCommand[];
  lastStopReason: StopReason | null;
}

/** Project `SessionState` down to a `SessionSnapshot` (drops the full activeTurn). */
export function toSessionSnapshot(s: SessionState): SessionSnapshot {
  return {
    lifecycle: s.lifecycle,
    activeTurnId: s.activeTurn?.id ?? null,
    pendingPermissions: s.pendingPermissions,
    modes: s.modes,
    configOptions: s.configOptions,
    availableCommands: s.availableCommands,
    lastStopReason: s.lastStopReason,
  };
}

/** Current session state returned by getSessionState(). */
export interface SessionState {
  lifecycle: SessionLifecycle;
  /** The in-flight turn, if any. */
  activeTurn: AcpTurn | null;
  /**
   * FIFO queue of pending permission requests awaiting user resolution.
   * Persisted in main-process memory so a renderer reload can rehydrate the
   * queue from this bootstrap response and show the permission band again.
   */
  pendingPermissions: AcpPermissionRequest[];
  /**
   * Agent-advertised session modes. Null if the agent doesn't support modes
   * or the session hasn't been established yet.
   */
  modes: SessionModeState | null;
  /**
   * Full set of session config options as reported by the agent. The model
   * selector is an option with category === 'model'. Authoritative — derived
   * from newSession/loadSession responses and updated by notifications.
   */
  configOptions: SessionConfigOption[];
  /** Slash commands the agent currently supports. */
  availableCommands: AvailableCommand[];
  /**
   * The stop reason from the last completed turn. Null on first start or if
   * no turn has completed yet. Drives the composer's notice band.
   */
  lastStopReason: StopReason | null;
}
