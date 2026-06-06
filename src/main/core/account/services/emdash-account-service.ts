import { executeOAuthFlow } from '@main/core/shared/oauth-flow';
import { KV } from '@main/db/kv';
import { HookCore, type Hookable } from '@main/lib/hookable';
import { log } from '@main/lib/logger';
import { ACCOUNT_CONFIG } from '../config';
import { providerTokenRegistry, type ProviderAccountPayload } from '../provider-token-registry';
import { accountCredentialStore } from './credential-store';

export interface AccountUser {
  userId: string;
  name?: string;
  username: string;
  avatarUrl: string;
  email: string;
}

export interface CachedProfile {
  hasAccount: boolean;
  userId: string;
  name?: string;
  username: string;
  avatarUrl: string;
  email: string;
  lastValidated: string;
}

export interface SignInResult {
  providerToken?: string;
  provider?: string;
  providerAccount?: ProviderAccountPayload;
  user: AccountUser;
}

export interface LinkProviderAccountResult {
  provider: string;
  providerAccount?: ProviderAccountPayload;
}

export interface SessionState {
  user: AccountUser | null;
  isSignedIn: boolean;
  hasAccount: boolean;
}

interface AccountKVSchema extends Record<string, unknown> {
  profile: CachedProfile;
}

type AccountServiceHooks = {
  accountChanged: (username: string, userId: string, email: string) => void | Promise<void>;
  accountCleared: () => void | Promise<void>;
};

const accountKV = new KV<AccountKVSchema>('account');

function parseProviderAccountPayload(raw: unknown): ProviderAccountPayload | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;

  const candidate = raw as Record<string, unknown>;
  if (
    typeof candidate.providerId !== 'string' ||
    typeof candidate.providerAccountId !== 'string' ||
    candidate.providerAccountId.length === 0 ||
    typeof candidate.host !== 'string' ||
    typeof candidate.login !== 'string' ||
    typeof candidate.avatarUrl !== 'string'
  ) {
    return undefined;
  }

  return {
    providerId: candidate.providerId,
    providerAccountId: candidate.providerAccountId,
    host: candidate.host,
    login: candidate.login,
    avatarUrl: candidate.avatarUrl,
  };
}

function parseAuthProviderToken(raw: Record<string, unknown>): {
  accessToken?: string;
  providerId?: string;
  providerAccount?: ProviderAccountPayload;
} {
  const accessToken = typeof raw.accessToken === 'string' ? raw.accessToken : undefined;
  const providerId = typeof raw.providerId === 'string' ? raw.providerId : undefined;
  const providerAccount = parseProviderAccountPayload(raw.providerAccount);
  return { accessToken, providerId, providerAccount };
}

export class EmdashAccountService implements Hookable<AccountServiceHooks> {
  private readonly _hooks = new HookCore<AccountServiceHooks>((name, e) =>
    log.error(`EmdashAccountService: ${String(name)} hook error`, e)
  );
  private cachedProfile: CachedProfile | null = null;
  private sessionToken: string | null = null;

  on<K extends keyof AccountServiceHooks>(name: K, handler: AccountServiceHooks[K]) {
    return this._hooks.on(name, handler);
  }

  async getSession(): Promise<SessionState> {
    this.cachedProfile = await accountKV.get('profile');
    const hasAccount = this.cachedProfile?.hasAccount === true;
    const isSignedIn = hasAccount && this.sessionToken !== null;
    return {
      user:
        isSignedIn && this.cachedProfile
          ? {
              userId: this.cachedProfile.userId,
              name: this.cachedProfile.name,
              username: this.cachedProfile.username,
              avatarUrl: this.cachedProfile.avatarUrl,
              email: this.cachedProfile.email,
            }
          : null,
      isSignedIn,
      hasAccount,
    };
  }

  async loadSessionToken(): Promise<void> {
    [this.sessionToken, this.cachedProfile] = await Promise.all([
      accountCredentialStore.get(),
      accountKV.get('profile'),
    ]);
    if (this.sessionToken && this.cachedProfile?.hasAccount) {
      this._hooks.callHookBackground(
        'accountChanged',
        this.cachedProfile.username,
        this.cachedProfile.userId,
        this.cachedProfile.email
      );
    }
  }

  /**  make provider optional and remove default in case emdash starts supporting more providers */
  async signIn(provider: string = 'github'): Promise<SignInResult> {
    const { baseUrl } = ACCOUNT_CONFIG.authServer;

    const extraParams: Record<string, string> = {};

    if (provider) {
      extraParams.provider_id = provider;
    }

    const raw = await executeOAuthFlow({
      authorizeUrl: `${baseUrl}/sign-in`,
      exchangeUrl: `${baseUrl}/api/v1/auth/electron/exchange`,
      successRedirectUrl: `${baseUrl}/auth/success`,
      errorRedirectUrl: `${baseUrl}/auth/error`,
      extraParams,
      timeoutMs: ACCOUNT_CONFIG.authServer.authTimeoutMs,
    });

    const sessionToken = raw.sessionToken as string;
    const user = raw.user as AccountUser;
    if (!sessionToken || !user) {
      throw new Error('Invalid sign-in response: missing sessionToken or user');
    }

    await accountCredentialStore.set(sessionToken);
    this.sessionToken = sessionToken;

    const profile: CachedProfile = {
      hasAccount: true,
      userId: user.userId,
      name: user.name,
      username: user.username,
      avatarUrl: user.avatarUrl,
      email: user.email,
      lastValidated: new Date().toISOString(),
    };
    this.cachedProfile = profile;
    await accountKV.set('profile', profile);

    const { accessToken, providerId, providerAccount } = parseAuthProviderToken(raw);
    if (accessToken && providerId) {
      await providerTokenRegistry.dispatch(providerId, {
        accessToken,
        intent: 'sign-in',
        providerAccount,
      });
    }

    this._hooks.callHookBackground('accountChanged', user.username, user.userId, user.email);

    const result: SignInResult = {
      providerToken: accessToken || undefined,
      provider: providerId || undefined,
      user,
    };
    if (providerAccount) {
      result.providerAccount = providerAccount;
    }
    return result;
  }

  async linkProviderAccount(provider: string = 'github'): Promise<LinkProviderAccountResult> {
    if (provider !== 'github') {
      throw new Error(`Account linking is not supported for provider "${provider}"`);
    }

    const sessionToken = await this.requireSessionToken();
    const { baseUrl } = ACCOUNT_CONFIG.authServer;
    const accountLinkState = await this.startAccountLink(sessionToken);

    const raw = await executeOAuthFlow({
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

    const { accessToken, providerId, providerAccount } = parseAuthProviderToken(raw);
    if (!accessToken || !providerId) {
      throw new Error('Invalid account link response: missing provider token');
    }

    await providerTokenRegistry.dispatch(providerId, {
      accessToken,
      intent: 'account-link',
      providerAccount,
    });

    const result: LinkProviderAccountResult = {
      provider: providerId,
    };
    if (providerAccount) {
      result.providerAccount = providerAccount;
    }
    return result;
  }

  async signOut(): Promise<void> {
    this.sessionToken = null;
    await accountCredentialStore.clear();
    if (this.cachedProfile) {
      this.cachedProfile.hasAccount = true;
      await accountKV.set('profile', this.cachedProfile);
    }
    this._hooks.callHookBackground('accountCleared');
  }

  async checkServerHealth(): Promise<boolean> {
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

  async validateSession(): Promise<boolean> {
    const token = this.sessionToken;
    if (!token) return false;

    const { baseUrl } = ACCOUNT_CONFIG.authServer;
    try {
      const response = await fetch(`${baseUrl}/api/auth/get-session`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(3000),
      });

      if (!response.ok) {
        this.sessionToken = null;
        await accountCredentialStore.clear();
        if (this.cachedProfile) {
          this.cachedProfile.hasAccount = true;
          await accountKV.set('profile', this.cachedProfile);
        }
        return false;
      }

      if (this.cachedProfile) {
        this.cachedProfile.lastValidated = new Date().toISOString();
        await accountKV.set('profile', this.cachedProfile);
      }
      return true;
    } catch {
      return this.sessionToken !== null;
    }
  }

  private async requireSessionToken(): Promise<string> {
    if (this.sessionToken) return this.sessionToken;

    const token = await accountCredentialStore.get();
    if (!token) {
      throw new Error('You must be signed in to link a provider account');
    }
    this.sessionToken = token;
    return token;
  }

  private async startAccountLink(sessionToken: string): Promise<string> {
    const { baseUrl } = ACCOUNT_CONFIG.authServer;
    const response = await fetch(`${baseUrl}/api/v1/auth/electron/account-link/start`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessionToken}`,
      },
      signal: AbortSignal.timeout(ACCOUNT_CONFIG.authServer.authTimeoutMs),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error || `Account link start failed (${response.status})`);
    }

    const payload = (await response.json()) as { accountLinkState?: unknown };
    if (typeof payload.accountLinkState !== 'string' || payload.accountLinkState.length === 0) {
      throw new Error('Invalid account link start response: missing accountLinkState');
    }
    return payload.accountLinkState;
  }
}

export const emdashAccountService = new EmdashAccountService();
