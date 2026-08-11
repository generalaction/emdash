import { err, ok, toSerializedError, type Result } from '@emdash/shared';
import { type AccountOAuthError, unknownErrorMessage } from '../account-errors';
import { ACCOUNT_CONFIG } from '../config';

export class AccountOAuthClient {
  constructor(
    private readonly executeOAuthFlow: (
      options: OAuthFlowOptions
    ) => Promise<Record<string, unknown>>
  ) {}

  async signIn(provider: string): Promise<Result<Record<string, unknown>, AccountOAuthError>> {
    const { baseUrl } = ACCOUNT_CONFIG.authServer;
    const extraParams: Record<string, string> = {};

    if (provider) {
      extraParams.provider_id = provider;
    }

    return this.execute({
      authorizeUrl: `${baseUrl}/sign-in`,
      exchangeUrl: `${baseUrl}/api/v1/auth/electron/exchange`,
      successRedirectUrl: `${baseUrl}/auth/success`,
      errorRedirectUrl: `${baseUrl}/auth/error`,
      extraParams,
      timeoutMs: ACCOUNT_CONFIG.authServer.authTimeoutMs,
    });
  }

  async linkProviderAccount(
    provider: string,
    accountLinkState: string
  ): Promise<Result<Record<string, unknown>, AccountOAuthError>> {
    const { baseUrl } = ACCOUNT_CONFIG.authServer;

    return this.execute({
      authorizeUrl: `${baseUrl}/api/v1/auth/electron/account-link/authorize`,
      exchangeUrl: `${baseUrl}/api/v1/auth/electron/exchange`,
      successRedirectUrl: `${baseUrl}/auth/success`,
      errorRedirectUrl: `${baseUrl}/auth/error`,
      extraParams: {
        account_link_state: accountLinkState,
        provider_id: provider,
      },
      timeoutMs: ACCOUNT_CONFIG.authServer.authTimeoutMs,
    });
  }

  private async execute(
    options: OAuthFlowOptions
  ): Promise<Result<Record<string, unknown>, AccountOAuthError>> {
    try {
      return ok(await this.executeOAuthFlow(options));
    } catch (error) {
      return err({
        type: 'oauth_failed',
        message: unknownErrorMessage(error, 'OAuth flow failed'),
        cause: toSerializedError(error),
      });
    }
  }
}

export type OAuthFlowOptions = {
  authorizeUrl: string;
  exchangeUrl: string;
  successRedirectUrl: string;
  errorRedirectUrl: string;
  extraParams?: Record<string, string>;
  timeoutMs?: number;
};
