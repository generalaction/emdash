import { err, ok, type Result } from '@agent/shared';
import { AccessLevel } from '@gitbeaker/rest';
import { toIntegrationError } from '../../../integrations/helpers/error';
import type { ConnectedIntegrationHostContext } from '../../../integrations/host';
import {
  createGitLabClient,
  readGitLabCredentials,
} from '../../../integrations/impl/gitlab/client';
import type { GitLabClient } from '../../../integrations/impl/gitlab/types';
import { defineRepositoryPlugin, registerRepositoryPluginBehavior } from '../../plugin';
import type {
  CreatedRepository,
  CreateRepositoryOpts,
  DeleteRepositoryOpts,
  RepositoryError,
  RepositoryOwner,
} from '../../types';

function clientFor(host: ConnectedIntegrationHostContext): Result<GitLabClient, RepositoryError> {
  const credentials = readGitLabCredentials(host.credentials);
  if (!credentials.success) return err(credentials.error);
  return ok(createGitLabClient(credentials.data));
}

function failure(error: unknown, fallback: string): RepositoryError {
  const mapped = toIntegrationError(error, 'GitLab', fallback);
  if (!(error instanceof Error) || !error.message) return mapped;
  return { ...mapped, message: readableGitLabMessage(error.message) };
}

function readableGitLabMessage(message: string): string {
  try {
    const details: unknown = JSON.parse(message);
    const parts: string[] = [];
    const collect = (value: unknown, field: string | null, depth: number): void => {
      if (depth > 3) return;
      if (typeof value === 'string') {
        const displayField = field?.replaceAll('_', ' ');
        const label =
          displayField && field !== 'message' && field !== 'error' && field !== 'base'
            ? `${displayField[0]?.toUpperCase()}${displayField.slice(1)}: `
            : '';
        parts.push(`${label}${value}`);
      } else if (Array.isArray(value)) {
        for (const item of value) collect(item, field, depth + 1);
      } else if (value && typeof value === 'object') {
        for (const [key, item] of Object.entries(value)) collect(item, key, depth + 1);
      }
    };
    collect(details, null, 0);
    return parts.length > 0 ? parts.join('; ') : message;
  } catch {
    return message;
  }
}

export async function listOwners(
  host: ConnectedIntegrationHostContext
): Promise<Result<RepositoryOwner[], RepositoryError>> {
  const client = clientFor(host);
  if (!client.success) return client;
  try {
    const user = await client.data.Users.showCurrentUser();
    const owners: RepositoryOwner[] = [
      { login: user.username, type: 'User', avatarUrl: user.avatar_url },
    ];
    const [developers, maintainers, groupOwners] = await Promise.all([
      client.data.Groups.all({ minAccessLevel: AccessLevel.DEVELOPER }),
      client.data.Groups.all({ minAccessLevel: AccessLevel.MAINTAINER }),
      client.data.Groups.all({ minAccessLevel: AccessLevel.OWNER }),
    ]);
    const maintainerIds = new Set(maintainers.map((group) => group.id));
    const ownerIds = new Set(groupOwners.map((group) => group.id));
    for (const group of developers) {
      const level = group.project_creation_level;
      if (
        (level === 'developer' ||
          (level === 'maintainer' && maintainerIds.has(group.id)) ||
          (level === 'owner' && ownerIds.has(group.id))) &&
        group.full_path
      ) {
        owners.push({
          login: group.full_path,
          type: 'Organization',
          avatarUrl: group.avatar_url ?? '',
        });
      }
    }
    return ok(owners);
  } catch (error) {
    host.log.warn('GitLab listOwners failed', { error });
    return err(failure(error, 'Unable to list GitLab repository owners.'));
  }
}

export async function createRepository(
  host: ConnectedIntegrationHostContext,
  opts: CreateRepositoryOpts
): Promise<Result<CreatedRepository, RepositoryError>> {
  const client = clientFor(host);
  if (!client.success) return client;
  try {
    const user = await client.data.Users.showCurrentUser();
    const namespaceId =
      opts.owner === user.username
        ? (user.namespace_id ?? (await client.data.Namespaces.show(user.username)).id)
        : (await client.data.Groups.show(opts.owner)).id;
    const project = await client.data.Projects.create({
      name: opts.name,
      description: opts.description,
      visibility: opts.visibility,
      namespaceId,
      initializeWithReadme: opts.initializeWithReadme ?? true,
    });
    return ok({
      repositoryUrl: project.web_url,
      cloneUrl: project.http_url_to_repo,
      nameWithOwner: project.path_with_namespace,
      defaultBranch: project.default_branch ?? 'main',
    });
  } catch (error) {
    host.log.warn('GitLab createRepository failed', { error });
    return err(failure(error, 'Unable to create the GitLab repository.'));
  }
}

export async function deleteRepository(
  host: ConnectedIntegrationHostContext,
  opts: DeleteRepositoryOpts
): Promise<Result<void, RepositoryError>> {
  const client = clientFor(host);
  if (!client.success) return client;
  try {
    await client.data.Projects.remove(`${opts.owner}/${opts.name}`);
    return ok();
  } catch (error) {
    host.log.warn('GitLab deleteRepository failed', { error });
    return err(failure(error, 'Unable to delete the GitLab repository.'));
  }
}

const plugin = defineRepositoryPlugin(
  { integrationId: 'gitlab' },
  { repository: { knownHosts: ['gitlab.com'] } },
  {}
);

export const provider = registerRepositoryPluginBehavior(plugin, {
  repository: { listOwners, createRepository, deleteRepository },
});
