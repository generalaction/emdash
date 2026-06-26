/**
 * Tagged error union for AcpSessionRuntime public API failures.
 *
 * All public methods return Result<void, AcpRuntimeError> instead of throwing,
 * keeping the failure vocabulary serializable across the IPC boundary.
 */

import type { BaseError, SerializedError } from '@emdash/shared';
import { fail } from '@emdash/shared';

// ---------------------------------------------------------------------------
// Error variants
// ---------------------------------------------------------------------------

/** Provider does not support the ACP transport. */
export type ProviderUnsupportedError = BaseError<'provider_unsupported'>;

/** No conversation with the given id is tracked in the runtime. */
export type ConversationNotFoundError = BaseError<'conversation_not_found'>;

/** The conversation exists but no ACP session id has been assigned yet. */
export type NoActiveSessionError = BaseError<'no_active_session'>;

/**
 * A command was issued but the current lifecycle state does not allow it,
 * e.g. Prompt while already working.
 */
export type InvalidStateError = BaseError<'invalid_state'>;

/** Spawning the agent process failed. */
export type SpawnFailedError = BaseError<'spawn_failed', SerializedError>;

/** The ACP initialize handshake failed. */
export type InitializeFailedError = BaseError<'initialize_failed', SerializedError>;

/** The agent's newSession call failed. */
export type NewSessionFailedError = BaseError<'new_session_failed', SerializedError>;

/** The agent's loadSession call failed. */
export type LoadSessionFailedError = BaseError<'load_session_failed', SerializedError>;

/** A prompt() call to the agent failed. */
export type PromptFailedError = BaseError<'prompt_failed', SerializedError>;

/** A cancel() call to the agent failed. */
export type CancelFailedError = BaseError<'cancel_failed', SerializedError>;

/** A setSessionConfigOption() call to the agent failed. */
export type SetConfigFailedError = BaseError<'set_config_failed', SerializedError>;

/** A setSessionMode() call to the agent failed. */
export type SetModeFailedError = BaseError<'set_mode_failed', SerializedError>;

// ---------------------------------------------------------------------------
// Union
// ---------------------------------------------------------------------------

export type AcpRuntimeError =
  | ProviderUnsupportedError
  | ConversationNotFoundError
  | NoActiveSessionError
  | InvalidStateError
  | SpawnFailedError
  | InitializeFailedError
  | NewSessionFailedError
  | LoadSessionFailedError
  | PromptFailedError
  | CancelFailedError
  | SetConfigFailedError
  | SetModeFailedError;

// ---------------------------------------------------------------------------
// Constructors
// ---------------------------------------------------------------------------

export const acpErr = {
  providerUnsupported: (providerId: string) =>
    fail('provider_unsupported', { message: `Provider '${providerId}' does not support ACP` }),

  conversationNotFound: (conversationId: string) =>
    fail('conversation_not_found', { message: conversationId }),

  noActiveSession: (conversationId: string) =>
    fail('no_active_session', { message: conversationId }),

  invalidState: (message: string) => fail('invalid_state', { message }),

  spawnFailed: (cause: SerializedError) => fail('spawn_failed', { cause }),

  initializeFailed: (cause: SerializedError) => fail('initialize_failed', { cause }),

  newSessionFailed: (cause: SerializedError) => fail('new_session_failed', { cause }),

  loadSessionFailed: (cause: SerializedError) => fail('load_session_failed', { cause }),

  promptFailed: (cause: SerializedError) => fail('prompt_failed', { cause }),

  cancelFailed: (cause: SerializedError) => fail('cancel_failed', { cause }),

  setConfigFailed: (cause: SerializedError) => fail('set_config_failed', { cause }),

  setModeFailed: (cause: SerializedError) => fail('set_mode_failed', { cause }),
} as const;
