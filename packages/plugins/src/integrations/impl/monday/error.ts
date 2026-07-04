import { ClientError } from '@mondaydotcomorg/api';
import type { IntegrationError } from '../../types';

export const MONDAY_API_ERROR_MESSAGES = {
  AUTH_FAILED: 'Monday.com authentication failed. Check your API token.',
  MISSING_PERMISSIONS: 'Monday.com token was accepted but is missing required permissions.',
  RATE_LIMITED: 'Monday.com API rate limit exceeded. Please try again shortly.',
  UNAVAILABLE: 'Monday.com API is temporarily unavailable. Please try again.',
} as const;

export function toMondayIntegrationError(
  error: unknown,
  fallback = 'Monday.com request failed.'
): IntegrationError {
  const status = getStatus(error);
  const apiMessage = getApiMessage(error);

  if (status === 401) {
    return {
      type: 'auth_failed',
      message: apiMessage ?? MONDAY_API_ERROR_MESSAGES.AUTH_FAILED,
    };
  }

  if (status === 403) {
    return {
      type: 'auth_failed',
      message: apiMessage ?? MONDAY_API_ERROR_MESSAGES.MISSING_PERMISSIONS,
    };
  }

  if (status === 429) {
    return {
      type: 'rate_limited',
      message: apiMessage ?? MONDAY_API_ERROR_MESSAGES.RATE_LIMITED,
    };
  }

  if (typeof status === 'number' && status >= 500) {
    return {
      type: 'host_unreachable',
      message: apiMessage ?? MONDAY_API_ERROR_MESSAGES.UNAVAILABLE,
    };
  }

  if (apiMessage) return { type: 'generic', message: apiMessage };
  if (error instanceof Error && error.message) return { type: 'generic', message: error.message };
  return { type: 'generic', message: fallback };
}

function getStatus(error: unknown): number | undefined {
  if (error instanceof ClientError) return error.response.status;
  return undefined;
}

function getApiMessage(error: unknown): string | undefined {
  if (error instanceof ClientError) {
    const message = error.response.errors?.[0]?.message;
    return message || error.message || undefined;
  }

  return error instanceof Error && error.message ? error.message : undefined;
}
