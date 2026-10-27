const PRODUCTION_AUTH_SERVER_URL = 'https://auth.emdash.sh';

export const ACCOUNT_CONFIG = {
  authServer: {
    baseUrl: resolveAuthServerBaseUrl(process.env.AGENT_AUTH_SERVER_URL, import.meta.env.DEV),
    authTimeoutMs: Number(process.env.AGENT_AUTH_TIMEOUT_MS || 300000),
  },
};

/**
 * Development builds may target another auth server, e.g. a local one; packaged
 * builds always use production, because the server receives session and provider
 * tokens.
 */
export function resolveAuthServerBaseUrl(override: string | undefined, isDev: boolean): string {
  const value = override?.trim();
  if (!isDev || !value) return PRODUCTION_AUTH_SERVER_URL;
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`AGENT_AUTH_SERVER_URL must be an http(s) URL: ${value}`);
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}
