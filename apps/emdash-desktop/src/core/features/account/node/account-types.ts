import type { ProviderAccountIdentity } from '@core/primitives/provider-accounts/api';

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
  user: AccountUser;
}

export interface LinkProviderAccountResult {
  provider: string;
  providerAccountStatus?: 'created' | 'updated';
  providerAccount?: ProviderAccountIdentity;
}

export interface SessionState {
  user: AccountUser | null;
  isSignedIn: boolean;
  hasAccount: boolean;
}

export interface AuthProviderToken {
  accessToken: string;
  /** Epoch milliseconds; absent for tokens that do not expire. */
  expiresAt?: number;
  providerId: string;
  providerAccount?: ProviderAccountIdentity;
}

/** A replacement access token from the auth server, which keeps the refresh token. */
export interface RenewedProviderToken {
  accessToken: string;
  /** Epoch milliseconds; absent for tokens that do not expire. */
  expiresAt?: number;
}

export interface SignInExchange {
  sessionToken: string;
  user: AccountUser;
  providerToken?: AuthProviderToken;
}

export interface SessionSnapshot {
  token: string | null;
  profile: CachedProfile | null;
}

export type SessionValidationResult = 'valid' | 'invalid' | 'unknown';
