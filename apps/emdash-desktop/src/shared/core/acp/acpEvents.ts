import type { SessionUpdate } from '@agentclientprotocol/sdk';
import type { AcpPermissionRequest } from '@emdash/core/acp';
import type { AcpTurn, SessionLifecycle } from '@emdash/core/acp';
import { defineEvent } from '@shared/lib/ipc/events';

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

/**
 * Emitted when an ACP agent requests user permission to execute a tool call.
 * The renderer should add this to its FIFO permission queue and show the band.
 */
export const acpPermissionRequestChannel =
  defineEvent<AcpPermissionRequest>('acp:permission-request');

/**
 * Emitted when a pending permission request has been resolved (either by the
 * user's choice or by a session close/cancel draining the queue).
 * The renderer should remove the matching requestId from its queue.
 */
export const acpPermissionResolvedChannel = defineEvent<{
  conversationId: string;
  requestId: string;
}>('acp:permission-resolved');
