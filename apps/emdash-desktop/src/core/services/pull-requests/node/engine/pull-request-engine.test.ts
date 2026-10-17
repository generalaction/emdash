import { GitHubPullRequestClient } from '@emdash/plugins/pull-requests/github';
import type {
  PullRequestClient,
  PullRequestHostContext,
} from '@emdash/plugins/pull-requests/types';
import { err, ok } from '@emdash/shared';
import { createScope, type Scope } from '@emdash/shared/concurrency';
import { createStubLogger } from '@emdash/shared/testing';
import type { ContractClient } from '@emdash/wire/rpc';
import type { Octokit } from '@octokit/rest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GitPlatformAuthContract } from '../../api';
import { PullRequestEngine, type PullRequestEngineOptions } from './pull-request-engine';

const scopes: Scope[] = [];
const repositoryUrl = 'https://github.com/emdash/emdash';

afterEach(async () => {
  await Promise.all(scopes.splice(0).map(async (scope) => await scope.dispose()));
});

function createEngine({
  githubAuth,
  logger,
  createOctokit,
}: Pick<PullRequestEngineOptions, 'logger'> & {
  githubAuth: PullRequestEngineOptions['auth'];
  createOctokit: (options: { token: string; baseUrl: string }) => Octokit;
}): PullRequestEngine {
  const scope = createScope({ label: 'pull-request-engine-test' });
  scopes.push(scope);
  return new PullRequestEngine({
    auth: githubAuth,
    logger,
    scope,
    createClient: (_integrationId, host) => new GitHubPullRequestClient(host, { createOctokit }),
  });
}

function fakeGitHubAuth(): ContractClient<GitPlatformAuthContract> {
  return {
    resolveIntegration: async () => ok({ integrationId: 'github' }),
    resolveAuth: async () =>
      ok({
        integrationId: 'github',
        credentials: { accessToken: 'test-token', apiBaseUrl: 'https://api.github.com' },
      }),
  };
}

function fakeOctokit(graphql: (...args: never[]) => Promise<unknown>) {
  return { graphql, rest: {}, paginate: vi.fn() };
}

// Assertions on GitHub-specific Octokit shapes live in
// @emdash/plugins pull-requests/impl/github/client.test.ts. These smoke tests only confirm the
// engine forwards each public method to its underlying provider unchanged.
describe('PullRequestEngine (delegates to the pull-requests plugin client)', () => {
  it('forwards openRepository and its fetch* methods through to the provider', async () => {
    const graphql = vi.fn(async () => ({
      repository: {
        pullRequests: {
          totalCount: 0,
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [],
        },
      },
    }));
    const { logger } = createStubLogger();
    const engine = createEngine({
      githubAuth: fakeGitHubAuth(),
      logger,
      createOctokit: () => fakeOctokit(graphql) as never,
    });
    const result = await engine.openRepository(repositoryUrl, new AbortController().signal);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(await result.data.fetchOpenPage(null, new AbortController().signal)).toMatchObject({
      success: true,
      data: { data: { prs: [] } },
    });
    expect(graphql).toHaveBeenCalledTimes(1);
  });

  it('forwards createPullRequest to the provider', async () => {
    const { logger } = createStubLogger();
    const engine = createEngine({
      githubAuth: fakeGitHubAuth(),
      logger,
      createOctokit: () =>
        ({
          graphql: vi.fn(),
          paginate: vi.fn(),
          rest: {
            pulls: {
              create: vi.fn(async () => ({
                data: { html_url: `${repositoryUrl}/pull/1`, number: 1 },
              })),
            },
          },
        }) as never,
    });
    const result = await engine.createPullRequest(
      { repositoryUrl, head: 'feature', base: 'main', title: 'Title', draft: false },
      new AbortController().signal
    );
    expect(result).toMatchObject({
      success: true,
      data: { url: `${repositoryUrl}/pull/1`, number: 1 },
    });
  });

  it('forwards mergePullRequest to the provider', async () => {
    const { logger } = createStubLogger();
    const engine = createEngine({
      githubAuth: fakeGitHubAuth(),
      logger,
      createOctokit: () =>
        ({
          graphql: vi.fn(),
          paginate: vi.fn(),
          rest: { pulls: { merge: vi.fn(async () => ({ data: { sha: 'abc', merged: true } })) } },
        }) as never,
    });
    const result = await engine.mergePullRequest(
      repositoryUrl,
      1,
      { strategy: 'merge' },
      new AbortController().signal
    );
    expect(result).toMatchObject({ success: true, data: { sha: 'abc', merged: true } });
  });

  it('forwards markReadyForReview to the provider', async () => {
    const { logger } = createStubLogger();
    const engine = createEngine({
      githubAuth: fakeGitHubAuth(),
      logger,
      createOctokit: () =>
        ({
          graphql: vi.fn(async () => ({
            markPullRequestReadyForReview: { pullRequest: { isDraft: false } },
          })),
          paginate: vi.fn(),
          rest: { pulls: { get: vi.fn(async () => ({ data: { node_id: 'node-1' } })) } },
        }) as never,
    });
    const result = await engine.markReadyForReview(repositoryUrl, 1, new AbortController().signal);
    expect(result).toMatchObject({ success: true });
  });

  it('forwards getPullRequestFiles to the provider', async () => {
    const { logger } = createStubLogger();
    const engine = createEngine({
      githubAuth: fakeGitHubAuth(),
      logger,
      createOctokit: () =>
        ({
          graphql: vi.fn(),
          paginate: vi.fn(async () => [
            { filename: 'a.ts', status: 'modified', additions: 1, deletions: 0, patch: '@@' },
          ]),
          rest: { pulls: { listFiles: vi.fn() } },
        }) as never,
    });
    const result = await engine.getPullRequestFiles(repositoryUrl, 1, new AbortController().signal);
    expect(result).toMatchObject({
      success: true,
      data: [{ filename: 'a.ts', status: 'modified' }],
    });
  });
});

describe('PullRequestEngine (client dispatch)', () => {
  function fakeClient(): PullRequestClient {
    return {
      openRepository: vi.fn(async () => err({ type: 'sync_failed' as const, message: 'unused' })),
      createPullRequest: vi.fn(),
      mergePullRequest: vi.fn(),
      markReadyForReview: vi.fn(async () => ok(undefined)),
      getPullRequestFiles: vi.fn(async () => ok([])),
    };
  }

  function createDispatchEngine(
    options: Partial<Omit<PullRequestEngineOptions, 'scope' | 'logger'>>
  ): PullRequestEngine {
    const scope = createScope({ label: 'pull-request-engine-dispatch-test' });
    scopes.push(scope);
    return new PullRequestEngine({
      auth: fakeGitHubAuth(),
      logger: createStubLogger().logger,
      scope,
      ...options,
    });
  }

  it('creates one client per integration and reuses it across repositories', async () => {
    const client = fakeClient();
    const createClient = vi.fn(() => client);
    const engine = createDispatchEngine({ createClient });
    const signal = new AbortController().signal;

    await engine.getPullRequestFiles(repositoryUrl, 1, signal);
    await engine.markReadyForReview('https://github.com/emdash/other', 2, signal);

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith('github', expect.anything());
    expect(client.getPullRequestFiles).toHaveBeenCalledWith(repositoryUrl, 1, signal);
    expect(client.markReadyForReview).toHaveBeenCalledWith(
      'https://github.com/emdash/other',
      2,
      signal
    );
  });

  it('dispatches each repository to the client of the integration it routes to', async () => {
    const clients = { github: fakeClient(), gitlab: fakeClient() };
    const createClient = vi.fn((integrationId: string) =>
      integrationId === 'github' || integrationId === 'gitlab' ? clients[integrationId] : null
    );
    const engine = createDispatchEngine({
      auth: {
        ...fakeGitHubAuth(),
        resolveIntegration: async ({ repositoryUrl: url }) =>
          ok({ integrationId: url.includes('gitlab.com') ? 'gitlab' : 'github' }),
      },
      createClient,
    });
    const signal = new AbortController().signal;

    await engine.getPullRequestFiles(repositoryUrl, 1, signal);
    await engine.getPullRequestFiles('https://gitlab.com/group/sub/project', 2, signal);

    expect(createClient).toHaveBeenCalledTimes(2);
    expect(clients.github.getPullRequestFiles).toHaveBeenCalledWith(repositoryUrl, 1, signal);
    expect(clients.gitlab.getPullRequestFiles).toHaveBeenCalledWith(
      'https://gitlab.com/group/sub/project',
      2,
      signal
    );
  });

  it('fails without creating a client when the repository routes to no integration', async () => {
    const createClient = vi.fn(() => fakeClient());
    const engine = createDispatchEngine({
      auth: {
        ...fakeGitHubAuth(),
        resolveIntegration: async () =>
          err({
            type: 'unsupported_provider' as const,
            host: 'git.example.com',
            reason: 'No connected integration handles git.example.com.',
          }),
      },
      createClient,
    });

    expect(
      await engine.getPullRequestFiles(
        'https://git.example.com/acme/repo',
        1,
        new AbortController().signal
      )
    ).toEqual(
      err({
        type: 'unsupported_provider',
        host: 'git.example.com',
        reason: 'No connected integration handles git.example.com.',
      })
    );
    expect(createClient).not.toHaveBeenCalled();
  });

  it('fails without a request when the integration has no pull-requests plugin', async () => {
    const engine = createDispatchEngine({ createClient: () => null });

    expect(
      await engine.getPullRequestFiles(repositoryUrl, 1, new AbortController().signal)
    ).toEqual({
      success: false,
      error: {
        type: 'unsupported_provider',
        host: 'github.com',
        reason: 'github has no pull-request support.',
      },
    });
  });

  it('refuses credentials resolved for a different integration', async () => {
    let host: PullRequestHostContext | undefined;
    const engine = createDispatchEngine({
      auth: {
        resolveIntegration: async () => ok({ integrationId: 'github' }),
        resolveAuth: async () =>
          ok({ integrationId: 'gitlab', accountId: 'account-1', credentials: { token: 't' } }),
      },
      createClient: (_integrationId, context) => {
        host = context;
        return fakeClient();
      },
    });
    await engine.getPullRequestFiles(repositoryUrl, 1, new AbortController().signal);

    expect(await host?.resolveCredentials(repositoryUrl, new AbortController().signal)).toEqual({
      success: false,
      error: {
        type: 'account_unresolvable',
        host: 'github.com',
        message: 'Repository is connected through gitlab, not github.',
      },
    });
  });

  it('passes the resolved account and credential record to the client', async () => {
    let host: PullRequestHostContext | undefined;
    const resolveAuth = vi.fn(async (_input: { repositoryUrl: string; integrationId: string }) =>
      ok({
        integrationId: 'github',
        accountId: 'account-1',
        credentials: { accessToken: 'token', apiBaseUrl: 'https://api.github.com' },
      })
    );
    const engine = createDispatchEngine({
      auth: {
        resolveIntegration: async () => ok({ integrationId: 'github' }),
        resolveAuth: async (input) => await resolveAuth(input),
      },
      createClient: (_integrationId, context) => {
        host = context;
        return fakeClient();
      },
    });
    await engine.getPullRequestFiles(repositoryUrl, 1, new AbortController().signal);

    expect(await host?.resolveCredentials(repositoryUrl, new AbortController().signal)).toEqual({
      success: true,
      data: {
        accountId: 'account-1',
        credentials: { accessToken: 'token', apiBaseUrl: 'https://api.github.com' },
      },
    });
    expect(resolveAuth).toHaveBeenCalledWith({ repositoryUrl, integrationId: 'github' });
  });
});
