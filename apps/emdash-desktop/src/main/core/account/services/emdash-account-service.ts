import { HookCore, type Hookable } from '@main/lib/hookable';
import { log } from '@main/lib/logger';
import { err, ok, type Result } from '@shared/lib/result';
import {
  type AccountInitializeError,
  type AccountLinkProviderError,
  type AccountSessionError,
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
import { AccountSessionStore } from './account-session-store';
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
    private readonly sessionStore = new AccountSessionStore(),
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

  async getValidatedSession(): Promise<Result<SessionState, AccountSessionError>> {
    const token = await this.sessionStore.ensureTokenLoaded();
    if (!token.success) return token;

    const session = await this.getSession();
    if (!session.success) return session;
    if (!session.data.hasAccount || !session.data.isSignedIn) return session;

    const validation = await this.validateSession();
    if (!validation.success) return validation;

    return this.getSession();
  }

  async signIn(provider: string = 'github'): Promise<Result<SignInResult, AccountSignInError>> {
    const raw = await this.oauthClient.signIn(provider);
    if (!raw.success) return raw;

    const exchange = parseSignInResponse(raw.data);
    if (!exchange.success) return exchange;

    const saved = await this.sessionStore.saveSignedInSession(
      exchange.data.user,
      exchange.data.sessionToken,
      new Date().toISOString()
    );
    if (!saved.success) return saved;

    const providerToken = await this.providerTokenDispatcher.dispatchOptional(
      exchange.data.providerToken
    );
    if (!providerToken.success) return providerToken;

    this._hooks.callHookBackground(
      'accountChanged',
      exchange.data.user.username,
      exchange.data.user.userId,
      exchange.data.user.email
    );

    return ok({ user: exchange.data.user });
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

  async signOut(): Promise<Result<void, AccountSignOutError>> {
    return this.clearSessionAndNotify();
  }

  async checkServerHealth(): Promise<boolean> {
    return this.authServerClient.checkHealth();
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

  private async clearSessionAndNotify(): Promise<Result<void, AccountSessionReadError>> {
    const cleared = await this.sessionStore.clearSessionPreservingAccount();
    if (!cleared.success) return cleared;

    this._hooks.callHookBackground('accountCleared');
    return ok();
  }
}

export const emdashAccountService = new EmdashAccountService();
