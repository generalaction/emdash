export const ACCOUNT_CONFIG = {
  authServer: {
    baseUrl: 'https://auth.emdash.sh',
    authTimeoutMs: Number(process.env.EMDASH_AUTH_TIMEOUT_MS || 300000),
  },
};
