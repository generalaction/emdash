import { err, ok, type Result } from '@emdash/shared';
import type { IntegrationError } from '../types';

const NETWORK_ERROR_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN']);

export function normalizeHostedInstanceUrl(instanceUrl: string): string | null {
  const trimmed = instanceUrl.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    if (parsed.search || parsed.hash) {
      return null;
    }

    const pathname = parsed.pathname.replace(/\/+$/, '');
    return pathname && pathname !== '/'
      ? `${parsed.protocol}//${parsed.host}${pathname}`
      : `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

export function hasKnownNetworkErrorCode(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  return typeof code === 'string' && NETWORK_ERROR_CODES.has(code);
}

export function checkRemoteHostMatchesInstance(
  remoteHost: string,
  instanceUrl: string,
  providerName: string
): Result<void, IntegrationError> {
  let instanceHost: string;
  try {
    instanceHost = new URL(instanceUrl).hostname.toLowerCase();
  } catch {
    return err({
      type: 'invalid_input',
      message: `A valid ${providerName} instance URL is required.`,
    });
  }

  if (remoteHost !== instanceHost) {
    return err({
      type: 'unsupported_host',
      message: `Git remote host "${remoteHost}" does not match configured ${providerName} instance "${instanceHost}".`,
    });
  }

  return ok(undefined);
}
