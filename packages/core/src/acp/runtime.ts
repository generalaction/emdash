import { Logger } from '@emdash/shared/logger';
import type { Result } from '@emdash/shared/result';
import type { IAcpBehavior } from '../agents/plugins/capabilities/acp';
import type { AgentUpdate } from './agent-update';
import type { AcpRuntimeError } from './errors';
import type { AcpPromptImage, AcpTurn, ChatHistory, SessionSnapshot, SessionState } from './state';
import type { TerminalSnapshot } from './terminals';
import type { AcpProcessHost, AcpTerminalExit } from './transport';

/**
 * Minimal per-conversation input to AcpSessionRuntime.start().
 * Replaces the desktop Conversation row so the runtime stays core-only.
 */
export interface AcpStartInput {
  conversationId: string;
  projectId: string;
  taskId: string;
  providerId: string;
  workspaceId: string;
  cwd: string;
  sessionId: string | null;
  model: string | null;
  initialPrompt?: string;
}

/**
 * Narrow resolver injected into AcpSessionRuntime.
 * Returns the ACP behavior for the given provider, or null if unsupported.
 * The desktop adapter wraps getPlugin + capability check; tests inject a stub.
 */
export type ResolveAcpProvider = (providerId: string) => { behavior: IAcpBehavior } | null;

/**
 * Outbound event sink injected into AcpSessionRuntime.
 * The desktop adapter maps these calls onto the IPC typed-event channels.
 * Keeps the runtime free of @main IPC imports.
 */
export interface AcpRuntimeListener {
  /**
   * Session-level state changed (lifecycle, permissions, modes, config options,
   * available commands). Carries a full `SessionSnapshot` so the renderer can
   * apply it directly without a follow-up RPC call.
   * Replaces the previous `onState`, `onPermissionRequest`,
   * `onPermissionResolved`, and `onSessionMeta` callbacks.
   */
  onSnapshot(e: { conversationId: string; snapshot: SessionSnapshot }): void;
  onSessionUpdate(e: {
    conversationId: string;
    turnId: string;
    update: AgentUpdate;
    seq: number;
  }): void;
  onTurnCommitted(e: { conversationId: string; turn: AcpTurn }): void;
  onClosed(e: { conversationId: string; taskId: string; exitCode: number | null }): void;
  onAgentEvent(e: {
    type: 'start' | 'stop' | 'error';
    conversationId: string;
    projectId: string;
    taskId: string;
    providerId: string;
  }): void;
  /** A new terminal was created by the agent and is now running. */
  onTerminalCreated(e: {
    conversationId: string;
    terminalId: string;
    command: string;
    args: string[];
    cwd: string;
  }): void;
  /** A chunk of output was received from a running terminal. */
  onTerminalOutput(e: {
    conversationId: string;
    terminalId: string;
    chunk: string;
    truncated: boolean;
  }): void;
  /** A terminal command has exited. */
  onTerminalExit(e: {
    conversationId: string;
    terminalId: string;
    exitStatus: AcpTerminalExit;
  }): void;
  /** A terminal was released (resources freed). */
  onTerminalReleased(e: { conversationId: string; terminalId: string }): void;
}

export type SetSessionIdError = { type: string; message?: string };

export interface AcpSessionRuntimeDeps {
  /** Resolves the ACP behavior for a given provider id. */
  resolveAcp: ResolveAcpProvider;
  /** Transport bound to a single machine (local or SSH). */
  host: AcpProcessHost;
  /** Persist the agent-assigned session id after newSession/loadSession. */
  persistSessionId: (
    conversationId: string,
    sessionId: string
  ) => Promise<Result<void, SetSessionIdError>>;
  /** Outbound event sink (mapped to IPC channels by the desktop adapter). */
  listener: AcpRuntimeListener;
  logger: Logger;
}

/**
 * Machine-agnostic ACP session runtime interface.
 * Implemented by AcpSessionRuntime (local/SSH via transport injection) and
 * in the future by WorkspaceServerAcpSessionRuntime (RPC client).
 *
 * All effectful methods return Result<void, AcpRuntimeError> and never throw.
 * Pure snapshot getters return plain values and are guaranteed total/non-throwing.
 */
export interface IAcpSessionRuntime {
  start(input: AcpStartInput): Promise<Result<void, AcpRuntimeError>>;
  prompt(
    conversationId: string,
    text: string,
    images?: AcpPromptImage[]
  ): Promise<Result<void, AcpRuntimeError>>;
  cancel(conversationId: string): Promise<Result<void, AcpRuntimeError>>;
  setModel(conversationId: string, model: string): Promise<Result<void, AcpRuntimeError>>;
  setMode(conversationId: string, modeId: string): Promise<Result<void, AcpRuntimeError>>;
  setConfigOption(
    conversationId: string,
    configId: string,
    value: string
  ): Promise<Result<void, AcpRuntimeError>>;
  stop(conversationId: string): Result<void, AcpRuntimeError>;
  resolvePermission(
    conversationId: string,
    requestId: string,
    optionId: string | null
  ): Result<void, AcpRuntimeError>;
  isRunning(conversationId: string): boolean;
  getChatHistory(conversationId: string): ChatHistory;
  getSessionState(conversationId: string): SessionState;
  /** Returns snapshots of all live terminals for a conversation. Empty if none or unknown. */
  getTerminals(conversationId: string): TerminalSnapshot[];
  /** Returns snapshots of all live terminals across all conversations on this host. */
  getHostTerminals(): TerminalSnapshot[];
  /** Dispose and SIGTERM all live terminals on this host (e.g. on host teardown). */
  killAllTerminals(): void;
}
