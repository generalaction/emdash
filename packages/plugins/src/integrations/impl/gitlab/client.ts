import { GitbeakerRequestError, Gitlab } from '@gitbeaker/rest';
import { readCredentialString } from '../../helpers/credentials';
import { resolveRepositoryRemote } from '../../helpers/git-remote';
import {
  assertRemoteHostMatchesInstance,
  hasKnownNetworkErrorCode,
  normalizeHostedInstanceUrl,
} from '../../helpers/hosted-instance';
import type { IntegrationCredentials } from '../../host';

let client: Gitlab | null = null;
let clientKey: string | null = null;

export type GitLabCredentials = {
  instanceUrl: string;
  apiToken: string;
};

export function readGitLabCredentials(credentials: IntegrationCredentials): GitLabCredentials {
  const instanceUrl = normalizeHostedInstanceUrl(
    readCredentialString(credentials, 'instanceUrl') ?? ''
  );
  if (!instanceUrl) throw new Error('A valid GitLab instance URL is required.');

  const apiToken = readCredentialString(credentials, 'apiToken');
  if (!apiToken) throw new Error('A GitLab API token is required.');

  return { instanceUrl, apiToken };
}

export function toGitLabErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof GitbeakerRequestError) {
    const status = error.cause?.response?.status;
    if (status === 401 || status === 403) {
      return 'GitLab authentication failed. Check your token permissions.';
    }
    if (status === 404) return 'GitLab project or resource not found.';
    if (status === 429) return 'GitLab API rate limit exceeded. Please try again shortly.';
    if (typeof status === 'number' && status >= 500) {
      return 'GitLab API is temporarily unavailable. Please try again.';
    }
    return error.message || fallback;
  }

  if (hasKnownNetworkErrorCode(error)) {
    return 'Unable to reach GitLab instance. Check your URL and network connection.';
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function getGitLabClientForCredentials(instanceUrl: string, token: string): Gitlab {
  const key = `${instanceUrl}|${token}`;
  if (!client || clientKey !== key) {
    client = new Gitlab({ host: instanceUrl, token });
    clientKey = key;
  }
  return client;
}

export function getGitLabAuth(credentials: IntegrationCredentials): {
  instanceUrl: string;
  client: Gitlab;
} {
  const parsed = readGitLabCredentials(credentials);
  return {
    instanceUrl: parsed.instanceUrl,
    client: getGitLabClientForCredentials(parsed.instanceUrl, parsed.apiToken),
  };
}

export async function verifyGitLabCredentials(credentials: IntegrationCredentials) {
  const parsed = readGitLabCredentials(credentials);
  const client = getGitLabClientForCredentials(parsed.instanceUrl, parsed.apiToken);
  const user = (await client.Users.showCurrentUser()) as Record<string, unknown>;
  const username = readString(user.username) ?? undefined;
  const displayName = readString(user.name) ?? username;

  return {
    displayName,
    displayDetail: formatDisplayDetail(username, displayName, parsed.instanceUrl),
    credentials: parsed,
  };
}

export async function resolveGitLabProject(
  credentials: IntegrationCredentials,
  repositoryUrl: string | undefined
): Promise<{ client: Gitlab; projectId: number; projectName: string | null }> {
  const { instanceUrl, client } = getGitLabAuth(credentials);

  try {
    const remote = resolveRepositoryRemote(repositoryUrl);
    assertRemoteHostMatchesInstance(remote.host, instanceUrl, 'GitLab');

    const project = (await client.Projects.show(remote.slug)) as Record<string, unknown>;
    const projectId = readNumber(project.id);
    if (projectId === null) throw new Error('Unable to resolve GitLab project ID.');

    return { client, projectId, projectName: readString(project.name) };
  } catch (error) {
    throw new Error(
      toGitLabErrorMessage(error, 'Unable to resolve GitLab project from the selected remote.')
    );
  }
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

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
