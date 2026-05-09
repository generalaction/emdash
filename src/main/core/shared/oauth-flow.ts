import { createHash, randomBytes } from 'crypto';
import * as http from 'http';
import { shell } from 'electron';

export interface OAuthFlowOptions {
  authorizeUrl: string;
  exchangeUrl: string;
  successRedirectUrl: string;
  errorRedirectUrl: string;
  extraParams?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * Execute a full PKCE OAuth flow:
 * 1. Generate PKCE challenge + state
 * 2. Start ephemeral loopback HTTP server
 * 3. Open browser to authorizeUrl with PKCE params
 * 4. Wait for callback with code
 * 5. Exchange code for tokens
 *
 * Returns the raw JSON response from the exchange endpoint.
 * Each caller extracts what it needs.
 */
export async function executeOAuthFlow(
  options: OAuthFlowOptions
): Promise<Record<string, unknown>> {
  const {
    authorizeUrl,
    exchangeUrl,
    successRedirectUrl,
    errorRedirectUrl,
    extraParams,
    timeoutMs = 300_000,
  } = options;

  const state = randomBytes(12).toString('base64url');
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

  const { code } = await startLoopbackServer({
    authorizeUrl,
    successRedirectUrl,
    errorRedirectUrl,
    state,
    codeChallenge,
    extraParams,
    timeoutMs,
  });

  return exchangeCode(exchangeUrl, state, code, codeVerifier);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface LoopbackOptions {
  authorizeUrl: string;
  successRedirectUrl: string;
  errorRedirectUrl: string;
  state: string;
  codeChallenge: string;
  extraParams?: Record<string, string>;
  timeoutMs: number;
}

function startLoopbackServer(opts: LoopbackOptions): Promise<{ code: string }> {
  const {
    authorizeUrl,
    successRedirectUrl,
    errorRedirectUrl,
    state,
    codeChallenge,
    extraParams,
    timeoutMs,
  } = opts;

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.writeHead(400).end();
        return;
      }

      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }

      const returnedState = url.searchParams.get('state');
      const code = url.searchParams.get('code');

      if (returnedState !== state || !code) {
        res.writeHead(302, { Location: errorRedirectUrl }).end();
        reject(new Error('State mismatch or missing code in OAuth callback'));
        setTimeout(() => server.close(), 1000);
        return;
      }

      res.writeHead(302, { Location: successRedirectUrl }).end();
      resolve({ code });
      setTimeout(() => server.close(), 2000);
    });

    const timeout = setTimeout(() => {
      server.close();
      reject(new Error('OAuth authentication timed out'));
    }, timeoutMs);

    server.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    server.on('close', () => {
      clearTimeout(timeout);
    });

    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      const redirectUri = `http://127.0.0.1:${port}/callback`;

      const params = new URLSearchParams({
        state,
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        ...extraParams,
      });

      const fullUrl = `${authorizeUrl}?${params.toString()}`;

      shell.openExternal(fullUrl).catch((err) => {
        clearTimeout(timeout);
        server.close();
        reject(new Error(`Failed to open browser: ${err.message}`));
      });
    });
  });
}

async function exchangeCode(
  exchangeUrl: string,
  state: string,
  code: string,
  codeVerifier: string
): Promise<Record<string, unknown>> {
  const response = await fetch(exchangeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state, code, code_verifier: codeVerifier }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || `Token exchange failed (${response.status})`);
  }

  return (await response.json()) as Record<string, unknown>;
}
