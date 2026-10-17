import type { GitBranch } from '@emdash/core/runtimes/git/api';
import { ok } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectProvider } from '@core/features/projects/api/node/project-provider';
import { isValidBranchName, resolveFromBranch } from './resolve-from-branch';

const effective = vi.hoisted(() => ({
  baseRemote: { value: 'origin' } as { value: string | null },
  defaultBranch: { value: { branch: 'main', remote: 'origin' } } as {
    value: { branch: string; remote: string | null } | null;
  },
}));

vi.mock('@core/features/projects/api/node/settings/effective-settings', () => ({
  resolveProjectEffectiveSettings: async () => effective,
}));

const origin = { name: 'origin', url: 'https://example.com/repo.git' };

function localBranch(name: string): GitBranch {
  return { type: 'local', ref: `refs/heads/${name}`, oid: 'a' } as GitBranch;
}

function remoteBranch(name: string): GitBranch {
  return {
    type: 'remote',
    ref: `refs/remotes/origin/${name}`,
    remote: origin,
    oid: 'b',
  } as GitBranch;
}

function project(branches: GitBranch[]): ProjectProvider {
  return {
    projectId: 'project-1',
    repository: { path: '/repo' },
    settings: {},
    repoFacts: {},
    git: {
      repository: {
        model: {
          state: () => ({
            snapshot: async () => ({ data: { branches, tags: [], remoteHeads: [] } }),
          }),
        },
      },
    },
  } as unknown as ProjectProvider;
}

describe('isValidBranchName', () => {
  it('accepts ordinary branch names', () => {
    for (const name of ['main', 'feature/add-mcp', 'user/fix-1.2']) {
      expect(isValidBranchName(name)).toBe(true);
    }
  });

  it('rejects names git would refuse', () => {
    for (const name of [
      '',
      '@',
      'has space',
      'has~tilde',
      'has^caret',
      'has:colon',
      'has?question',
      'has*star',
      'has[bracket',
      '-leading-dash',
      '/leading-slash',
      'trailing-slash/',
      'double..dot',
      'ref@{0}',
      'double//slash',
      '.hidden/branch',
      'branch/.hidden',
      'segment./x',
      'branch.lock',
    ]) {
      expect(isValidBranchName(name), name).toBe(false);
    }
  });
});

describe('resolveFromBranch', () => {
  it("defaults to the project's default branch on the base remote", async () => {
    const resolved = await resolveFromBranch(
      project([localBranch('main'), remoteBranch('main')]),
      undefined
    );

    expect(resolved).toEqual(ok({ type: 'remote', branch: 'main', remote: origin }));
  });

  it('falls back to a local ref when the refs snapshot has no match', async () => {
    const resolved = await resolveFromBranch(project([]), undefined);

    expect(resolved).toEqual(ok({ type: 'local', branch: 'main' }));
  });

  it('prefers the base remote copy of a requested branch', async () => {
    const resolved = await resolveFromBranch(
      project([localBranch('release'), remoteBranch('release')]),
      'release'
    );

    expect(resolved).toEqual(ok({ type: 'remote', branch: 'release', remote: origin }));
  });

  it('uses a local branch when the remote has no copy', async () => {
    const resolved = await resolveFromBranch(project([localBranch('scratch')]), 'scratch');

    expect(resolved).toEqual(ok({ type: 'local', branch: 'scratch' }));
  });

  it('reports an unknown branch, hinting about remote prefixes', async () => {
    const resolved = await resolveFromBranch(project([localBranch('main')]), 'origin/main');

    expect(resolved.success).toBe(false);
    expect(resolved.success ? '' : resolved.error).toContain('without a remote prefix');
  });
});
