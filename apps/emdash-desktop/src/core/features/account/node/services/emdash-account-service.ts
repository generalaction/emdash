import { err, ok, Result as ResultUtil, type Result } from '@emdash/shared';
import { log } from '@emdash/shared/logger';
import { HookCore, type Hookable } from '@core/primitives/hooks/api/hookable';
import {
  type AccountInitializeError,
  type AccountLinkProviderError,
  type AccountRenewProviderTokenError,
  type AccountSessionReadError,
  type AccountSessionValidationError,
  type AccountSignInError,
  type AccountSignOutError,
} from '../account-errors';
import type {
  LinkProviderAccountResult,
  RenewedProviderToken,
  SessionState,
  SessionValidationResult,
  SignInResult,
} from '../account-types';
import {
  parseRenewedProviderTokenResponse,
  parseRequiredProviderTokenResponse,
  parseSignInResponse,
} from './account-auth-response-parser';
import type { AccountAuthServerClient } from './account-auth-server-client';
import type { AccountOAuthClient } from './account-oauth-client';
import {
  AccountSessionStore,
  type AccountProfileKeyValueStore,
  type AccountSessionCredentialStore,
} from './account-session-store';
import type { ProviderTokenDispatcher } from './provider-token-dispatcher';

type AccountServiceHooks = {
  accountChanged: (username: string, userId: string, email: string) => void | Promise<void>;
  accountCleared: () => void | Promise<void>;
};

export class EmdashAccountService implements Hookable<AccountServiceHooks> {
  private readonly _hooks = new HookCore<AccountServiceHooks>((name, e) =>
    log.error(`EmdashAccountService: ${String(name)} hook error`, { error: e })
  );

  constructor(
    private readonly sessionStore: AccountSessionStore,
    private readonly authServerClient: AccountAuthServerClient,
    private readonly oauthClient: AccountOAuthClient,
    private readonly providerTokenDispatcher: ProviderTokenDispatcher
  ) {}

  on<K extends keyof AccountServiceHooks>(name: K, handler: AccountServiceHooks[K]) {
    return this._hooks.on(name, handler);
  }

  async initialize(): Promise<Result<void, AccountInitializeError>> {
    const session = await this.sessionStore.load();
    if (!session.success) return session;

    if (session.data.token && session.data.profile?.hasAccount) {
      this._hooks.callHookBackground(
        'accountChanged',
        session.data.profile.username,
        session.data.profile.userId,
        session.data.profile.email
      );
    }

    return ok();
  }

  async loadSessionToken(): Promise<Result<void, AccountInitializeError>> {
    return this.initialize();
  }

  async getSession(): Promise<Result<SessionState, AccountSessionReadError>> {
    return this.sessionStore.getSession();
  }

  async validateSession(): Promise<Result<SessionValidationResult, AccountSessionValidationError>> {
    const token = await this.sessionStore.ensureTokenLoaded();
    if (!token.success) return token;
    if (!token.data) return ok('invalid');

    const validation = await this.authServerClient.validateSession(token.data);
    if (!validation.success) return validation;

    if (validation.data === 'invalid') {
      const cleared = await this.clearExpiredSession(token.data);
      if (!cleared.success) return cleared;
      return ok('invalid');
    }

    if (validation.data === 'valid') {
      const marked = await this.sessionStore.markValidated(new Date().toISOString());
      if (!marked.success) return marked;
    }

    return validation;
  }

  async signIn(provider: string = 'github'): Promise<Result<SignInResult, AccountSignInError>> {
    return await ResultUtil.fromAsync(this.oauthClient.signIn(provider))
      .andThen((raw) => parseSignInResponse(raw))
      .andThen(
        async (exchange) =>
          await ResultUtil.fromAsync(
            this.sessionStore.saveSignedInSession(
              exchange.user,
              exchange.sessionToken,
              new Date().toISOString()
            )
          )
            .andThen(
              async () =>
                await ResultUtil.fromAsync(
                  this.providerTokenDispatcher.dispatchOptional(exchange.providerToken)
                )
            )
            .tap(() =>
              this._hooks.callHookBackground(
                'accountChanged',
                exchange.user.username,
                exchange.user.userId,
                exchange.user.email
              )
            )
            .map(() => ({ user: exchange.user }))
      );
  }

  async signOut(): Promise<Result<void, AccountSignOutError>> {
    return this.clearSessionAndNotify();
  }

  async linkProviderAccount(
    provider: string = 'github'
  ): Promise<Result<LinkProviderAccountResult, AccountLinkProviderError>> {
    if (!this.providerTokenDispatcher.supports(provider)) {
      return err({
        type: 'unsupported_provider',
        provider,
        message: `Account linking is not supported for provider "${provider}"`,
      });
    }

    const sessionToken = await this.sessionStore.requireToken();
    if (!sessionToken.success) return sessionToken;

    const accountLinkState = await this.authServerClient.startAccountLink(
      sessionToken.data,
      provider
    );
    if (!accountLinkState.success) {
      if (accountLinkState.error.type === 'session_expired') {
        const cleared = await this.clearExpiredSession(sessionToken.data);
        if (!cleared.success) return cleared;
      }
      return accountLinkState;
    }

    const raw = await this.oauthClient.linkProviderAccount(provider, accountLinkState.data);
    if (!raw.success) return raw;

    const providerToken = parseRequiredProviderTokenResponse(raw.data);
    if (!providerToken.success) return providerToken;

    const dispatched = await this.providerTokenDispatcher.dispatchRequired(providerToken.data);
    if (!dispatched.success) return dispatched;

    const result: LinkProviderAccountResult = {
      provider: providerToken.data.providerId,
    };
    if (dispatched.data?.providerAccountStatus) {
      result.providerAccountStatus = dispatched.data.providerAccountStatus;
    }
    if (providerToken.data.providerAccount) {
      result.providerAccount = providerToken.data.providerAccount;
    }
    return ok(result);
  }

  /**
   * Reads the access token of a provider account linked to the Emdash account;
   * the auth server refreshes it first when it is close to expiry. An expired
   * Emdash session is cleared (unless a newer one replaced it meanwhile), so
   * later reads fail without a request.
   */
  async renewProviderToken(
    provider: string,
    providerAccountId: string
  ): Promise<Result<RenewedProviderToken, AccountRenewProviderTokenError>> {
    const sessionToken = await this.sessionStore.ensureTokenLoaded();
    if (!sessionToken.success) return sessionToken;
    if (!sessionToken.data) {
      return err({ type: 'not_signed_in', message: 'You are signed out of Emdash.' });
    }

    const raw = await this.authServerClient.getProviderToken(
      sessionToken.data,
      provider,
      providerAccountId
    );
    if (!raw.success) {
      if (raw.error.type === 'session_expired') {
        const cleared = await this.clearExpiredSession(sessionToken.data);
        if (!cleared.success) return cleared;
      }
      return raw;
    }
    return parseRenewedProviderTokenResponse(raw.data);
  }

  async checkServerHealth(): Promise<boolean> {
    return this.authServerClient.checkHealth();
  }

  /** Clears `token`'s session after the server rejected it, unless a newer session replaced it. */
  private async clearExpiredSession(token: string): Promise<Result<void, AccountSessionReadError>> {
    const cleared = await this.sessionStore.clearSessionIfCurrent(token);
    if (!cleared.success) return cleared;
    if (cleared.data) this._hooks.callHookBackground('accountCleared');
    return ok();
  }

  private async clearSessionAndNotify(): Promise<Result<void, AccountSessionReadError>> {
    const cleared = await this.sessionStore.clearSessionPreservingAccount();
    if (!cleared.success) return cleared;

    this._hooks.callHookBackground('accountCleared');
    return ok();
  }
}

export function createEmdashAccountService(options: {
  authServerClient: AccountAuthServerClient;
  credentials: AccountSessionCredentialStore;
  keyValueStore: AccountProfileKeyValueStore;
  oauthClient: AccountOAuthClient;
  providerTokenDispatcher: ProviderTokenDispatcher;
}): EmdashAccountService {
  return new EmdashAccountService(
    new AccountSessionStore(options.keyValueStore, options.credentials),
    options.authServerClient,
    options.oauthClient,
    options.providerTokenDispatcher
  );
}
