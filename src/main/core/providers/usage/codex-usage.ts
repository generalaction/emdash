import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  ProviderUsage,
  ProviderUsageResult,
  ProviderUsageWindow,
} from '@shared/provider-usage';
import { log } from '@main/lib/logger';

const AUTH_FILE = path.join(os.homedir(), '.codex', 'auth.json');
const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';
const REFRESH_URL = 'https://auth.openai.com/oauth/token';
const OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';

type CodexAuth = {
  accessToken: string;
  refreshToken: string | null;
  accountId: string | null;
  email: string | null;
};

type ChatGptWindow = {
  used_percent?: number;
  reset_at?: number;
  limit_window_seconds?: number;
} | null;

type ChatGptUsageResponse = {
  plan_type?: string;
  email?: string;
  rate_limit?: {
    primary_window?: ChatGptWindow;
    secondary_window?: ChatGptWindow;
  };
  credits?: {
    has_credits?: boolean;
    balance?: string;
  };
};

function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const segments = token.split('.');
    if (segments.length !== 3) return null;
    const padded = segments[1].replace(/-/g, '+').replace(/_/g, '/');
    const padding = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
    const decoded = Buffer.from(padded + padding, 'base64').toString('utf8');
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractClaims(idToken: string): { accountId: string | null; email: string | null } {
  const claims = decodeJwt(idToken);
  if (!claims) return { accountId: null, email: null };
  const auth = claims['https://api.openai.com/auth'] as Record<string, unknown> | undefined;
  const accountId = auth?.['chatgpt_account_id'];
  const email = claims['email'];
  return {
    accountId: typeof accountId === 'string' ? accountId : null,
    email: typeof email === 'string' ? email : null,
  };
}

async function readCodexAuth(): Promise<CodexAuth | null> {
  try {
    const raw = await fs.readFile(AUTH_FILE, 'utf8');
    const parsed = JSON.parse(raw) as {
      tokens?: {
        access_token?: string;
        refresh_token?: string;
        id_token?: string;
      };
    };
    const tokens = parsed.tokens;
    if (!tokens?.access_token) return null;
    const { accountId, email } = tokens.id_token
      ? extractClaims(tokens.id_token)
      : { accountId: null, email: null };
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      accountId,
      email,
    };
  } catch {
    return null;
  }
}

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  try {
    const response = await fetch(REFRESH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: OAUTH_CLIENT_ID,
      }),
    });
    if (!response.ok) return null;
    const json = (await response.json()) as { access_token?: string };
    return json.access_token ?? null;
  } catch (error) {
    log.warn('[codex-usage] token refresh failed', error);
    return null;
  }
}

async function callUsageApi(
  accessToken: string,
  accountId: string | null
): Promise<ChatGptUsageResponse | { unauthorized: true } | null> {
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    };
    if (accountId) headers['chatgpt-account-id'] = accountId;
    const response = await fetch(USAGE_URL, { headers });
    if (response.status === 401 || response.status === 403) {
      return { unauthorized: true };
    }
    if (!response.ok) return null;
    return (await response.json()) as ChatGptUsageResponse;
  } catch (error) {
    log.warn('[codex-usage] usage API call failed', error);
    return null;
  }
}

function toWindow(label: string, raw: ChatGptWindow): ProviderUsageWindow | null {
  if (!raw || typeof raw.used_percent !== 'number') return null;
  const resetsAt =
    typeof raw.reset_at === 'number' ? new Date(raw.reset_at * 1000).toISOString() : null;
  return {
    label,
    utilization: Math.max(0, Math.min(100, raw.used_percent)),
    resetsAt,
  };
}

export async function fetchCodexUsage(): Promise<ProviderUsageResult> {
  const auth = await readCodexAuth();
  if (!auth) return { status: 'unauthenticated' };

  let response = await callUsageApi(auth.accessToken, auth.accountId);
  if (response && 'unauthorized' in response && auth.refreshToken) {
    const newToken = await refreshAccessToken(auth.refreshToken);
    if (newToken) response = await callUsageApi(newToken, auth.accountId);
  }
  if (!response) return { status: 'error', message: 'Failed to fetch usage' };
  if ('unauthorized' in response) return { status: 'unauthenticated' };

  const rateLimit = response.rate_limit ?? {};
  const primaryLabel = windowLabel(rateLimit.primary_window ?? null, '5-hour limit');
  const secondaryLabel = windowLabel(rateLimit.secondary_window ?? null, 'Weekly limit');
  const windows: ProviderUsageWindow[] = [
    toWindow(primaryLabel, rateLimit.primary_window ?? null),
    toWindow(secondaryLabel, rateLimit.secondary_window ?? null),
  ].filter((w): w is ProviderUsageWindow => w !== null);

  const usage: ProviderUsage = {
    providerId: 'codex',
    plan: response.plan_type ?? null,
    account: response.email ?? auth.email,
    windows,
    credits: null,
    fetchedAt: Date.now(),
  };
  return { status: 'ok', usage };
}

function windowLabel(raw: ChatGptWindow, fallback: string): string {
  if (!raw || typeof raw.limit_window_seconds !== 'number') return fallback;
  const seconds = raw.limit_window_seconds;
  if (seconds <= 6 * 60 * 60) return `${Math.round(seconds / 3600)}-hour limit`;
  const days = Math.round(seconds / (24 * 60 * 60));
  return days === 7 ? 'Weekly limit' : `${days}-day limit`;
}
