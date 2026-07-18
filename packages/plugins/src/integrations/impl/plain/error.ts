import {
  AuthenticationError,
  ForbiddenError,
  InternalError,
  NetworkError,
  PlainError,
  RateLimitError,
} from '@team-plain/graphql';
import type { IntegrationError } from '../../types';

export function toPlainIntegrationError(
  error: unknown,
  fallback = 'Plain request failed.'
): IntegrationError {
  if (error instanceof AuthenticationError) {
    return {
      type: 'auth_failed',
      message: error.message || 'Plain authentication failed. Check your API key.',
    };
  }

  if (error instanceof ForbiddenError) {
    return {
      type: 'auth_failed',
      message: error.message || 'Plain API key was accepted but is missing required permissions.',
    };
  }

  if (error instanceof RateLimitError) {
    return {
      type: 'rate_limited',
      message: error.message || 'Plain API rate limit exceeded. Please try again shortly.',
    };
  }

  if (error instanceof NetworkError || error instanceof InternalError) {
    return {
      type: 'host_unreachable',
      message: error.message || 'Plain API is temporarily unavailable. Please try again.',
    };
  }

  if (error instanceof PlainError || error instanceof Error) {
    return { type: 'generic', message: error.message || fallback };
  }

  return { type: 'generic', message: fallback };
}
