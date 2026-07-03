import { readCredentialString, readCredentialStringArray } from '../../helpers/credentials';
import { mapWithConcurrency } from '../../helpers/map-with-concurrency';
import type { IntegrationCredentials } from '../../host';

const TRELLO_API_BASE_URL = 'https://api.trello.com/1';
const MAX_SELECTED_TRELLO_BOARDS = 20;
const TRELLO_REQUEST_CONCURRENCY = 5;

export const TRELLO_API_ERROR_MESSAGES = {
  AUTH_FAILED: 'Trello authentication failed. Check your API key and token.',
  MISSING_PERMISSIONS: 'Trello credentials were accepted but are missing required permissions.',
  RATE_LIMITED: 'Trello API rate limit exceeded. Please try again shortly.',
  UNAVAILABLE: 'Trello API is temporarily unavailable. Please try again.',
} as const;

export type TrelloAuth = {
  apiKey: string;
  apiToken: string;
};

export type TrelloCredentials = TrelloAuth & {
  boardIds: string[];
};

type TrelloMember = {
  id: string;
  fullName?: string;
  username?: string;
};

function toTrelloApiErrorMessage(status: number, apiMessage?: string): string {
  if (status === 401) return TRELLO_API_ERROR_MESSAGES.AUTH_FAILED;
  if (status === 403) return TRELLO_API_ERROR_MESSAGES.MISSING_PERMISSIONS;
  if (status === 429) return TRELLO_API_ERROR_MESSAGES.RATE_LIMITED;
  if (status >= 500) return TRELLO_API_ERROR_MESSAGES.UNAVAILABLE;
  return apiMessage || `Trello API error (${status})`;
}

export function readTrelloCredentials(credentials: IntegrationCredentials): TrelloCredentials {
  const apiKey = readCredentialString(credentials, 'apiKey');
  const apiToken = readCredentialString(credentials, 'apiToken');
  if (!apiKey || !apiToken) throw new Error('Trello API key and token cannot be empty.');
  return {
    apiKey,
    apiToken,
    boardIds: [...new Set(readCredentialStringArray(credentials, 'boardIds'))],
  };
}

export async function trelloRequest<T>(
  auth: TrelloAuth,
  path: string,
  params?: Record<string, string>
): Promise<T> {
  const url = new URL(`${TRELLO_API_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value);
  url.searchParams.set('key', auth.apiKey);
  url.searchParams.set('token', auth.apiToken);

  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(toTrelloApiErrorMessage(response.status, body?.trim().slice(0, 200)));
  }
  return (await response.json()) as T;
}

export function parseTrelloBoardUrls(boardUrls: string): string[] | null {
  const raw = boardUrls.trim();
  if (!raw) return [];

  const urls = raw
    .split(/[,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const shortLinks = new Set<string>();

  for (const url of urls) {
    const match = url.match(/trello\.com\/b\/([a-zA-Z0-9]+)/);
    if (!match) return null;
    shortLinks.add(match[1]);
  }

  return [...shortLinks];
}

export async function verifyTrelloCredentials(credentials: IntegrationCredentials) {
  const apiKey = readCredentialString(credentials, 'apiKey');
  const apiToken = readCredentialString(credentials, 'apiToken');
  if (!apiKey || !apiToken) throw new Error('Trello API key and token cannot be empty.');

  const existing = readTrelloCredentials(credentials);
  const boardUrlInput = readCredentialString(credentials, 'boardUrls');
  const boardShortLinks = boardUrlInput ? parseTrelloBoardUrls(boardUrlInput) : [];
  if (boardShortLinks === null) {
    throw new Error(
      'Could not parse board ID from one or more URLs. Expected format: https://trello.com/b/<id>'
    );
  }
  if (boardShortLinks.length > MAX_SELECTED_TRELLO_BOARDS) {
    throw new Error(
      `Trello board scope is limited to ${MAX_SELECTED_TRELLO_BOARDS} boards. Remove some board URLs and try again.`
    );
  }

  const auth: TrelloAuth = { apiKey, apiToken };
  const me = await trelloRequest<TrelloMember>(auth, '/members/me', {
    fields: 'fullName,username',
  });
  const boardIds = boardUrlInput ? await resolveBoardIds(auth, boardShortLinks) : existing.boardIds;
  return {
    displayName: me.fullName ?? me.username,
    displayDetail:
      me.fullName && me.username && me.fullName !== me.username ? `@${me.username}` : undefined,
    credentials: { apiKey, apiToken, boardIds },
  };
}

async function resolveBoardIds(auth: TrelloAuth, shortLinks: string[]): Promise<string[]> {
  const boards = await mapWithConcurrency(
    shortLinks,
    TRELLO_REQUEST_CONCURRENCY,
    async (shortLink) => {
      try {
        return await trelloRequest<{ id: string }>(auth, `/boards/${shortLink}`, { fields: 'id' });
      } catch {
        throw new Error(
          `Could not access Trello board "${shortLink}". Check the board URL and your permissions.`
        );
      }
    }
  );
  return [...new Set(boards.map((board) => board.id))];
}
