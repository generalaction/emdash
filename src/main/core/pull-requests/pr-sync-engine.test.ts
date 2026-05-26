import type { Octokit } from '@octokit/rest';
import { describe, expect, it, vi } from 'vitest';
import type { GitHubApiAuthError } from '@main/core/github/services/github-api-auth-errors';
import { err, ok } from '@shared/result';
import type { Result } from '@shared/result';
import { PrSyncEngine } from './pr-sync-engine';
import { toPrApiError } from './pr-sync-errors';

vi.mock('@main/core/github/services/octokit-provider', () => ({
  getOctokit: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: {},
}));

vi.mock('@main/db/kv', () => ({
  KV: class {
    get = vi.fn();
    set = vi.fn();
    del = vi.fn();
  },
}));

vi.mock('@main/lib/events', () => ({
  events: {
    emit: vi.fn(),
  },
}));

vi.mock('@main/lib/rate-limiter', () => ({
  githubRateLimiter: {
    acquire: vi.fn().mockResolvedValue(undefined),
  },
}));

function makeOctokit(overrides: {
  createPullRequest?: ReturnType<typeof vi.fn>;
  mergePullRequest?: ReturnType<typeof vi.fn>;
}): Octokit {
  return {
    rest: {
      pulls: {
        create: overrides.createPullRequest ?? vi.fn(),
        merge: overrides.mergePullRequest ?? vi.fn(),
      },
    },
  } as unknown as Octokit;
}

describe('PrSyncEngine', () => {
  it('creates pull requests with a host-aware Octokit client', async () => {
    const createPullRequest = vi.fn().mockResolvedValue({
      data: { html_url: 'https://ghe.example.com/acme/repo/pull/12', number: 12 },
    });
    const getOctokit = vi.fn().mockResolvedValue(ok(makeOctokit({ createPullRequest })));
    const engine = new PrSyncEngine(getOctokit);

    const result = await engine.createPullRequest({
      repositoryUrl: 'https://ghe.example.com/acme/repo',
      head: 'feature',
      base: 'main',
      title: 'Test',
      draft: false,
    });

    expect(getOctokit).toHaveBeenCalledWith('ghe.example.com');
    expect(createPullRequest).toHaveBeenCalledWith({
      owner: 'acme',
      repo: 'repo',
      head: 'feature',
      base: 'main',
      title: 'Test',
      body: undefined,
      draft: false,
    });
    expect(result).toEqual(ok({ url: 'https://ghe.example.com/acme/repo/pull/12', number: 12 }));
  });

  it('maps post-token PR API auth failures to typed auth errors', async () => {
    const createPullRequest = vi.fn().mockRejectedValue({ status: 403 });
    const getOctokit = vi.fn().mockResolvedValue(ok(makeOctokit({ createPullRequest })));
    const engine = new PrSyncEngine(getOctokit);

    await expect(
      engine.createPullRequest({
        repositoryUrl: 'https://ghe.example.com/acme/repo',
        head: 'feature',
        base: 'main',
        title: 'Test',
        draft: false,
      })
    ).resolves.toEqual(
      err({
        type: 'auth_required',
        host: 'ghe.example.com',
        message:
          'GitHub Enterprise authentication required for ghe.example.com. Run: gh auth login --hostname ghe.example.com',
        hint: 'Run: gh auth login --hostname ghe.example.com',
      })
    );
  });

  it('maps GitHub network timeouts to host reachability errors', () => {
    const error = Object.assign(
      new Error('Connect Timeout Error (attempted address: api.github.com:443, timeout: 10000ms)'),
      { status: 500 }
    );

    expect(toPrApiError(error, 'Unable to sync pull requests', 'github.com')).toEqual({
      type: 'host_unreachable',
      host: 'github.com',
      reason: 'Connect Timeout Error (attempted address: api.github.com:443, timeout: 10000ms)',
    });
  });

  it('preserves typed auth errors for duplicate in-flight single PR sync calls', async () => {
    let resolveOctokit!: (value: Result<Octokit, GitHubApiAuthError>) => void;
    const getOctokit = vi.fn<(host: string) => Promise<Result<Octokit, GitHubApiAuthError>>>(
      () =>
        new Promise((resolve) => {
          resolveOctokit = resolve;
        })
    );
    const engine = new PrSyncEngine(getOctokit);

    const first = engine.syncSingle('https://ghe.example.com/acme/repo', 12);
    const second = engine.syncSingle('https://ghe.example.com/acme/repo', 12);

    resolveOctokit(
      err({
        type: 'auth_required',
        host: 'ghe.example.com',
        message: 'auth required',
        hint: 'Run: gh auth login --hostname ghe.example.com',
      })
    );

    const expected = err({
      type: 'auth_required',
      host: 'ghe.example.com',
      message: 'auth required',
      hint: 'Run: gh auth login --hostname ghe.example.com',
    });
    await expect(first).resolves.toEqual(expected);
    await expect(second).resolves.toEqual(expected);
    expect(getOctokit).toHaveBeenCalledTimes(1);
  });
});
