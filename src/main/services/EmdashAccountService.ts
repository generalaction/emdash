import { net } from 'electron';
import { GITHUB_CONFIG } from '../config/github.config';
import { log } from '../lib/logger';
import { accountCredentialStore } from './AccountCredentialStore';
import { accountProfileCache } from './AccountProfileCache';
import type { CachedProfile } from './AccountProfileCache';
import { oauthFlowService } from './OAuthFlowService';
import type { AccountUser, ExchangeResult } from './OAuthFlowService';

export type { AccountUser, ExchangeResult };

interface SignInResult {
  accessToken: string;
  providerId: string;
  user: AccountUser;
}

interface SessionState {
  user: AccountUser | null;
  isSignedIn: boolean;
  hasAccount: boolean;
}

export class EmdashAccountService {
  private cachedProfile: CachedProfile | null = null;
  private sessionToken: string | null = null;
  private initialized = false;

  /**
   * Load cached profile from disk on first access.
   */
  private ensureInitialized(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.cachedProfile = accountProfileCache.read();
  }

  /**
   * Get current session state synchronously (uses cached data).
   */
  getSession(): SessionState {
    this.ensureInitialized();
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

  /**
   * Initialize session token from keychain (call on app startup).
   */
  async loadSessionToken(): Promise<void> {
    this.sessionToken = await accountCredentialStore.get();
  }

  /**
   * Quick health check — returns true if the auth server responds within 3s.
   */
  async checkServerHealth(): Promise<boolean> {
    const { baseUrl } = GITHUB_CONFIG.oauthServer;
    try {
      const response = await net.fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Validate session against the auth server. Returns true if session is valid.
   */
  async validateSession(): Promise<boolean> {
    const token = this.sessionToken;
    if (!token) return false;

    const { baseUrl } = GITHUB_CONFIG.oauthServer;
    try {
      const response = await net.fetch(`${baseUrl}/api/auth/get-session`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(3000),
      });

      if (!response.ok) {
        this.sessionToken = null;
        await accountCredentialStore.clear();
        if (this.cachedProfile) {
          this.cachedProfile.hasAccount = true;
          accountProfileCache.write(this.cachedProfile);
        }
        return false;
      }

      if (this.cachedProfile) {
        this.cachedProfile.lastValidated = new Date().toISOString();
        accountProfileCache.write(this.cachedProfile);
      }
      return true;
    } catch {
      return this.sessionToken !== null;
    }
  }

  /**
   * Run the OAuth sign-in flow, store tokens, and update profile cache.
   */
  async signIn(): Promise<SignInResult> {
    const result = await oauthFlowService.startFlow();

    await accountCredentialStore.set(result.sessionToken);
    this.sessionToken = result.sessionToken;

    const profile: CachedProfile = {
      hasAccount: true,
      userId: result.user.userId,
      username: result.user.username,
      avatarUrl: result.user.avatarUrl,
      email: result.user.email,
      lastValidated: new Date().toISOString(),
    };
    this.cachedProfile = profile;
    accountProfileCache.write(profile);

    return { accessToken: result.accessToken, providerId: result.providerId, user: result.user };
  }

  /**
   * Sign out — clear session token but keep hasAccount: true so we can
   * prompt the user to re-sign-in later.
   */
  async signOut(): Promise<void> {
    this.sessionToken = null;
    await accountCredentialStore.clear();
  }
}

export const emdashAccountService = new EmdashAccountService();
