import { KV } from '@main/db/kv';
import { err, ok, type Result } from '@shared/lib/result';
import {
  type AccountNotSignedInError,
  type AccountSessionPersistenceError,
  unknownErrorMessage,
} from '../account-errors';
import type { AccountUser, CachedProfile, SessionSnapshot, SessionState } from '../account-types';
import { accountCredentialStore } from './credential-store';

interface AccountKVSchema extends Record<string, unknown> {
  profile: CachedProfile;
}

const accountKV = new KV<AccountKVSchema>('account');

export class AccountSessionStore {
  private cachedProfile: CachedProfile | null = null;
  private sessionToken: string | null = null;

  async load(): Promise<Result<SessionSnapshot, AccountSessionPersistenceError>> {
    try {
      const [sessionToken, profile] = await Promise.all([
        accountCredentialStore.get(),
        accountKV.get('profile'),
      ]);
      if (!sessionToken.success) return sessionToken;

      this.sessionToken = sessionToken.data;
      this.cachedProfile = profile;
      return ok(this.snapshot());
    } catch (error) {
      return err(toSessionPersistenceError(error, 'Failed to load account session'));
    }
  }

  async getSession(): Promise<Result<SessionState, AccountSessionPersistenceError>> {
    try {
      this.cachedProfile = await accountKV.get('profile');
      return ok(this.toSessionState());
    } catch (error) {
      return err(toSessionPersistenceError(error, 'Failed to read account session'));
    }
  }

  snapshot(): SessionSnapshot {
    return {
      token: this.sessionToken,
      profile: this.cachedProfile,
    };
  }

  async ensureTokenLoaded(): Promise<Result<string | null, AccountSessionPersistenceError>> {
    if (this.sessionToken) return ok(this.sessionToken);

    try {
      const sessionToken = await accountCredentialStore.get();
      if (!sessionToken.success) return sessionToken;

      this.sessionToken = sessionToken.data;
      return ok(this.sessionToken);
    } catch (error) {
      return err(toSessionPersistenceError(error, 'Failed to load account session token'));
    }
  }

  async requireToken(): Promise<
    Result<string, AccountNotSignedInError | AccountSessionPersistenceError>
  > {
    const token = await this.ensureTokenLoaded();
    if (!token.success) return token;
    if (!token.data) {
      return err({
        type: 'not_signed_in',
        message: 'You must be signed in to link a provider account',
      });
    }
    return ok(token.data);
  }

  async saveSignedInSession(
    user: AccountUser,
    sessionToken: string,
    lastValidated: string
  ): Promise<Result<void, AccountSessionPersistenceError>> {
    const profile: CachedProfile = {
      hasAccount: true,
      userId: user.userId,
      name: user.name,
      username: user.username,
      avatarUrl: user.avatarUrl,
      email: user.email,
      lastValidated,
    };

    try {
      const persistedToken = await accountCredentialStore.set(sessionToken);
      if (!persistedToken.success) return persistedToken;

      await accountKV.setOrThrow('profile', profile);
      this.sessionToken = sessionToken;
      this.cachedProfile = profile;
      return ok();
    } catch (error) {
      return err(toSessionPersistenceError(error, 'Failed to persist account session'));
    }
  }

  async markValidated(
    lastValidated: string
  ): Promise<Result<void, AccountSessionPersistenceError>> {
    if (!this.cachedProfile) return ok();

    try {
      this.cachedProfile = { ...this.cachedProfile, lastValidated };
      await accountKV.setOrThrow('profile', this.cachedProfile);
      return ok();
    } catch (error) {
      return err(toSessionPersistenceError(error, 'Failed to update account session'));
    }
  }

  async clearSessionPreservingAccount(): Promise<Result<void, AccountSessionPersistenceError>> {
    const clearedToken = await accountCredentialStore.clear();
    if (!clearedToken.success) return clearedToken;
    this.sessionToken = null;

    try {
      const profile = this.cachedProfile ?? (await accountKV.get('profile'));
      if (!profile) return ok();

      this.cachedProfile = { ...profile, hasAccount: true };
      await accountKV.setOrThrow('profile', this.cachedProfile);
      return ok();
    } catch (error) {
      return err(toSessionPersistenceError(error, 'Failed to clear account session'));
    }
  }

  private toSessionState(): SessionState {
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
}

function toSessionPersistenceError(
  error: unknown,
  fallback: string
): AccountSessionPersistenceError {
  return {
    type: 'session_persistence_failed',
    message: unknownErrorMessage(error, fallback),
    cause: error,
  };
}
