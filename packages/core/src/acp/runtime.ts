import type { Result } from '@emdash/shared';
import type { IAcpBehavior } from '../agents/plugins/capabilities/acp';
import type { AcpPermissionRequest } from './permissions';
import type { AcpProcessHost } from './transport';
import type { AcpPromptImage, AcpTurn, ChatHistory, SessionLifecycle, SessionState } from './turns';

// ---------------------------------------------------------------------------
// AcpStartInput
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// ResolveAcpProvider
// ---------------------------------------------------------------------------

/**
 * Narrow resolver injected into AcpSessionRuntime.
 * Returns the ACP behavior for the given provider, or null if unsupported.
 * The desktop adapter wraps getPlugin + capability check; tests inject a stub.
 */
export type ResolveAcpProvider = (providerId: string) => { behavior: IAcpBehavior } | null;

// ---------------------------------------------------------------------------
// AcpRuntimeListener
// ---------------------------------------------------------------------------

/**
 * Outbound event sink injected into AcpSessionRuntime.
 * The desktop adapter maps these calls onto the IPC typed-event channels.
 * Keeps the runtime free of @main IPC imports.
 */
export interface AcpRuntimeListener {
  onState(e: {
    conversationId: string;
    lifecycle: SessionLifecycle;
    activeTurnId: string | null;
  }): void;
  onSessionUpdate(e: {
    conversationId: string;
    turnId: string;
    update: import('@agentclientprotocol/sdk').SessionUpdate;
    seq: number;
  }): void;
  onTurnCommitted(e: { conversationId: string; turn: AcpTurn }): void;
  onPermissionRequest(request: AcpPermissionRequest): void;
  onPermissionResolved(e: { conversationId: string; requestId: string }): void;
  onClosed(e: { conversationId: string; taskId: string; exitCode: number | null }): void;
  onAgentEvent(e: {
    type: 'start' | 'stop' | 'error';
    conversationId: string;
    projectId: string;
    taskId: string;
    providerId: string;
  }): void;
}

// ---------------------------------------------------------------------------
// AcpRuntimeLog
// ---------------------------------------------------------------------------

export type AcpRuntimeLog = {
  debug: (message: string, metadata?: Record<string, unknown>) => void;
  info: (message: string, metadata?: Record<string, unknown>) => void;
  warn: (message: string, metadata?: Record<string, unknown>) => void;
  error: (message: string, metadata?: Record<string, unknown>) => void;
};

// ---------------------------------------------------------------------------
// SetSessionIdError (kept minimal here; desktop impl uses a richer variant)
// ---------------------------------------------------------------------------

export type SetSessionIdError = { type: string; message?: string };

// ---------------------------------------------------------------------------
// AcpSessionRuntimeDeps
// ---------------------------------------------------------------------------

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
  /** Persist model selection changes. */
  persistModel: (conversationId: string, model: string) => Promise<void>;
  /** Outbound event sink (mapped to IPC channels by the desktop adapter). */
  listener: AcpRuntimeListener;
  log: AcpRuntimeLog;
}

// ---------------------------------------------------------------------------
// IAcpSessionRuntime
// ---------------------------------------------------------------------------

/**
 * Machine-agnostic ACP session runtime interface.
 * Implemented by AcpSessionRuntime (local/SSH via transport injection) and
 * in the future by WorkspaceServerAcpSessionRuntime (RPC client).
 */
export interface IAcpSessionRuntime {
  start(input: AcpStartInput): Promise<void>;
  prompt(conversationId: string, text: string, images?: AcpPromptImage[]): Promise<void>;
  cancel(conversationId: string): Promise<void>;
  setModel(conversationId: string, model: string): Promise<void>;
  stop(conversationId: string): void;
  resolvePermission(conversationId: string, requestId: string, optionId: string | null): void;
  isRunning(conversationId: string): boolean;
  getChatHistory(conversationId: string): ChatHistory;
  getSessionState(conversationId: string): SessionState;
}
