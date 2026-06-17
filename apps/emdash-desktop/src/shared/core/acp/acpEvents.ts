import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { defineEvent } from '@shared/lib/ipc/events';
import type { AcpTurn, SessionLifecycle } from './acpTurns';

/**
 * Forwarded from the main process whenever the ACP agent emits a
 * session/update notification.  Only emitted for the currently-active turn;
 * history is served via the getChatHistory RPC.
 */
export const acpSessionUpdateChannel = defineEvent<{
  conversationId: string;
  /** Turn this update belongs to (matches the current activeTurnId). */
  turnId: string;
  update: SessionUpdate;
  /** Monotonic per-conversation sequence number for cross-reload dedup. */
  seq: number;
}>('acp:session-update');

/** Emitted when the ACP agent subprocess exits or the connection closes. */
export const acpSessionClosedChannel = defineEvent<{
  conversationId: string;
  exitCode: number | null;
}>('acp:session-closed');

/**
 * Emitted when the session lifecycle changes (starting → replaying → ready →
 * working → closed) so the renderer can update isReady / isWorking without
 * polling.
 */
export const acpSessionStateChannel = defineEvent<{
  conversationId: string;
  lifecycle: SessionLifecycle;
  /** Non-null when lifecycle === 'working'. */
  activeTurnId: string | null;
}>('acp:session-state');

/**
 * Emitted when the active turn is committed to history (prompt() resolves or
 * rejects).  The renderer uses this to finalise streaming state.
 */
export const acpTurnCommittedChannel = defineEvent<{
  conversationId: string;
  turn: AcpTurn;
}>('acp:turn-committed');
