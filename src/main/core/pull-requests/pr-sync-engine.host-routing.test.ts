import type { Octokit } from '@octokit/rest';
import { describe, expect, it, vi } from 'vitest';

// Stub electron-dependent transitive imports so we can exercise the engine in isolation.
vi.mock('@main/core/github/services/octokit-provider', () => ({
  getOctokit: vi.fn(),
}));
vi.mock('@main/db/client', () => ({ db: {} }));
vi.mock('@main/db/kv', () => ({
  KV: class {
    constructor(_namespace: string) {}
    async get() {
      return null;
    }
    async set() {}
    async del() {}
  },
}));
vi.mock('@main/lib/events', () => ({ events: { emit: vi.fn(), on: vi.fn(() => () => {}) } }));
vi.mock('@main/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { PrSyncEngine } from './pr-sync-engine';

/**
 * Regression test for issue #2181 — GitHub Enterprise PR creation. The engine must route
 * Octokit lookups by the repo's host so that Enterprise URLs hit the right API base.
 */
describe('PrSyncEngine host routing', () => {
  function makeMockOctokit(pullsCreate = vi.fn()): Octokit {
    return {
      rest: {
        pulls: {
          create: pullsCreate.mockResolvedValue({
            data: { html_url: 'https://ghe.example.com/org/repo/pull/42', number: 42 },
          }),
        },
      },
    } as unknown as Octokit;
  }

  it('passes the host parsed from the repositoryUrl through to getOctokit', async () => {
    const mockOctokit = makeMockOctokit();
    const getOctokit = vi.fn(async () => mockOctokit);
    const engine = new PrSyncEngine(getOctokit);

    await engine.createPullRequest({
      repositoryUrl: 'https://ghe.example.com/org/repo',
      head: 'feature',
      base: 'main',
      title: 'Test PR',
      draft: true,
    });

    expect(getOctokit).toHaveBeenCalledWith('ghe.example.com');
  });

  it('still routes github.com URLs to the public host', async () => {
    const mockOctokit = makeMockOctokit();
    const getOctokit = vi.fn(async () => mockOctokit);
    const engine = new PrSyncEngine(getOctokit);

    await engine.createPullRequest({
      repositoryUrl: 'https://github.com/owner/repo',
      head: 'feature',
      base: 'main',
      title: 'Test PR',
      draft: false,
    });

    expect(getOctokit).toHaveBeenCalledWith('github.com');
  });

  it('calls the API with the parsed owner and repo, not the full URL', async () => {
    const pullsCreate = vi.fn();
    const mockOctokit = makeMockOctokit(pullsCreate);
    const engine = new PrSyncEngine(vi.fn(async () => mockOctokit));

    await engine.createPullRequest({
      repositoryUrl: 'git@ghe.example.com:org/repo.git',
      head: 'feature',
      base: 'main',
      title: 'Test PR',
      body: 'Body text',
      draft: true,
    });

    expect(pullsCreate).toHaveBeenCalledWith({
      owner: 'org',
      repo: 'repo',
      head: 'feature',
      base: 'main',
      title: 'Test PR',
      body: 'Body text',
      draft: true,
    });
  });
});
