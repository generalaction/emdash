import {
  AuthenticationLinearError,
  FeatureNotAccessibleLinearError,
  ForbiddenLinearError,
  InternalLinearError,
  InvalidInputLinearError,
  LinearError,
  NetworkLinearError,
  RatelimitedLinearError,
  UsageLimitExceededLinearError,
} from '@linear/sdk';
import type { IntegrationError } from '../../types';

export function toLinearIntegrationError(
  error: unknown,
  fallback = 'Linear request failed.'
): IntegrationError {
  if (error instanceof AuthenticationLinearError) {
    return { type: 'auth_failed', message: linearErrorMessage(error, fallback) };
  }

  if (error instanceof ForbiddenLinearError) {
    return { type: 'auth_failed', message: linearErrorMessage(error, fallback) };
  }

  if (error instanceof RatelimitedLinearError) {
    const resetAt = rateLimitResetAt(error);
    return {
      type: 'rate_limited',
      message: linearErrorMessage(error, fallback),
      ...(resetAt ? { resetAt } : {}),
    };
  }

  if (error instanceof UsageLimitExceededLinearError) {
    return { type: 'rate_limited', message: linearErrorMessage(error, fallback) };
  }

  if (error instanceof NetworkLinearError || error instanceof InternalLinearError) {
    return { type: 'host_unreachable', message: linearErrorMessage(error, fallback) };
  }

  if (error instanceof InvalidInputLinearError) {
    return { type: 'invalid_input', message: linearErrorMessage(error, fallback) };
  }

  if (error instanceof FeatureNotAccessibleLinearError) {
    return { type: 'not_found_or_no_access', message: linearErrorMessage(error, fallback) };
  }

  if (error instanceof LinearError) {
    return mapLinearError(error, fallback);
  }

  if (error instanceof Error) {
    return { type: 'generic', message: error.message || fallback };
  }

  return { type: 'generic', message: fallback };
}

function mapLinearError(error: LinearError, fallback: string): IntegrationError {
  const message = linearErrorMessage(error, fallback);

  if (error.status === 401) return { type: 'auth_failed', message };
  if (error.status === 403) return { type: 'auth_failed', message };
  if (error.status === 404) return { type: 'not_found_or_no_access', message };
  if (error.status === 429) return { type: 'rate_limited', message };
  if (error.status && error.status >= 500) return { type: 'host_unreachable', message };

  return { type: 'generic', message };
}

function linearErrorMessage(error: LinearError, fallback: string): string {
  return (
    error.errors?.find((graphqlError) => graphqlError.message)?.message || error.message || fallback
  );
}

function rateLimitResetAt(error: RatelimitedLinearError): string | undefined {
  const timestamp = error.requestsResetAt ?? error.complexityResetAt;
  if (!timestamp) return undefined;

  const milliseconds = timestamp > 10_000_000_000 ? timestamp : timestamp * 1000;
  return new Date(milliseconds).toISOString();
}
