import type {
  AgentUpdate,
  AcpPermissionRequest,
  AcpTerminalExit,
  AcpTurn,
  SessionLifecycle,
} from '@emdash/core/acp';
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
  update: AgentUpdate;
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

/**
 * Emitted when the ACP agent creates a new terminal via the client terminal API.
 * The renderer can use this to show a terminal panel for the conversation.
 */
export const acpTerminalCreatedChannel = defineEvent<{
  conversationId: string;
  terminalId: string;
  command: string;
  args: string[];
  cwd: string;
}>('acp:terminal-created');

/**
 * Emitted for each chunk of output captured from a running terminal.
 * `truncated` is true once the ring-buffer byte limit has been exceeded and
 * older output has been discarded.  The renderer should treat this as a
 * streaming append to the terminal's output buffer.
 */
export const acpTerminalOutputChannel = defineEvent<{
  conversationId: string;
  terminalId: string;
  chunk: string;
  truncated: boolean;
}>('acp:terminal-output');

/**
 * Emitted when a terminal command exits.  The renderer should mark the
 * terminal as finished and display the exit status.
 */
export const acpTerminalExitChannel = defineEvent<{
  conversationId: string;
  terminalId: string;
  exitStatus: AcpTerminalExit;
}>('acp:terminal-exit');

/**
 * Emitted when a terminal is released (resources freed).
 * The renderer should remove the terminal panel for this terminalId.
 */
export const acpTerminalReleasedChannel = defineEvent<{
  conversationId: string;
  terminalId: string;
}>('acp:terminal-released');
