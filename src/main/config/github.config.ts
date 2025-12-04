// Debug: Log if env vars are loaded (remove after testing)
const hasClientId = !!process.env.GITHUB_CLIENT_ID;
const hasClientSecret = !!process.env.GITHUB_CLIENT_SECRET;
if (!hasClientId || !hasClientSecret) {
  console.warn('[GitHub OAuth] Environment variables not loaded from .env file');
  console.warn('[GitHub OAuth] GITHUB_CLIENT_ID:', hasClientId ? '✓' : '✗');
  console.warn('[GitHub OAuth] GITHUB_CLIENT_SECRET:', hasClientSecret ? '✓' : '✗');
}

export const GITHUB_OAUTH_CONFIG = {
  clientId: process.env.GITHUB_CLIENT_ID || 'YOUR_CLIENT_ID_HERE',
  clientSecret: process.env.GITHUB_CLIENT_SECRET || 'YOUR_CLIENT_SECRET_HERE',
  scopes: ['repo', 'read:user', 'read:org'],
  callbackPort: 8888,
  redirectUri: 'http://localhost:8888/callback',
};


