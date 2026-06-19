import type { ProviderAccountPayload } from './provider-token-registry';

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
  providerAccount?: ProviderAccountPayload;
}

export interface SessionState {
  user: AccountUser | null;
  isSignedIn: boolean;
  hasAccount: boolean;
}

export interface AuthProviderToken {
  accessToken: string;
  providerId: string;
  providerAccount?: ProviderAccountPayload;
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
