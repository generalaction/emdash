import * as http from 'http';
import { randomBytes, createHash } from 'crypto';
import { net, shell } from 'electron';
import { GITHUB_CONFIG } from '../config/github.config';

const AUTH_TIMEOUT_MS = GITHUB_CONFIG.oauthServer.authTimeoutMs;

const EMDASH_LOGO_SVG = `<svg width="499" height="70" viewBox="0 0 499 70" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M127.327 69.301V0.16436H177.169V11.8583H141.284V27.1862H177.169V38.8365H141.284V57.6507H177.169V69.301H127.327Z" fill="black"/><path d="M446.218 49.9505C444.437 41.4368 435.77 39.3876 425.147 37.792C416.426 36.4696 410.366 36.0106 410.759 31.2401C411.021 28.0543 414.442 25.0871 419.54 24.639C426.682 23.9997 431.229 27.6609 432.737 33.9396L444.611 33.0543C443.726 24.874 436.89 15.7811 420.59 15.7702C402.48 15.7592 394.606 26.7975 397.027 35.3767C399.661 44.7264 410.305 45.6335 418.098 46.6499C427.721 47.9013 432.972 49.639 432.868 53.6609C432.808 56.2128 429.868 59.1527 422.513 59.2456C414.251 59.3385 409.305 55.7647 407.568 49.6937L395.021 50.5789C395.896 60.5297 405.611 69.9887 420.825 69.9887C439.688 69.9887 448.469 60.6773 446.218 49.945V49.9505Z" fill="black"/><path d="M313.382 0V22.1093C308.885 18.153 303.076 15.7814 296.748 15.7814C282.453 15.7814 270.846 27.918 270.846 42.8852C270.846 57.8525 282.453 70 296.748 70C303.076 70 308.885 67.6284 313.382 63.6612L314.852 69.306H326.524V0H313.387H313.382ZM298.966 59.5902C290.453 59.5902 283.562 52.306 283.562 43.3224C283.562 34.3388 290.458 27.0656 298.966 27.0656C305.568 27.0656 311.185 31.4426 313.382 37.6066C314.021 39.377 314.36 41.3115 314.36 43.3224C314.36 45.3333 314.016 47.2678 313.382 49.0492C311.185 55.2131 305.568 59.5902 298.966 59.5902Z" fill="black"/><path d="M375.71 17.4803V22.1087C371.213 18.1524 365.404 15.7808 359.076 15.7808C344.781 15.7808 333.174 27.9174 333.174 42.8846C333.174 57.8519 344.781 69.9994 359.076 69.9994C365.404 69.9994 371.213 67.6278 375.71 63.6606L377.18 69.3054H388.852V17.4803H375.715H375.71ZM361.295 59.5896C352.781 59.5896 345.89 52.3054 345.89 43.3218C345.89 34.3382 352.786 27.065 361.295 27.065C367.896 27.065 373.513 31.442 375.71 37.606C376.349 39.3765 376.688 41.3109 376.688 43.3218C376.688 45.3327 376.344 47.2672 375.71 49.0486C373.513 55.2125 367.896 59.5896 361.295 59.5896Z" fill="black"/><path d="M262.223 26.2893C257.879 19.0926 248.907 15.486 241.185 16.5243C234.081 17.4806 228.868 21.9615 226.524 24.3713C221.95 18.2456 214.355 15.1418 207.404 16.5243C200.223 17.9505 196.857 21.7538 196.857 21.7538L195.59 17.4642H184.251V69.2893H196.863V43.2292C196.863 35.9505 197.24 33.6992 199.448 31.191C203.928 26.0926 212.191 26.0871 216.032 31.191C218.311 34.2183 218.12 39.0325 218.12 43.2292V69.2893C218.12 69.3276 230.726 69.2893 230.726 69.2893V38.8795C230.923 34.8904 231.54 33.1145 233.229 31.1964C237.71 26.0981 245.972 26.0926 249.814 31.1964C252.092 34.2237 251.901 39.038 251.901 43.2347V69.2948C251.901 69.333 264.508 69.2948 264.508 69.2948V38.5625C264.508 33.7593 264.109 29.4095 262.229 26.2948L262.223 26.2893Z" fill="black"/><path d="M465.032 69.2842H452.42V0H465.032V21.7486C465.032 21.7486 468.437 18.1366 475.579 16.5191C484.07 14.6011 492.245 18.3169 496.202 24.4918C498.601 28.235 498.874 33.2514 498.901 37.9016C498.945 46.5246 498.901 69.2842 498.901 69.2842C498.901 69.2842 486.294 69.3224 486.294 69.2842V43.224C486.294 39.0273 486.486 34.2131 484.207 31.1858C480.366 26.082 472.103 26.0874 467.622 31.1858C465.415 33.694 465.038 35.9454 465.038 43.224V69.2842H465.032Z" fill="black"/><path d="M23.235 23.2454H103.519L80.2841 51.1252H0L23.235 23.2454Z" fill="black"/></svg>`;

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function callbackPage(title: string, description: string): string {
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle} - Emdash</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  background:#f4f4f5;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:1rem}
.logo{height:20px;margin-bottom:2rem}
.card{background:#fff;border:1px solid #e4e4e7;border-radius:12px;width:320px;padding:1.5rem 2rem;text-align:center}
.card h1{font-size:1rem;font-weight:500;color:#09090b;margin-bottom:0.25rem}
.card p{font-size:0.875rem;color:#71717a;line-height:1.4}
</style></head>
<body>${EMDASH_LOGO_SVG.replace('width="499" height="70"', 'class="logo" width="499" height="70"')}
<div class="card"><h1>${safeTitle}</h1><p>${safeDescription}</p></div>
</body></html>`;
}

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
            callbackPage('Sign-in failed', 'Invalid state or missing code. You can close this tab.')
          );
          reject(new Error('State mismatch or missing code in OAuth callback'));
          setTimeout(() => server.close(), 1000);
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(callbackPage('Success', 'You can close this tab and return to Emdash.'));

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
      signal: AbortSignal.timeout(30_000),
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
