export type AccountInitializeError = AccountSessionPersistenceError;

export type AccountSessionReadError = AccountSessionPersistenceError;

export type AccountSessionValidationError = AccountSessionPersistenceError | AccountAuthServerError;

export type AccountSignInError =
  | AccountInvalidAuthResponseError
  | AccountOAuthError
  | AccountSessionPersistenceError
  | AccountProviderTokenPersistenceError;

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

export type AccountSessionPersistenceError = {
  type: 'session_persistence_failed';
  message: string;
  cause?: unknown;
};

export type AccountNotSignedInError = {
  type: 'not_signed_in';
  message: string;
};

export type AccountSessionExpiredError = {
  type: 'session_expired';
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
  cause?: unknown;
};

export type AccountInvalidAuthResponseError = {
  type: 'invalid_auth_response';
  message: string;
  cause?: unknown;
};

export type AccountOAuthError = {
  type: 'oauth_failed';
  message: string;
  cause?: unknown;
};

export type AccountProviderTokenPersistenceError = {
  type: 'provider_token_persistence_failed';
  provider?: string;
  message: string;
  cause?: unknown;
};

export const SESSION_EXPIRED_MESSAGE =
  'Your Emdash session expired. Sign in again to connect GitHub.';

export function unknownErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
