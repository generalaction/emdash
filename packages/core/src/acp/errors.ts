/**
 * Tagged error union for AcpRuntime public API failures.
 */

import type { BaseError, SerializedError } from '@emdash/shared';
import { fail } from '@emdash/shared';

/** Provider does not support the ACP transport. */
export type ProviderUnsupportedError = BaseError<'provider_unsupported'>;

/** No conversation with the given id is tracked in the runtime. */
export type ConversationNotFoundError = BaseError<'conversation_not_found'>;

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

/** The agent requires authentication before a session can be started. */
export type AuthRequiredError = BaseError<'auth_required', SerializedError>;

/** A prompt() call to the agent failed. */
export type PromptFailedError = BaseError<'prompt_failed', SerializedError>;

/** A cancel() call to the agent failed. */
export type CancelFailedError = BaseError<'cancel_failed', SerializedError>;

/** A setSessionConfigOption() call to the agent failed. */
export type SetConfigFailedError = BaseError<'set_config_failed', SerializedError>;

/** A setSessionMode() call to the agent failed. */
export type SetModeFailedError = BaseError<'set_mode_failed', SerializedError>;

export type AcpRuntimeError =
  | ProviderUnsupportedError
  | ConversationNotFoundError
  | InvalidStateError
  | SpawnFailedError
  | InitializeFailedError
  | NewSessionFailedError
  | AuthRequiredError
  | PromptFailedError
  | CancelFailedError
  | SetConfigFailedError
  | SetModeFailedError;

export type AcpStartSessionError =
  | ProviderUnsupportedError
  | AuthRequiredError
  | SpawnFailedError
  | InitializeFailedError
  | NewSessionFailedError
  | InvalidStateError;
export type AcpResumeSessionError = AcpStartSessionError;
export type AcpStopSessionError = never;
export type AcpSendPromptError =
  | ConversationNotFoundError
  | InvalidStateError
  | PromptFailedError;
export type AcpQueuePromptError = ConversationNotFoundError | InvalidStateError;
export type AcpEditQueuedPromptError = AcpQueuePromptError;
export type AcpDeleteQueuedPromptError = AcpQueuePromptError;
export type AcpChangeQueuePromptOrderError = AcpQueuePromptError;
export type AcpResolvePermissionError = AcpQueuePromptError;
export type AcpSetPromptDraftError = ConversationNotFoundError;
export type AcpCancelTurnError = InvalidStateError | CancelFailedError;
export type AcpSetModelOptionError =
  | ConversationNotFoundError
  | InvalidStateError
  | SetConfigFailedError;
export type AcpSetModeOptionError =
  | ConversationNotFoundError
  | InvalidStateError
  | SetModeFailedError;
export type AcpExportTranscriptError = ConversationNotFoundError;
export type AcpExportRawLogError = ConversationNotFoundError;
export type AcpAttachmentError = InvalidStateError;
export type AcpGetHistoryError = never;

export const acpErr = {
  providerUnsupported: (providerId: string) =>
    fail('provider_unsupported', { message: `Provider '${providerId}' does not support ACP` }),

  conversationNotFound: (conversationId: string) =>
    fail('conversation_not_found', { message: conversationId }),

  invalidState: (message: string) => fail('invalid_state', { message }),

  spawnFailed: (cause: SerializedError) => fail('spawn_failed', { cause }),

  initializeFailed: (cause: SerializedError) => fail('initialize_failed', { cause }),

  newSessionFailed: (cause: SerializedError) => fail('new_session_failed', { cause }),

  authRequired: (cause: SerializedError) => fail('auth_required', { cause }),

  promptFailed: (cause: SerializedError) => fail('prompt_failed', { cause }),

  cancelFailed: (cause: SerializedError) => fail('cancel_failed', { cause }),

  setConfigFailed: (cause: SerializedError) => fail('set_config_failed', { cause }),

  setModeFailed: (cause: SerializedError) => fail('set_mode_failed', { cause }),
} as const;
