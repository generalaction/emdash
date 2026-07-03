import { readCredentialString, readCredentialStringArray } from '../../helpers/credentials';
import type { IntegrationCredentials } from '../../host';

const MONDAY_API_URL = 'https://api.monday.com/v2';

export const MONDAY_API_ERROR_MESSAGES = {
  AUTH_FAILED: 'Monday.com authentication failed. Check your API token.',
  MISSING_PERMISSIONS: 'Monday.com token was accepted but is missing required permissions.',
  RATE_LIMITED: 'Monday.com API rate limit exceeded. Please try again shortly.',
  UNAVAILABLE: 'Monday.com API is temporarily unavailable. Please try again.',
} as const;

export type MondayCredentials = {
  apiToken: string;
  boardIds: string[];
  boardUrls: string[];
};

export function toMondayApiErrorMessage(status: number, apiMessage?: string): string {
  if (apiMessage) return apiMessage;
  if (status === 401) return MONDAY_API_ERROR_MESSAGES.AUTH_FAILED;
  if (status === 403) return MONDAY_API_ERROR_MESSAGES.MISSING_PERMISSIONS;
  if (status === 429) return MONDAY_API_ERROR_MESSAGES.RATE_LIMITED;
  if (status >= 500) return MONDAY_API_ERROR_MESSAGES.UNAVAILABLE;
  return `Monday API error (${status})`;
}

export function readMondayCredentials(credentials: IntegrationCredentials): MondayCredentials {
  const apiToken = readCredentialString(credentials, 'apiToken');
  if (!apiToken) throw new Error('Monday.com API token cannot be empty.');

  return {
    apiToken,
    boardIds: [...new Set(readCredentialStringArray(credentials, 'boardIds'))],
    boardUrls: [...new Set(readCredentialStringArray(credentials, 'boardUrls'))],
  };
}

export function parseMondayBoardUrls(
  boardUrls: string
): Pick<MondayCredentials, 'boardIds' | 'boardUrls'> | null {
  const raw = boardUrls.trim();
  if (!raw) return { boardIds: [], boardUrls: [] };

  const urls = raw
    .split(/[,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const ids = new Set<string>();
  const normalizedUrls = new Set<string>();

  for (const url of urls) {
    const match = url.match(/(https?:\/\/[^/]+)\/boards\/(\d+)/);
    if (!match) return null;
    ids.add(match[2]);
    normalizedUrls.add(`${match[1]}/boards/${match[2]}`);
  }

  return { boardIds: [...ids], boardUrls: [...normalizedUrls] };
}

export async function mondayQuery<T>(
  token: string,
  queryStr: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const response = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token,
    },
    body: JSON.stringify({ query: queryStr, variables }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message = body?.errors?.[0]?.message ?? body?.error_message;
    throw new Error(toMondayApiErrorMessage(response.status, message));
  }

  const json = await response.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data as T;
}

async function fetchMe(token: string): Promise<{ id: string; name: string; accountName?: string }> {
  const data = await mondayQuery<{ me: { id: string; name: string; account: { name: string } } }>(
    token,
    'query { me { id name account { name } } }'
  );
  return { id: data.me.id, name: data.me.name, accountName: data.me.account?.name };
}

export async function verifyMondayCredentials(credentials: IntegrationCredentials) {
  const apiToken = readCredentialString(credentials, 'apiToken');
  if (!apiToken) throw new Error('Monday.com API token cannot be empty.');

  const existing = readMondayCredentials(credentials);
  const boardUrlInput = readCredentialString(credentials, 'boardUrls');
  const boardScope = boardUrlInput
    ? parseMondayBoardUrls(boardUrlInput)
    : { boardIds: existing.boardIds, boardUrls: existing.boardUrls };
  if (boardScope === null) {
    throw new Error(
      'Could not parse board ID from one or more URLs. Expected format: https://<team>.monday.com/boards/<id>'
    );
  }

  const me = await fetchMe(apiToken);
  return {
    displayName: me.accountName ?? me.name,
    displayDetail: me.accountName && me.name && me.accountName !== me.name ? me.name : undefined,
    credentials: {
      apiToken,
      ...boardScope,
    },
  };
}
