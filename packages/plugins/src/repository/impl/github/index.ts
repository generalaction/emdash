import { err, ok, type Result } from '@emdash/shared';
import { Octokit } from '@octokit/rest';
import type {
  ConnectedIntegrationHostContext,
  IntegrationHostContext,
} from '../../../integrations/host';
import {
  createGitHubClient,
  readGitHubCredentials,
} from '../../../integrations/impl/github/client';
import { toGitHubIntegrationError } from '../../../integrations/impl/github/error';
import type { GitHubClient } from '../../../integrations/impl/github/types';
import { defineRepositoryPlugin, registerRepositoryPluginBehavior } from '../../plugin';
import type {
  CreatedRepository,
  CreateRepositoryOpts,
  DeleteRepositoryOpts,
  RepositoryError,
  RepositoryHostProbeResult,
  RepositoryOwner,
} from '../../types';

const PROBE_TIMEOUT_MS = 5_000;

function clientFor(host: ConnectedIntegrationHostContext): Result<GitHubClient, RepositoryError> {
  const credentials = readGitHubCredentials(host.credentials);
  if (!credentials.success) return err(credentials.error);
  return ok(createGitHubClient(credentials.data));
}

export async function listOwners(
  host: ConnectedIntegrationHostContext
): Promise<Result<RepositoryOwner[], RepositoryError>> {
  const client = clientFor(host);
  if (!client.success) return client;
  try {
    const { data: user } = await client.data.rest.users.getAuthenticated();
    const owners: RepositoryOwner[] = [
      { login: user.login, type: 'User', avatarUrl: user.avatar_url },
    ];
    try {
      const { data: orgs } = await client.data.rest.orgs.listForAuthenticatedUser();
      for (const org of orgs) {
        owners.push({ login: org.login, type: 'Organization', avatarUrl: org.avatar_url });
      }
    } catch (error) {
      // Org listing needs read:org; the user's own namespace is still usable without it.
      host.log.warn('GitHub listOwners: organization listing failed', { error });
    }
    return ok(owners);
  } catch (error) {
    host.log.warn('GitHub listOwners failed', { error });
    return err(failure(error, 'Unable to list GitHub repository owners.'));
  }
}

export async function createRepository(
  host: ConnectedIntegrationHostContext,
  opts: CreateRepositoryOpts
): Promise<Result<CreatedRepository, RepositoryError>> {
  const client = clientFor(host);
  if (!client.success) return client;
  try {
    const octokit = client.data;
    const { data: user } = await octokit.rest.users.getAuthenticated();
    const params = {
      name: opts.name,
      description: opts.description,
      private: opts.visibility === 'private',
      auto_init: true,
    };
    const { data } =
      opts.owner === user.login
        ? await octokit.rest.repos.createForAuthenticatedUser(params)
        : await octokit.rest.repos.createInOrg({ ...params, org: opts.owner });
    return ok({
      repositoryUrl: data.html_url,
      cloneUrl: data.clone_url,
      nameWithOwner: data.full_name,
      defaultBranch: data.default_branch,
    });
  } catch (error) {
    host.log.warn('GitHub createRepository failed', { error });
    return err(failure(error, 'Unable to create the GitHub repository.'));
  }
}

export async function deleteRepository(
  host: ConnectedIntegrationHostContext,
  opts: DeleteRepositoryOpts
): Promise<Result<void, RepositoryError>> {
  const client = clientFor(host);
  if (!client.success) return client;
  try {
    await client.data.rest.repos.delete({ owner: opts.owner, repo: opts.name });
    return ok();
  } catch (error) {
    host.log.warn('GitHub deleteRepository failed', { error });
    return err(failure(error, 'Unable to delete the GitHub repository.'));
  }
}

/**
 * Requests `https://<hostname>/api/v3/meta`. GitHub sets `x-github-request-id`
 * (and Enterprise Server `x-github-enterprise-version`) on every API response,
 * errors included, so a response carrying either header is GitHub at any status.
 * Without them: a JSON body, 401, or 403 is still GitHub (private-mode
 * instances reject anonymous requests); 404, 410, or a non-JSON body is
 * `unsupported_host`; any other status and TLS failures are `host_error`;
 * other request failures are `host_unreachable`.
 */
export async function probeHost(
  host: IntegrationHostContext,
  hostname: string,
  createOctokit: (baseUrl: string) => Octokit = (baseUrl) => new Octokit({ baseUrl })
): Promise<RepositoryHostProbeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await createOctokit(`https://${hostname}/api/v3`).rest.meta.get({
      request: { signal: controller.signal },
    });
    const data = response.data as unknown;
    if (hasGitHubHeaders(response.headers) || (data && typeof data === 'object')) return ok();
    return err({
      type: 'unsupported_host',
      host: hostname,
      message: 'GitHub meta endpoint returned a non-JSON response.',
    });
  } catch (error) {
    const status = statusOf(error);
    if (status !== undefined) {
      if (hasGitHubHeaders(responseHeadersOf(error))) return ok();
      if (status === 401 || status === 403) return ok();
      return err({
        type: status === 404 || status === 410 ? 'unsupported_host' : 'host_error',
        host: hostname,
        message: `GitHub meta endpoint returned ${status}.`,
      });
    }
    const message = error instanceof Error ? error.message : String(error);
    host.log.debug('GitHub probeHost failed', { hostname, error: message });
    return err({
      type: isTlsError(message) ? 'host_error' : 'host_unreachable',
      host: hostname,
      message,
    });
  } finally {
    clearTimeout(timeout);
  }
}

const GITHUB_RESPONSE_HEADERS = ['x-github-request-id', 'x-github-enterprise-version'];

function hasGitHubHeaders(headers: Record<string, unknown> | undefined): boolean {
  if (!headers) return false;
  const names = Object.keys(headers).map((name) => name.toLowerCase());
  return GITHUB_RESPONSE_HEADERS.some((name) => names.includes(name));
}

function responseHeadersOf(error: unknown): Record<string, unknown> | undefined {
  if (!error || typeof error !== 'object' || !('response' in error)) return undefined;
  const headers = (error as { response?: { headers?: unknown } }).response?.headers;
  return headers && typeof headers === 'object' ? (headers as Record<string, unknown>) : undefined;
}

/** Typed error carrying GitHub's own message (e.g. "name already exists on this account"). */
function failure(error: unknown, fallback: string): RepositoryError {
  const mapped = toGitHubIntegrationError(error, fallback);
  return error instanceof Error && error.message ? { ...mapped, message: error.message } : mapped;
}

function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object' || !('status' in error)) return undefined;
  const status = Number((error as { status: unknown }).status);
  return Number.isFinite(status) && status > 0 ? status : undefined;
}

function isTlsError(message: string): boolean {
  return /certificate|cert|tls|ssl|self[- ]signed/i.test(message);
}

const plugin = defineRepositoryPlugin(
  { integrationId: 'github' },
  { repository: { knownHosts: ['github.com'] } },
  {}
);

export const provider = registerRepositoryPluginBehavior(plugin, {
  repository: {
    listOwners,
    createRepository,
    deleteRepository,
    probeHost: (host, hostname) => probeHost(host, hostname),
  },
});
