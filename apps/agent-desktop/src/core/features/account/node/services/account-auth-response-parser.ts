import { err, ok, type Result } from '@agent/shared';
import type { ProviderAccountIdentity } from '@core/primitives/provider-accounts/api';
import type { AccountInvalidAuthResponseError } from '../account-errors';
import type {
  AccountUser,
  AuthProviderToken,
  RenewedProviderToken,
  SignInExchange,
} from '../account-types';

export function parseSignInResponse(
  raw: Record<string, unknown>
): Result<SignInExchange, AccountInvalidAuthResponseError> {
  const sessionToken = typeof raw.sessionToken === 'string' ? raw.sessionToken : undefined;
  const user = parseAccountUser(raw.user);

  if (!sessionToken || !user) {
    return err({
      type: 'invalid_auth_response',
      message: 'Invalid sign-in response: missing sessionToken or user',
    });
  }

  return ok({
    sessionToken,
    user,
    providerToken: parseOptionalProviderToken(raw),
  });
}

export function parseRequiredProviderTokenResponse(
  raw: Record<string, unknown>
): Result<AuthProviderToken, AccountInvalidAuthResponseError> {
  const providerToken = parseOptionalProviderToken(raw);
  if (!providerToken) {
    return err({
      type: 'invalid_auth_response',
      message: 'Invalid account link response: missing provider token',
    });
  }

  return ok(providerToken);
}

function parseAccountUser(raw: unknown): AccountUser | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;

  const candidate = raw as Record<string, unknown>;
  if (
    typeof candidate.userId !== 'string' ||
    typeof candidate.username !== 'string' ||
    typeof candidate.avatarUrl !== 'string' ||
    typeof candidate.email !== 'string'
  ) {
    return undefined;
  }

  return {
    userId: candidate.userId,
    name: typeof candidate.name === 'string' ? candidate.name : undefined,
    username: candidate.username,
    avatarUrl: candidate.avatarUrl,
    email: candidate.email,
  };
}

export function parseRenewedProviderTokenResponse(
  raw: unknown
): Result<RenewedProviderToken, AccountInvalidAuthResponseError> {
  const candidate = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  if (typeof candidate.accessToken !== 'string' || candidate.accessToken.length === 0) {
    return err({
      type: 'invalid_auth_response',
      message: 'Invalid provider token response: missing access token',
    });
  }
  const expiresAt = parseExpiry(candidate.accessTokenExpiresAt);
  return ok({
    accessToken: candidate.accessToken,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  });
}

function parseOptionalProviderToken(raw: Record<string, unknown>): AuthProviderToken | undefined {
  const accessToken = typeof raw.accessToken === 'string' ? raw.accessToken : undefined;
  const providerId = typeof raw.providerId === 'string' ? raw.providerId : undefined;
  if (!accessToken || !providerId) return undefined;

  const expiresAt = parseExpiry(raw.accessTokenExpiresAt);
  return {
    accessToken,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    providerId,
    providerAccount: parseProviderAccountPayload(raw.providerAccount),
  };
}

/** ISO-8601 expiry as epoch milliseconds; `null`, absent, or unreadable means none. */
function parseExpiry(raw: unknown): number | undefined {
  if (typeof raw !== 'string') return undefined;
  const expiresAt = Date.parse(raw);
  return Number.isFinite(expiresAt) ? expiresAt : undefined;
}

function parseProviderAccountPayload(raw: unknown): ProviderAccountIdentity | undefined {
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
