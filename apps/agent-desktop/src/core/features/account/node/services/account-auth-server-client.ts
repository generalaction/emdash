import { err, ok, toSerializedError, type Result } from '@agent/shared';
import {
  SESSION_EXPIRED_MESSAGE,
  type AccountAuthServerError,
  type AccountLinkStartError,
  type AccountProviderTokenReadError,
  type AccountSessionValidationError,
  unknownErrorMessage,
} from '../account-errors';
import type { SessionValidationResult } from '../account-types';
import { ACCOUNT_CONFIG } from '../config';

/** Renewal runs on credential reads; the server may wait up to 10s for an account lock. */
const PROVIDER_TOKEN_TIMEOUT_MS = 30_000;

export class AccountAuthServerClient {
  async validateSession(
    token: string
  ): Promise<Result<SessionValidationResult, AccountSessionValidationError>> {
    const { baseUrl } = ACCOUNT_CONFIG.authServer;
    try {
      const response = await fetch(`${baseUrl}/api/auth/get-session`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(3000),
      });

      return ok(response.ok ? 'valid' : 'invalid');
    } catch {
      return ok('unknown');
    }
  }

  async startAccountLink(
    sessionToken: string,
    provider: string
  ): Promise<Result<string, AccountLinkStartError>> {
    const { baseUrl } = ACCOUNT_CONFIG.authServer;
    const query = new URLSearchParams({ provider_id: provider });
    let response: Response;

    try {
      response = await fetch(`${baseUrl}/api/v1/auth/electron/account-link/start?${query}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionToken}`,
        },
        signal: AbortSignal.timeout(ACCOUNT_CONFIG.authServer.authTimeoutMs),
      });
    } catch (error) {
      return err({
        type: 'auth_server_error',
        message: unknownErrorMessage(error, 'Account link start failed'),
        cause: toSerializedError(error),
      });
    }

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (response.status === 401 || payload?.error === 'No active session') {
        return err({
          type: 'session_expired',
          message: SESSION_EXPIRED_MESSAGE,
        });
      }

      return err({
        type: 'auth_server_error',
        status: response.status,
        message: payload?.error || `Account link start failed (${response.status})`,
      } satisfies AccountAuthServerError);
    }

    let payload: { accountLinkState?: unknown };
    try {
      payload = (await response.json()) as { accountLinkState?: unknown };
    } catch (error) {
      return err({
        type: 'invalid_auth_response',
        message: 'Invalid account link start response',
        cause: toSerializedError(error),
      });
    }

    if (typeof payload.accountLinkState !== 'string' || payload.accountLinkState.length === 0) {
      return err({
        type: 'invalid_auth_response',
        message: 'Invalid account link start response: missing accountLinkState',
      });
    }

    return ok(payload.accountLinkState);
  }

  /**
   * Reads the current access token of a linked provider account. The server
   * refreshes it first when it is close to expiry.
   */
  async getProviderToken(
    sessionToken: string,
    provider: string,
    providerAccountId: string
  ): Promise<Result<unknown, AccountProviderTokenReadError>> {
    const { baseUrl } = ACCOUNT_CONFIG.authServer;
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/api/v1/auth/electron/provider-token`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ provider_id: provider, account_id: providerAccountId }),
        signal: AbortSignal.timeout(PROVIDER_TOKEN_TIMEOUT_MS),
      });
    } catch (error) {
      return err({
        type: 'auth_server_error',
        message: unknownErrorMessage(error, 'Provider token request failed'),
        cause: toSerializedError(error),
      });
    }

    if (response.status === 401) {
      return err({ type: 'session_expired', message: SESSION_EXPIRED_MESSAGE });
    }
    if (response.status === 404) {
      return err({
        type: 'provider_account_not_linked',
        provider,
        message: 'This account is no longer linked to your Agent account.',
      });
    }
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      return err({
        type: 'auth_server_error',
        status: response.status,
        message: payload?.error || `Provider token request failed (${response.status})`,
      });
    }

    try {
      return ok(await response.json());
    } catch (error) {
      return err({
        type: 'invalid_auth_response',
        message: 'Invalid provider token response',
        cause: toSerializedError(error),
      });
    }
  }

  async checkHealth(): Promise<boolean> {
    const { baseUrl } = ACCOUNT_CONFIG.authServer;
    try {
      const response = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
