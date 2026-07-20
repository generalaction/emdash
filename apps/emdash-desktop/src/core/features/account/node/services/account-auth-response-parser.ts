import { err, ok, type Result } from '@emdash/shared';
import type { AccountInvalidAuthResponseError } from '../account-errors';
import type { AccountUser, AuthProviderToken, SignInExchange } from '../account-types';
import type { ProviderAccountPayload } from '../provider-token-registry';

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

function parseOptionalProviderToken(raw: Record<string, unknown>): AuthProviderToken | undefined {
  const accessToken = typeof raw.accessToken === 'string' ? raw.accessToken : undefined;
  const providerId = typeof raw.providerId === 'string' ? raw.providerId : undefined;
  if (!accessToken || !providerId) return undefined;

  return {
    accessToken,
    providerId,
    providerAccount: parseProviderAccountPayload(raw.providerAccount),
  };
}

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
