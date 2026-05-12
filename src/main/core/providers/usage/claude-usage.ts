import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  ProviderUsage,
  ProviderUsageCredits,
  ProviderUsageResult,
  ProviderUsageWindow,
} from '@shared/provider-usage';
import { log } from '@main/lib/logger';

const execFileP = promisify(execFile);

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const OAUTH_BETA_HEADER = 'oauth-2025-04-20';
const KEYCHAIN_SERVICE = 'Claude Code-credentials';

type ClaudeCreds = {
  accessToken: string;
  refreshToken: string | null;
  subscriptionType: string | null;
};

type AnthropicUsageWindow = { utilization: number; resets_at: string | null } | null;

type AnthropicExtraUsage = {
  is_enabled?: boolean;
  monthly_limit?: number;
  used_credits?: number;
  currency?: string;
} | null;

type AnthropicUsageResponse = {
  five_hour?: AnthropicUsageWindow;
  seven_day?: AnthropicUsageWindow;
  seven_day_opus?: AnthropicUsageWindow;
  seven_day_sonnet?: AnthropicUsageWindow;
  extra_usage?: AnthropicExtraUsage;
};

async function readKeychainCreds(): Promise<ClaudeCreds | null> {
  if (process.platform !== 'darwin') return null;
  try {
    const { stdout } = await execFileP('security', [
      'find-generic-password',
      '-s',
      KEYCHAIN_SERVICE,
      '-w',
    ]);
    const parsed = JSON.parse(stdout.trim()) as {
      claudeAiOauth?: {
        accessToken?: string;
        refreshToken?: string;
        subscriptionType?: string;
      };
    };
    const oauth = parsed.claudeAiOauth;
    if (!oauth?.accessToken) return null;
    return {
      accessToken: oauth.accessToken,
      refreshToken: oauth.refreshToken ?? null,
      subscriptionType: oauth.subscriptionType ?? null,
    };
  } catch {
    return null;
  }
}

async function readFileCreds(): Promise<ClaudeCreds | null> {
  const filePath = path.join(os.homedir(), '.claude', '.credentials.json');
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as {
      claudeAiOauth?: {
        accessToken?: string;
        refreshToken?: string;
        subscriptionType?: string;
      };
    };
    const oauth = parsed.claudeAiOauth;
    if (!oauth?.accessToken) return null;
    return {
      accessToken: oauth.accessToken,
      refreshToken: oauth.refreshToken ?? null,
      subscriptionType: oauth.subscriptionType ?? null,
    };
  } catch {
    return null;
  }
}

async function readClaudeCreds(): Promise<ClaudeCreds | null> {
  return (await readKeychainCreds()) ?? (await readFileCreds());
}

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  try {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: OAUTH_CLIENT_ID,
      }).toString(),
    });
    if (!response.ok) return null;
    const json = (await response.json()) as { access_token?: string };
    return json.access_token ?? null;
  } catch (error) {
    log.warn('[claude-usage] token refresh failed', error);
    return null;
  }
}

async function callUsageApi(
  accessToken: string
): Promise<AnthropicUsageResponse | { unauthorized: true } | null> {
  try {
    const response = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'anthropic-beta': OAUTH_BETA_HEADER,
      },
    });
    if (response.status === 401 || response.status === 403) {
      return { unauthorized: true };
    }
    if (!response.ok) return null;
    return (await response.json()) as AnthropicUsageResponse;
  } catch (error) {
    log.warn('[claude-usage] usage API call failed', error);
    return null;
  }
}

function toWindow(label: string, raw: AnthropicUsageWindow): ProviderUsageWindow | null {
  if (!raw) return null;
  return {
    label,
    utilization: Math.max(0, Math.min(100, raw.utilization)),
    resetsAt: raw.resets_at,
  };
}

export async function fetchClaudeUsage(): Promise<ProviderUsageResult> {
  const creds = await readClaudeCreds();
  if (!creds) return { status: 'unauthenticated' };

  let response = await callUsageApi(creds.accessToken);
  if (response && 'unauthorized' in response && creds.refreshToken) {
    const newToken = await refreshAccessToken(creds.refreshToken);
    if (newToken) response = await callUsageApi(newToken);
  }
  if (!response) return { status: 'error', message: 'Failed to fetch usage' };
  if ('unauthorized' in response) return { status: 'unauthenticated' };

  const windows: ProviderUsageWindow[] = [
    toWindow('5-hour limit', response.five_hour ?? null),
    toWindow('Weekly (all models)', response.seven_day ?? null),
    toWindow('Weekly Sonnet', response.seven_day_sonnet ?? null),
    toWindow('Weekly Opus', response.seven_day_opus ?? null),
  ].filter((w): w is ProviderUsageWindow => w !== null);

  const extra = response.extra_usage;
  const credits: ProviderUsageCredits | null =
    extra && extra.is_enabled && typeof extra.monthly_limit === 'number'
      ? {
          label: 'Monthly credit pool',
          used: extra.used_credits ?? 0,
          limit: extra.monthly_limit,
          currency: extra.currency ?? 'USD',
        }
      : null;

  const usage: ProviderUsage = {
    providerId: 'claude',
    plan: creds.subscriptionType,
    account: null,
    windows,
    credits,
    fetchedAt: Date.now(),
  };
  return { status: 'ok', usage };
}
