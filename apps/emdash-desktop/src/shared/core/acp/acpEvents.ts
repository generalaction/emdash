import type { AgentUpdate, AcpTerminalExit, AcpTurn, SessionSnapshot } from '@emdash/core/acp';
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
 * Emitted whenever session-level state changes (lifecycle, permissions, modes,
 * config options, available commands). Carries a full `SessionSnapshot` so the
 * renderer can apply it directly via `SessionMachine.applySnapshot`.
 */
export const acpSessionStateChannel = defineEvent<{
  conversationId: string;
  snapshot: SessionSnapshot;
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
