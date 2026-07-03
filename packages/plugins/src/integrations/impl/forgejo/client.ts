import { userGetCurrent } from '@llamaduck/forgejo-ts';
import { createClient, type Client } from '@llamaduck/forgejo-ts/client';
import { readCredentialString } from '../../helpers/credentials';
import { resolveRepositoryRemote } from '../../helpers/git-remote';
import {
  assertRemoteHostMatchesInstance,
  hasKnownNetworkErrorCode,
  normalizeHostedInstanceUrl,
} from '../../helpers/hosted-instance';
import type { IntegrationCredentials } from '../../host';

let client: Client | null = null;
let clientKey: string | null = null;

export type ForgejoCredentials = {
  instanceUrl: string;
  apiToken: string;
};

export function readForgejoCredentials(credentials: IntegrationCredentials): ForgejoCredentials {
  const instanceUrl = normalizeHostedInstanceUrl(
    readCredentialString(credentials, 'instanceUrl') ?? ''
  );
  if (!instanceUrl) throw new Error('A valid Forgejo instance URL is required.');

  const apiToken = readCredentialString(credentials, 'apiToken');
  if (!apiToken) throw new Error('A Forgejo API token is required.');

  return { instanceUrl, apiToken };
}

function responseStatus(error: unknown): number | undefined {
  return (error as { response?: { status?: unknown } })?.response?.status as number | undefined;
}

export function toForgejoErrorMessage(error: unknown, fallback: string): string {
  const status = responseStatus(error);
  if (typeof status === 'number') {
    if (status === 401 || status === 403) {
      return 'Forgejo authentication failed. Check your token permissions.';
    }
    if (status === 404) return 'Forgejo repository or resource not found.';
    if (status === 429) return 'Forgejo API rate limit exceeded. Please try again shortly.';
    if (status >= 500) return 'Forgejo API is temporarily unavailable. Please try again.';
  }

  if (hasKnownNetworkErrorCode(error)) {
    return 'Unable to reach Forgejo instance. Check your URL and network connection.';
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function getForgejoClientForCredentials(instanceUrl: string, token: string): Client {
  const key = `${instanceUrl}|${token}`;
  if (!client || clientKey !== key) {
    client = createClient({
      baseURL: `${instanceUrl}/api/v1`,
      headers: { Authorization: `token ${token}` },
    });
    clientKey = key;
  }
  return client;
}

export function getForgejoAuth(credentials: IntegrationCredentials): {
  instanceUrl: string;
  client: Client;
} {
  const parsed = readForgejoCredentials(credentials);
  return {
    instanceUrl: parsed.instanceUrl,
    client: getForgejoClientForCredentials(parsed.instanceUrl, parsed.apiToken),
  };
}

export async function verifyForgejoCredentials(credentials: IntegrationCredentials) {
  const parsed = readForgejoCredentials(credentials);
  const client = getForgejoClientForCredentials(parsed.instanceUrl, parsed.apiToken);
  const { data: user } = await userGetCurrent({ client, throwOnError: true });

  const username = user?.login ?? undefined;
  const displayName = user?.full_name || username;
  return {
    displayName,
    displayDetail: formatDisplayDetail(username, displayName, parsed.instanceUrl),
    credentials: parsed,
  };
}

export async function resolveForgejoRepo(
  credentials: IntegrationCredentials,
  repositoryUrl: string | undefined
): Promise<{ client: Client; owner: string; repo: string; repoName: string }> {
  const { instanceUrl, client } = getForgejoAuth(credentials);
  const remote = resolveRepositoryRemote(repositoryUrl);

  assertRemoteHostMatchesInstance(remote.host, instanceUrl, 'Forgejo');

  const parts = remote.slug.split('/');
  if (parts.length < 2) throw new Error('Unable to extract owner/repo from remote URL.');

  const owner = parts[0];
  const repo = parts.slice(1).join('/');
  return { client, owner, repo, repoName: repo };
}

function hostFromInstanceUrl(instanceUrl: string): string {
  try {
    return new URL(instanceUrl).host;
  } catch {
    return instanceUrl;
  }
}

function formatDisplayDetail(
  username: string | undefined,
  displayName: string | undefined,
  instanceUrl: string
): string {
  const host = hostFromInstanceUrl(instanceUrl);
  return username && displayName && username !== displayName ? `@${username} · ${host}` : host;
}
