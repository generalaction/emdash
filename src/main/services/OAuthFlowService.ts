import * as http from 'http';
import { randomBytes, createHash } from 'crypto';
import { net, shell } from 'electron';
import { GITHUB_CONFIG } from '../config/github.config';

const AUTH_TIMEOUT_MS = GITHUB_CONFIG.oauthServer.authTimeoutMs;

export interface AccountUser {
  userId: string;
  username: string;
  avatarUrl: string;
  email: string;
}

export interface ExchangeResult {
  sessionToken: string;
  githubToken: string;
  user: AccountUser;
}

export class OAuthFlowService {
  /**
   * Run the full OAuth sign-in flow:
   * 1. Generate PKCE challenge
   * 2. Start loopback server
   * 3. Open browser to auth server
   * 4. Wait for callback
   * 5. Exchange code for tokens
   */
  async startFlow(): Promise<ExchangeResult> {
    const state = randomBytes(12).toString('base64url');
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

    const { code } = await this.startLoopbackServer(state, codeChallenge);
    return this.exchangeCode(state, code, codeVerifier);
  }

  /**
   * Start an ephemeral HTTP server on 127.0.0.1:0 and wait for the OAuth callback.
   * Opens the browser to the auth server sign-in page.
   */
  private startLoopbackServer(
    state: string,
    codeChallenge: string
  ): Promise<{ code: string; port: number }> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        if (!req.url) {
          res.writeHead(400);
          res.end('Bad request');
          return;
        }

        const url = new URL(req.url, `http://${req.headers.host}`);
        if (url.pathname !== '/callback') {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        const returnedState = url.searchParams.get('state');
        const code = url.searchParams.get('code');

        if (returnedState !== state || !code) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(
            '<html><body><h1>Authentication failed</h1><p>Invalid state or missing code. You can close this tab.</p></body></html>'
          );
          reject(new Error('State mismatch or missing code in OAuth callback'));
          setTimeout(() => server.close(), 1000);
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(
          `<html><body style="font-family:-apple-system,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#0b1020;color:#e5e7eb"><div style="text-align:center"><h1>Success!</h1><p>You can close this tab and return to Emdash.</p></div></body></html>`
        );

        resolve({ code, port: (server.address() as any).port });
        setTimeout(() => server.close(), 2000);
      });

      const timeout = setTimeout(() => {
        server.close();
        reject(new Error('OAuth authentication timed out'));
      }, AUTH_TIMEOUT_MS);

      server.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      server.on('close', () => {
        clearTimeout(timeout);
      });

      server.listen(0, '127.0.0.1', () => {
        const port = (server.address() as any).port;
        const { baseUrl } = GITHUB_CONFIG.oauthServer;
        const redirectUri = `http://127.0.0.1:${port}/callback`;
        const signInUrl = `${baseUrl}/sign-in?provider=github&state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}&code_challenge=${encodeURIComponent(codeChallenge)}&code_challenge_method=S256`;

        shell.openExternal(signInUrl).catch((err) => {
          clearTimeout(timeout);
          server.close();
          reject(new Error(`Failed to open browser: ${err.message}`));
        });
      });
    });
  }

  /**
   * Exchange the one-time code with the auth server for tokens and user info.
   */
  private async exchangeCode(
    state: string,
    code: string,
    codeVerifier: string
  ): Promise<ExchangeResult> {
    const { baseUrl } = GITHUB_CONFIG.oauthServer;
    const response = await net.fetch(`${baseUrl}/api/v1/auth/electron/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, code, code_verifier: codeVerifier }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(payload?.error || `Token exchange failed (${response.status})`);
    }

    const data = (await response.json()) as ExchangeResult;
    if (!data.sessionToken || !data.githubToken || !data.user) {
      throw new Error('Invalid exchange response');
    }

    return data;
  }
}

export const oauthFlowService = new OAuthFlowService();
