import { executeOAuthFlow } from '@main/core/shared/oauth-flow';
import { KV } from '@main/db/kv';
import { ACCOUNT_CONFIG } from '../config';
import { providerTokenRegistry } from '../provider-token-registry';
import { accountCredentialStore } from './credential-store';

export interface AccountUser {
  userId: string;
  username: string;
  avatarUrl: string;
  email: string;
}

export interface CachedProfile {
  hasAccount: boolean;
  userId: string;
  username: string;
  avatarUrl: string;
  email: string;
  lastValidated: string;
}

export interface SignInResult {
  providerToken?: string;
  provider?: string;
  user: AccountUser;
}

export interface SessionState {
  user: AccountUser | null;
  isSignedIn: boolean;
  hasAccount: boolean;
}

interface AccountKVSchema extends Record<string, unknown> {
  profile: CachedProfile;
}

const accountKV = new KV<AccountKVSchema>('account');

export class EmdashAccountService {
  private cachedProfile: CachedProfile | null = null;
  private sessionToken: string | null = null;

  async getSession(): Promise<SessionState> {
    this.cachedProfile = await accountKV.get('profile');
    const hasAccount = this.cachedProfile?.hasAccount === true;
    const isSignedIn = hasAccount && this.sessionToken !== null;
    return {
      user:
        isSignedIn && this.cachedProfile
          ? {
              userId: this.cachedProfile.userId,
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
    this.sessionToken = await accountCredentialStore.get();
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
      username: user.username,
      avatarUrl: user.avatarUrl,
      email: user.email,
      lastValidated: new Date().toISOString(),
    };
    this.cachedProfile = profile;
    await accountKV.set('profile', profile);

    const accessToken = raw.accessToken as string | undefined;
    const providerId = raw.providerId as string | undefined;
    if (accessToken && providerId) {
      await providerTokenRegistry.dispatch(providerId, accessToken);
    }

    return {
      providerToken: accessToken || undefined,
      provider: providerId || undefined,
      user,
    };
  }

  async signOut(): Promise<void> {
    this.sessionToken = null;
    await accountCredentialStore.clear();
    if (this.cachedProfile) {
      this.cachedProfile.hasAccount = true;
      await accountKV.set('profile', this.cachedProfile);
    }
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
}

export const emdashAccountService = new EmdashAccountService();
