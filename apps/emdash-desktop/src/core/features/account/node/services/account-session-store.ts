import { err, ok, toSerializedError, type Result } from '@emdash/shared';
import { Result as ResultUtil } from '@emdash/shared/result';
import {
  type AccountNotSignedInError,
  type AccountSessionPersistenceError,
  unknownErrorMessage,
} from '../account-errors';
import type { AccountUser, CachedProfile, SessionSnapshot, SessionState } from '../account-types';

export interface AccountKVSchema extends Record<string, unknown> {
  profile: CachedProfile;
}

export type AccountProfileKeyValueStore = {
  get(key: 'profile'): Promise<CachedProfile | null>;
  setOrThrow(key: 'profile', value: CachedProfile): Promise<void>;
};

export type AccountSessionCredentialStore = {
  get(): Promise<Result<string | null, AccountSessionPersistenceError>>;
  set(token: string): Promise<Result<void, AccountSessionPersistenceError>>;
  clear(): Promise<Result<void, AccountSessionPersistenceError>>;
};

export class AccountSessionStore {
  private cachedProfile: CachedProfile | null = null;
  private sessionToken: string | null = null;

  constructor(
    private readonly accountKV: AccountProfileKeyValueStore,
    private readonly credentials: AccountSessionCredentialStore
  ) {}

  async load(): Promise<Result<SessionSnapshot, AccountSessionPersistenceError>> {
    try {
      const [sessionToken, profile] = await Promise.all([
        this.credentials.get(),
        this.accountKV.get('profile'),
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
      this.cachedProfile = await this.accountKV.get('profile');
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
      const sessionToken = await this.credentials.get();
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
    return await ResultUtil.fromAsync(this.ensureTokenLoaded()).andThen((token) =>
      token === null
        ? err<AccountNotSignedInError>({
            type: 'not_signed_in',
            message: 'You must be signed in to link a provider account',
          })
        : ok(token)
    );
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

    return await ResultUtil.fromAsync(this.credentials.set(sessionToken)).andThen(async () => {
      try {
        await this.accountKV.setOrThrow('profile', profile);
        this.sessionToken = sessionToken;
        this.cachedProfile = profile;
        return ok();
      } catch (error) {
        return err(toSessionPersistenceError(error, 'Failed to persist account session'));
      }
    });
  }

  async markValidated(
    lastValidated: string
  ): Promise<Result<void, AccountSessionPersistenceError>> {
    if (!this.cachedProfile) return ok();

    try {
      this.cachedProfile = { ...this.cachedProfile, lastValidated };
      await this.accountKV.setOrThrow('profile', this.cachedProfile);
      return ok();
    } catch (error) {
      return err(toSessionPersistenceError(error, 'Failed to update account session'));
    }
  }

  async clearSessionPreservingAccount(): Promise<Result<void, AccountSessionPersistenceError>> {
    const clearedToken = await this.credentials.clear();
    if (!clearedToken.success) return clearedToken;
    this.sessionToken = null;

    try {
      const profile = this.cachedProfile ?? (await this.accountKV.get('profile'));
      if (!profile) return ok();

      this.cachedProfile = { ...profile, hasAccount: true };
      await this.accountKV.setOrThrow('profile', this.cachedProfile);
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
    cause: toSerializedError(error),
  };
}
