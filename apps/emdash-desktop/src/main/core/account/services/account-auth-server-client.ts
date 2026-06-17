import { err, ok, type Result } from '@shared/lib/result';
import {
  SESSION_EXPIRED_MESSAGE,
  type AccountAuthServerError,
  type AccountLinkStartError,
  type AccountSessionValidationError,
  unknownErrorMessage,
} from '../account-errors';
import type { SessionValidationResult } from '../account-types';
import { ACCOUNT_CONFIG } from '../config';

export class AccountAuthServerClient {
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

  async startAccountLink(sessionToken: string): Promise<Result<string, AccountLinkStartError>> {
    const { baseUrl } = ACCOUNT_CONFIG.authServer;
    let response: Response;

    try {
      response = await fetch(`${baseUrl}/api/v1/auth/electron/account-link/start`, {
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
        cause: error,
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
        cause: error,
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
}
