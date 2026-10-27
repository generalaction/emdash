import type { SerializedError } from '@agent/shared';

export type AccountInitializeError = AccountSessionPersistenceError;

export type AccountSessionReadError = AccountSessionPersistenceError;

export type AccountSessionValidationError = AccountSessionPersistenceError | AccountAuthServerError;

export type AccountSignInError =
  | AccountInvalidAuthResponseError
  | AccountOAuthError
  | AccountSessionPersistenceError
  | AccountProviderTokenPersistenceError
  | AccountUnsupportedProviderError;

export type AccountLinkProviderError =
  | AccountAuthServerError
  | AccountInvalidAuthResponseError
  | AccountNotSignedInError
  | AccountOAuthError
  | AccountProviderTokenPersistenceError
  | AccountSessionExpiredError
  | AccountSessionPersistenceError
  | AccountUnsupportedProviderError;

export type AccountSignOutError = AccountSessionPersistenceError;

export type AccountLinkStartError =
  | AccountAuthServerError
  | AccountInvalidAuthResponseError
  | AccountSessionExpiredError;

export type AccountProviderTokenReadError =
  | AccountAuthServerError
  | AccountInvalidAuthResponseError
  | AccountProviderAccountNotLinkedError
  | AccountSessionExpiredError;

export type AccountRenewProviderTokenError =
  | AccountProviderTokenReadError
  | AccountNotSignedInError
  | AccountSessionPersistenceError;

export type AccountSessionPersistenceError = {
  type: 'session_persistence_failed';
  message: string;
  cause?: SerializedError;
};

export type AccountNotSignedInError = {
  type: 'not_signed_in';
  message: string;
};

export type AccountSessionExpiredError = {
  type: 'session_expired';
  message: string;
};

export type AccountProviderAccountNotLinkedError = {
  type: 'provider_account_not_linked';
  provider: string;
  message: string;
};

export type AccountUnsupportedProviderError = {
  type: 'unsupported_provider';
  provider: string;
  message: string;
};

export type AccountAuthServerError = {
  type: 'auth_server_error';
  status?: number;
  message: string;
  cause?: SerializedError;
};

export type AccountInvalidAuthResponseError = {
  type: 'invalid_auth_response';
  message: string;
  cause?: SerializedError;
};

export type AccountOAuthError = {
  type: 'oauth_failed';
  message: string;
  cause?: SerializedError;
};

export type AccountProviderTokenPersistenceError = {
  type: 'provider_token_persistence_failed';
  provider?: string;
  message: string;
  cause?: SerializedError;
};

export const SESSION_EXPIRED_MESSAGE = 'Your Agent session expired. Sign in again.';

export function unknownErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
