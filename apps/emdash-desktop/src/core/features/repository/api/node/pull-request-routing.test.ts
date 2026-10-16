import { err, ok } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectIntegrationAccountResolution } from '@core/features/integrations/api/node/project-integration-account-resolver';
import {
  pullRequestRepositoryUrls,
  resolvePullRequestAccount,
  resolvePullRequestIntegration,
} from './pull-request-routing';
import type { RepositoryRouteResult } from './repository-router';

function routed(integrationId: string, repositoryUrl: string): RepositoryRouteResult {
  const ref = new URL(repositoryUrl);
  const [owner, repo] = ref.pathname.slice(1).split('/');
  return ok({
    integrationId,
    repository: { host: ref.host, owner, repo, nameWithOwner: `${owner}/${repo}`, repositoryUrl },
  });
}

describe('pullRequestRepositoryUrls', () => {
  it('keeps remotes routed to an integration with pull requests, de-duplicated', async () => {
    const route = vi.fn(async (url: string | null | undefined) => {
      if (url?.includes('github.com')) return routed('github', 'https://github.com/acme/app');
      if (url?.includes('gitlab.com')) return routed('gitlab', 'https://gitlab.com/acme/app');
      return err({ type: 'no_integration_for_host' as const, host: 'git.example.com' });
    });
    await expect(
      pullRequestRepositoryUrls(
        route,
        [
          'git@github.com:acme/app.git',
          'https://github.com/acme/app',
          'https://gitlab.com/acme/app',
          'https://git.example.com/acme/app',
        ],
        (integrationId) => integrationId === 'github'
      )
    ).resolves.toEqual(['https://github.com/acme/app']);
  });
});

describe('resolvePullRequestIntegration', () => {
  it('returns the routed integration', async () => {
    await expect(
      resolvePullRequestIntegration(
        async () => routed('github', 'https://github.com/acme/app'),
        'https://github.com/acme/app'
      )
    ).resolves.toEqual(ok({ integrationId: 'github' }));
  });

  it.each(['host_unreachable', 'host_error'] as const)(
    'reports %s as an unreachable host, not an unsupported one',
    async (type) => {
      await expect(
        resolvePullRequestIntegration(
          async () => err({ type, host: 'ghe.example.com', reason: 'ETIMEDOUT' }),
          'https://ghe.example.com/acme/app'
        )
      ).resolves.toEqual(
        err({ type: 'host_unreachable', host: 'ghe.example.com', reason: 'ETIMEDOUT' })
      );
    }
  );

  it('reports an unclaimed host as unsupported', async () => {
    await expect(
      resolvePullRequestIntegration(
        async () => err({ type: 'no_integration_for_host', host: 'git.example.com' }),
        'https://git.example.com/acme/app'
      )
    ).resolves.toMatchObject(err({ type: 'unsupported_provider', host: 'git.example.com' }));
  });
});

describe('resolvePullRequestAccount', () => {
  function resolution(
    value: { accountId: string } | null,
    provenance: string
  ): ProjectIntegrationAccountResolution {
    return {
      value,
      provenance: { kind: provenance },
    } as unknown as ProjectIntegrationAccountResolution;
  }

  it('resolves the project account for the given integration from the base remote', async () => {
    const resolveAccount = vi.fn(async () => resolution({ accountId: 'gh-1' }, 'inferred'));
    await expect(
      resolvePullRequestAccount(resolveAccount, 'project-1', 'github', 'GitHub')
    ).resolves.toEqual(ok({ accountId: 'gh-1' }));
    expect(resolveAccount).toHaveBeenCalledWith('project-1', 'github', { kind: 'project' });
  });

  it.each([
    ['set', 'disabled', 'GitHub is disabled for this project.'],
    [
      'unresolvable',
      'account_selection_failed',
      'The selected GitHub account is no longer connected.',
    ],
    [
      'broken-setting',
      'account_selection_failed',
      'The selected GitHub account is no longer connected.',
    ],
    ['inferred', 'unconfigured', 'No GitHub account is configured for this project.'],
  ])('maps %s provenance without an account to %s', async (provenance, type, message) => {
    await expect(
      resolvePullRequestAccount(
        async () => resolution(null, provenance),
        'project-1',
        'github',
        'GitHub'
      )
    ).resolves.toEqual(err({ type, message }));
  });
});
