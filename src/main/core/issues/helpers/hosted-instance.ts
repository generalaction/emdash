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

export function assertRemoteHostMatchesInstance(
  remoteHost: string,
  instanceUrl: string,
  providerName: string
): void {
  const instanceHost = new URL(instanceUrl).hostname.toLowerCase();
  if (remoteHost === instanceHost) {
    return;
  }

  throw new Error(
    `Git remote host "${remoteHost}" does not match configured ${providerName} instance "${instanceHost}".`
  );
}
