import { ok } from '@emdash/shared';
import { createScope, type Scope } from '@emdash/shared/concurrency';
import { createStubLogger } from '@emdash/shared/testing';
import type { ContractClient } from '@emdash/wire/rpc';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GitPlatformAuthContract } from '../../api';
import { PullRequestEngine, type PullRequestEngineOptions } from './pull-request-engine';

const scopes: Scope[] = [];
const repositoryUrl = 'https://github.com/emdash/emdash';

afterEach(async () => {
  await Promise.all(scopes.splice(0).map(async (scope) => await scope.dispose()));
});

function createEngine(options: Omit<PullRequestEngineOptions, 'scope'>): PullRequestEngine {
  const scope = createScope({ label: 'pull-request-engine-test' });
  scopes.push(scope);
  return new PullRequestEngine({ ...options, scope });
}

function fakeGitHubAuth(): ContractClient<GitPlatformAuthContract> {
  return {
    resolveAuth: async () =>
      ok({
        provider: 'github',
        token: 'test-token',
        host: 'github.com',
        apiBaseUrl: 'https://api.github.com',
      }),
  };
}

function fakeOctokit(graphql: (...args: never[]) => Promise<unknown>) {
  return { graphql, rest: {}, paginate: vi.fn() };
}

// Assertions on GitHub-specific Octokit shapes live in
// providers/github/github-provider.test.ts. These smoke tests only confirm the
// engine forwards each public method to its underlying provider unchanged.
describe('PullRequestEngine (delegates to GitPlatformProvider)', () => {
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
