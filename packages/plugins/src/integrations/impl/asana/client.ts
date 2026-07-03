import { readCredentialString } from '../../helpers/credentials';
import type { IntegrationCredentials } from '../../host';

export const ASANA_API_URL = 'https://app.asana.com/api/1.0';

type AsanaErrorResponse = {
  errors?: Array<{ message?: string }>;
};

export type AsanaWorkspace = {
  gid: string;
  name: string;
};

type AsanaUserResponse = {
  data?: {
    gid?: string;
    name?: string;
    workspaces?: AsanaWorkspace[];
  };
};

export class AsanaHttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'AsanaHttpError';
  }
}

export class AsanaClient {
  constructor(private readonly token: string) {}

  async get<T>(path: string, query?: Record<string, string | number | boolean | undefined>) {
    const url = new URL(`${ASANA_API_URL}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (typeof value !== 'undefined') url.searchParams.set(key, String(value));
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      let message = response.statusText || 'Asana request failed.';
      try {
        const body = (await response.json()) as AsanaErrorResponse;
        message = body.errors?.[0]?.message || message;
      } catch {
        // Response body was not JSON; keep status text.
      }
      throw new AsanaHttpError(response.status, message);
    }

    return (await response.json()) as T;
  }
}

let client: AsanaClient | null = null;
let clientToken: string | null = null;

export function toAsanaErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof AsanaHttpError) {
    if (error.status === 401) return 'Asana authentication failed. Check your access token.';
    if (error.status === 403) {
      return 'Asana token was accepted but is missing required permissions.';
    }
    if (error.status === 429) return 'Asana API rate limit exceeded. Please try again shortly.';
    if (error.status >= 500) return 'Asana API is temporarily unavailable. Please try again.';
    return error.message || fallback;
  }

  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function asanaAccessToken(credentials: IntegrationCredentials): string {
  const token = readCredentialString(credentials, 'accessToken');
  if (!token) throw new Error('Asana access token cannot be empty.');
  return token;
}

export function getAsanaClient(credentials: IntegrationCredentials): AsanaClient {
  const token = asanaAccessToken(credentials);
  if (!client || clientToken !== token) {
    client = new AsanaClient(token);
    clientToken = token;
  }
  return client;
}

export async function fetchAsanaUser(client: AsanaClient): Promise<{
  gid?: string;
  name?: string;
  workspaces?: AsanaWorkspace[];
}> {
  const response = await client.get<AsanaUserResponse>('/users/me', {
    opt_fields: 'name,workspaces.gid,workspaces.name',
  });
  return response.data ?? {};
}

export async function verifyAsanaCredentials(credentials: IntegrationCredentials) {
  const token = asanaAccessToken(credentials);
  const client = getAsanaClient({ accessToken: token });
  const user = await fetchAsanaUser(client);
  const workspace = user.workspaces?.[0];
  const displayName = workspace?.name ?? user.name;
  const displayDetail =
    workspace?.name && user.name && workspace.name !== user.name ? user.name : undefined;

  return {
    displayName,
    displayDetail,
    credentials: {
      accessToken: token,
      ...(workspace?.gid ? { workspaceGid: workspace.gid } : {}),
    },
  };
}
