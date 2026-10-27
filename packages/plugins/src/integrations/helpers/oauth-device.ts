import { err, ok, type Result } from '@agent/shared';
import type { DeviceAuthorizationSession } from '../capabilities/auth';
import type { IntegrationCredentials } from '../host';
import type { IntegrationError } from '../types';
import { hasKnownNetworkErrorCode } from './hosted-instance';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Per-request limit; refreshes run under a per-account lock that every credential read waits on. */
const REQUEST_TIMEOUT_MS = 30_000;

export type DeviceAuthorization = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  /** Seconds until `deviceCode` expires. */
  expiresIn: number;
  /** Minimum seconds between token polls. */
  interval: number;
};

export type OAuthTokens = {
  accessToken: string;
  refreshToken?: string;
  /** Epoch milliseconds; absent when the server does not report a lifetime. */
  expiresAt?: number;
};

type TokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  error?: unknown;
  error_description?: unknown;
};

/**
 * Starts device authorization and returns the session shown to the user;
 * completing it polls for tokens and maps them with `toCredentials`.
 */
export async function startDeviceAuthorizationSession(options: {
  deviceAuthorizationUrl: string;
  tokenUrl: string;
  clientId: string;
  scopes: string[];
  provider: string;
  fetch?: FetchLike;
  toCredentials(tokens: OAuthTokens): Result<IntegrationCredentials, IntegrationError>;
}): Promise<Result<DeviceAuthorizationSession, IntegrationError>> {
  const authorization = await requestDeviceAuthorization({
    url: options.deviceAuthorizationUrl,
    clientId: options.clientId,
    scopes: options.scopes,
    provider: options.provider,
    fetch: options.fetch,
  });
  if (!authorization.success) return authorization;
  const { deviceCode: _deviceCode, interval: _interval, ...shown } = authorization.data;
  return ok({
    ...shown,
    async complete(signal: AbortSignal) {
      const tokens = await pollDeviceToken({
        url: options.tokenUrl,
        clientId: options.clientId,
        authorization: authorization.data,
        provider: options.provider,
        signal,
        fetch: options.fetch,
      });
      return tokens.success ? options.toCredentials(tokens.data) : tokens;
    },
  });
}

/** RFC 8628 §3.1: request a device and user code. */
export async function requestDeviceAuthorization(options: {
  url: string;
  clientId: string;
  scopes: string[];
  provider: string;
  fetch?: FetchLike;
}): Promise<Result<DeviceAuthorization, IntegrationError>> {
  const response = await post(options.fetch, options.url, {
    client_id: options.clientId,
    scope: options.scopes.join(' '),
  });
  if (!response.success) return err(networkError(options.provider, response.error));
  const body = (await readJson(response.data)) as Record<string, unknown> | null;
  if (!response.data.ok || !body || typeof body.device_code !== 'string') {
    return err(oauthError(options.provider, body, `${options.provider} sign-in could not start.`));
  }
  if (typeof body.user_code !== 'string' || typeof body.verification_uri !== 'string') {
    return err({
      type: 'generic',
      message: `${options.provider} returned an incomplete sign-in code.`,
    });
  }
  return ok({
    deviceCode: body.device_code,
    userCode: body.user_code,
    verificationUri: body.verification_uri,
    ...(typeof body.verification_uri_complete === 'string'
      ? { verificationUriComplete: body.verification_uri_complete }
      : {}),
    expiresIn: positiveNumber(body.expires_in) ?? 300,
    interval: positiveNumber(body.interval) ?? 5,
  });
}

/**
 * RFC 8628 §3.4–3.5: poll the token endpoint until the user approves, denies,
 * or the code expires. `slow_down` adds five seconds to the interval; network
 * failures and 5xx responses are retried until the code expires.
 */
export async function pollDeviceToken(options: {
  url: string;
  clientId: string;
  authorization: DeviceAuthorization;
  provider: string;
  signal: AbortSignal;
  fetch?: FetchLike;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}): Promise<Result<OAuthTokens, IntegrationError>> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? abortableSleep;
  const deadline = now() + options.authorization.expiresIn * 1000;
  let interval = options.authorization.interval;
  while (!options.signal.aborted) {
    await sleep(interval * 1000, options.signal);
    if (options.signal.aborted) break;
    if (now() >= deadline) return err(expired(options.provider));
    const response = await post(
      options.fetch,
      options.url,
      {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: options.authorization.deviceCode,
        client_id: options.clientId,
      },
      options.signal
    );
    if (!response.success || response.data.status >= 500) continue;
    const body = (await readJson(response.data)) as TokenResponse | null;
    if (response.data.ok && body) {
      const tokens = toTokens(body, now());
      if (tokens) return ok(tokens);
    }
    switch (body?.error) {
      case 'authorization_pending':
        continue;
      case 'slow_down':
        interval += 5;
        continue;
      case 'expired_token':
        return err(expired(options.provider));
      case 'access_denied':
        return err({ type: 'auth_failed', message: `${options.provider} sign-in was denied.` });
      default:
        return err(oauthError(options.provider, body, `${options.provider} sign-in failed.`));
    }
  }
  return err({ type: 'generic', message: `${options.provider} sign-in was cancelled.` });
}

/** RFC 6749 §6: exchange a refresh token. Some providers rotate the refresh token. */
export async function refreshOAuthToken(options: {
  url: string;
  clientId: string;
  refreshToken: string;
  provider: string;
  fetch?: FetchLike;
  now?: () => number;
}): Promise<Result<OAuthTokens, IntegrationError>> {
  const response = await post(options.fetch, options.url, {
    grant_type: 'refresh_token',
    refresh_token: options.refreshToken,
    client_id: options.clientId,
  });
  if (!response.success) return err(networkError(options.provider, response.error));
  const body = (await readJson(response.data)) as TokenResponse | null;
  const tokens = response.data.ok && body ? toTokens(body, (options.now ?? Date.now)()) : null;
  if (tokens) return ok(tokens);
  if (body?.error === 'invalid_grant') {
    return err({
      type: 'auth_failed',
      message: `${options.provider} sign-in expired. Reconnect your account.`,
    });
  }
  return err(oauthError(options.provider, body, `${options.provider} token refresh failed.`));
}

async function post(
  fetchImpl: FetchLike | undefined,
  url: string,
  params: Record<string, string>,
  signal?: AbortSignal
): Promise<Result<Response, unknown>> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  try {
    return ok(
      await (fetchImpl ?? fetch)(url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(params).toString(),
        redirect: 'error',
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      })
    );
  } catch (error) {
    return err(error);
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function toTokens(body: TokenResponse, now: number): OAuthTokens | null {
  if (typeof body.access_token !== 'string' || !body.access_token) return null;
  const expiresIn = positiveNumber(body.expires_in);
  return {
    accessToken: body.access_token,
    ...(typeof body.refresh_token === 'string' && body.refresh_token
      ? { refreshToken: body.refresh_token }
      : {}),
    ...(expiresIn !== undefined ? { expiresAt: now + expiresIn * 1000 } : {}),
  };
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function expired(provider: string): IntegrationError {
  return { type: 'auth_failed', message: `The ${provider} sign-in code expired. Try again.` };
}

function networkError(provider: string, error: unknown): IntegrationError {
  const timedOut = error instanceof Error && error.name === 'TimeoutError';
  return hasKnownNetworkErrorCode(error) || error instanceof TypeError || timedOut
    ? { type: 'host_unreachable', message: `Could not reach ${provider}.` }
    : { type: 'generic', message: `${provider} sign-in request failed.` };
}

function oauthError(provider: string, body: unknown, fallback: string): IntegrationError {
  const description =
    body && typeof body === 'object' && 'error_description' in body
      ? (body as TokenResponse).error_description
      : undefined;
  return {
    type: 'generic',
    message:
      typeof description === 'string' && description ? `${provider}: ${description}` : fallback,
  };
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
  });
}
