export const GITHUB_CONFIG = {
  clientId: 'Ov23ligC35uHWopzCeWf',
  scopes: ['repo', 'read:user', 'read:org'],

  oauthServer: {
    baseUrl: process.env.EMDASH_AUTH_SERVER_URL || 'auth.emdash.sh',
    authTimeoutMs: Number(process.env.EMDASH_AUTH_TIMEOUT_MS || 300000),
  },
};
