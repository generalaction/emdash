import { err, ok, type Result } from '@emdash/shared';
import { Result as ResultUtil } from '@emdash/shared/result';
import { HookCore, type Hookable } from '@main/lib/hookable';
import { log } from '@main/lib/logger';
import {
  type AccountInitializeError,
  type AccountLinkProviderError,
  type AccountSessionReadError,
  type AccountSessionValidationError,
  type AccountSignInError,
  type AccountSignOutError,
} from '../account-errors';
import type {
  LinkProviderAccountResult,
  SessionState,
  SessionValidationResult,
  SignInResult,
} from '../account-types';
import {
  parseRequiredProviderTokenResponse,
  parseSignInResponse,
} from './account-auth-response-parser';
import { AccountAuthServerClient } from './account-auth-server-client';
import { AccountOAuthClient } from './account-oauth-client';
import { AccountSessionStore, type AccountProfileKeyValueStore } from './account-session-store';
import { ProviderTokenDispatcher } from './provider-token-dispatcher';

type AccountServiceHooks = {
  accountChanged: (username: string, userId: string, email: string) => void | Promise<void>;
  accountCleared: () => void | Promise<void>;
};

export class EmdashAccountService implements Hookable<AccountServiceHooks> {
  private readonly _hooks = new HookCore<AccountServiceHooks>((name, e) =>
    log.error(`EmdashAccountService: ${String(name)} hook error`, e)
  );

  constructor(
    private readonly sessionStore: AccountSessionStore,
    private readonly authServerClient = new AccountAuthServerClient(),
    private readonly oauthClient = new AccountOAuthClient(),
    private readonly providerTokenDispatcher = new ProviderTokenDispatcher()
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
      const cleared = await this.clearSessionAndNotify();
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
    if (provider !== 'github') {
      return err({
        type: 'unsupported_provider',
        provider,
        message: `Account linking is not supported for provider "${provider}"`,
      });
    }

    const sessionToken = await this.sessionStore.requireToken();
    if (!sessionToken.success) return sessionToken;

    const accountLinkState = await this.authServerClient.startAccountLink(sessionToken.data);
    if (!accountLinkState.success) {
      if (accountLinkState.error.type === 'session_expired') {
        const cleared = await this.clearSessionAndNotify();
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

  async checkServerHealth(): Promise<boolean> {
    return this.authServerClient.checkHealth();
  }

  private async clearSessionAndNotify(): Promise<Result<void, AccountSessionReadError>> {
    const cleared = await this.sessionStore.clearSessionPreservingAccount();
    if (!cleared.success) return cleared;

    this._hooks.callHookBackground('accountCleared');
    return ok();
  }
}

export function createEmdashAccountService(options: {
  keyValueStore: AccountProfileKeyValueStore;
}): EmdashAccountService {
  return new EmdashAccountService(new AccountSessionStore(options.keyValueStore));
}
