import type { IntegrationError } from '../types';
import { hasKnownNetworkErrorCode } from './hosted-instance';

type HttpErrorLike = Error & {
  code?: unknown;
  status?: number;
  statusCode?: number;
  cause?: {
    response?: {
      status?: number;
      statusCode?: number;
    };
  };
  response?: {
    status?: number;
    statusCode?: number;
    body?: unknown;
    text?: string;
  };
};

export function toIntegrationError(error: unknown, provider: string): IntegrationError {
  const status = getHttpStatus(error);

  if (status === 401) {
    return {
      type: 'auth_failed',
      message: `${provider} authentication failed. Check your credentials.`,
    };
  }

  if (status === 403) {
    return {
      type: 'auth_failed',
      message: `${provider} credentials were accepted but are missing required permissions.`,
    };
  }

  if (status === 404) {
    return {
      type: 'not_found_or_no_access',
      message: `${provider} resource was not found or you do not have access.`,
    };
  }

  if (status === 429) {
    return {
      type: 'rate_limited',
      message: `${provider} API rate limit exceeded. Please try again shortly.`,
    };
  }

  if (typeof status === 'number' && status >= 500) {
    return {
      type: 'host_unreachable',
      message: `${provider} API is temporarily unavailable. Please try again.`,
    };
  }

  if (hasKnownNetworkErrorCode(error)) {
    return {
      type: 'host_unreachable',
      message: `Unable to reach ${provider}. Check your URL and network connection.`,
    };
  }

  return {
    type: 'generic',
    message: `${provider} request failed.`,
  };
}

function getHttpStatus(error: unknown): number | undefined {
  if (!isHttpErrorLike(error)) return undefined;

  return (
    normalizeStatus(error.status) ??
    normalizeStatus(error.statusCode) ??
    normalizeStatus(error.response?.status) ??
    normalizeStatus(error.response?.statusCode) ??
    normalizeStatus(error.cause?.response?.status) ??
    normalizeStatus(error.cause?.response?.statusCode)
  );
}

function isHttpErrorLike(error: unknown): error is HttpErrorLike {
  return error instanceof Error;
}

function normalizeStatus(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : undefined;
}
