import { APIErrorCode, ClientErrorCode, isNotionClientError } from '@notionhq/client';
import type { IntegrationError } from '../../types';

export function toNotionIntegrationError(
  error: unknown,
  fallback = 'Notion request failed.'
): IntegrationError {
  if (!isNotionClientError(error)) {
    if (error instanceof Error) return { type: 'generic', message: error.message || fallback };
    return { type: 'generic', message: fallback };
  }

  switch (error.code) {
    case APIErrorCode.Unauthorized:
      return {
        type: 'auth_failed',
        message: 'Notion authentication failed. Check your integration token.',
      };
    case APIErrorCode.RestrictedResource:
      return {
        type: 'auth_failed',
        message: 'Notion token is missing the required capabilities or page access.',
      };
    case APIErrorCode.ObjectNotFound:
      return {
        type: 'not_found_or_no_access',
        message: 'Notion resource was not found or the integration does not have access.',
      };
    case APIErrorCode.RateLimited:
      return {
        type: 'rate_limited',
        message: 'Notion API rate limit exceeded. Please try again shortly.',
      };
    case APIErrorCode.InternalServerError:
    case APIErrorCode.ServiceUnavailable:
    case APIErrorCode.GatewayTimeout:
    case ClientErrorCode.RequestTimeout:
      return {
        type: 'host_unreachable',
        message: 'Notion API is temporarily unavailable. Please try again.',
      };
    case APIErrorCode.InvalidJSON:
    case APIErrorCode.InvalidRequestURL:
    case APIErrorCode.InvalidRequest:
    case APIErrorCode.ValidationError:
    case APIErrorCode.ConflictError:
    case ClientErrorCode.InvalidPathParameter:
    case ClientErrorCode.ResponseError:
      return { type: 'generic', message: error.message || fallback };
  }
}
