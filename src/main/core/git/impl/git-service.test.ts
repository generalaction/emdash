import { describe, expect, it } from 'vitest';
import type { FileSystemProvider } from '@main/core/fs/types';
import type { ExecFn } from '@main/core/utils/exec';
import { GitService } from './git-service';
import { computeBaseRef } from './git-utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds an ExecFn that returns pre-baked responses keyed by the joined args
 * string. Throws for any unmapped key (surfaces missing mocks early).
 */
function makeExec(map: Record<string, string>): ExecFn {
  return async (_cmd: string, args: string[] = []) => {
    const key = args.join(' ');
    if (key in map) {
      return { stdout: map[key], stderr: '' };
    }
    throw Object.assign(new Error(`Unexpected git command: git ${key}`), {
      stdout: '',
      stderr: `fatal: not expected`,
      code: 128,
    });
  };
}

/**
 * Like makeExec but silently returns '' for unmapped keys. Useful when a
 * method makes optional/fallback calls that aren't relevant to the test.
 */
function makePermissiveExec(map: Record<string, string>): ExecFn {
  return async (_cmd: string, args: string[] = []) => ({
    stdout: map[args.join(' ')] ?? '',
    stderr: '',
  });
}

const BRANCH_FORMAT =
  'branch -a --format=%(refname:short)|%(upstream:short)|%(upstream:track)|%(refname)';

const stubFs = {} as FileSystemProvider;

function makeService(exec: ExecFn): GitService {
  return new GitService('/repo', exec, stubFs);
}

// ---------------------------------------------------------------------------
// getBranches()
// ---------------------------------------------------------------------------

describe('GitService.getBranches', () => {
  it('returns an empty array when stdout is empty', async () => {
    const svc = makeService(makeExec({ [BRANCH_FORMAT]: '' }));
    expect(await svc.getBranches()).toEqual([]);
  });

  it('categorises a plain local branch correctly', async () => {
    const svc = makeService(
      makeExec({
        [BRANCH_FORMAT]: 'main|||refs/heads/main\n',
      })
    );
    const branches = await svc.getBranches();
    expect(branches).toHaveLength(1);
    expect(branches[0]).toMatchObject({ type: 'local', branch: 'main' });
  });

  it('categorises a remote tracking branch as type=remote (regression: remotes/ prefix bug)', async () => {
    // %(refname:short) gives "origin/main" — not "remotes/origin/main".
    // The old code checked startsWith('remotes/') which never matched, so all
    // remote branches were misclassified as local.
    const svc = makeService(
      makeExec({
        [BRANCH_FORMAT]: 'origin/main|||refs/remotes/origin/main\n',
      })
    );
    const branches = await svc.getBranches();
    expect(branches).toHaveLength(1);
    expect(branches[0]).toMatchObject({ type: 'remote', branch: 'main', remote: 'origin' });
  });

  it('skips remotes/origin/HEAD entries', async () => {
    const svc = makeService(
      makeExec({
        [BRANCH_FORMAT]: 'origin/HEAD|||refs/remotes/origin/HEAD\n',
      })
    );
    expect(await svc.getBranches()).toHaveLength(0);
  });

  it('parses bracketed tracking info [ahead 1, behind 2] (Apple git 2.39.5 format)', async () => {
    // Apple git 2.39.5 outputs %(upstream:track) with brackets: [ahead 1, behind 2]
    // The ,nobrackets modifier was only added in git 2.40 and caused a fatal error.
    const svc = makeService(
      makeExec({
        [BRANCH_FORMAT]: 'feature|origin/feature|[ahead 1, behind 2]|refs/heads/feature\n',
      })
    );
    const branches = await svc.getBranches();
    expect(branches).toHaveLength(1);
    expect(branches[0]).toMatchObject({
      type: 'local',
      branch: 'feature',
      remote: 'origin',
      divergence: { ahead: 1, behind: 2 },
    });
  });

  it('parses unbracketed tracking info (newer git format: ahead 1, behind 2)', async () => {
    const svc = makeService(
      makeExec({
        [BRANCH_FORMAT]: 'feature|origin/feature|ahead 1, behind 2|refs/heads/feature\n',
      })
    );
    const branches = await svc.getBranches();
    expect(branches[0]).toMatchObject({
      divergence: { ahead: 1, behind: 2 },
    });
  });

  it('handles a local branch that is only ahead (no behind)', async () => {
    const svc = makeService(
      makeExec({
        [BRANCH_FORMAT]: 'feat|origin/feat|[ahead 3]|refs/heads/feat\n',
      })
    );
    const [branch] = await svc.getBranches();
    expect(branch).toMatchObject({ divergence: { ahead: 3, behind: 0 } });
  });

  it('handles a local branch that is only behind (no ahead)', async () => {
    const svc = makeService(
      makeExec({
        [BRANCH_FORMAT]: 'feat|origin/feat|[behind 5]|refs/heads/feat\n',
      })
    );
    const [branch] = await svc.getBranches();
    expect(branch).toMatchObject({ divergence: { ahead: 0, behind: 5 } });
  });

  it('returns no divergence when track field is empty', async () => {
    const svc = makeService(
      makeExec({
        [BRANCH_FORMAT]: 'main|origin/main||refs/heads/main\n',
      })
    );
    const [branch] = await svc.getBranches();
    expect(branch).toMatchObject({ type: 'local', branch: 'main' });
    expect((branch as { divergence?: unknown }).divergence).toBeUndefined();
  });

  it('returns a local branch with no upstream and no divergence', async () => {
    const svc = makeService(
      makeExec({
        [BRANCH_FORMAT]: 'orphan|||refs/heads/orphan\n',
      })
    );
    const [branch] = await svc.getBranches();
    expect(branch).toMatchObject({ type: 'local', branch: 'orphan' });
    expect((branch as { remote?: unknown }).remote).toBeUndefined();
  });

  it('correctly splits a mixed list into local and remote counts', async () => {
    const lines = [
      'main|||refs/heads/main',
      'feature|origin/feature|[ahead 1]|refs/heads/feature',
      'origin/main|||refs/remotes/origin/main',
      'origin/develop|||refs/remotes/origin/develop',
      'origin/HEAD|||refs/remotes/origin/HEAD', // should be skipped
    ].join('\n');

    const svc = makeService(makeExec({ [BRANCH_FORMAT]: lines }));
    const branches = await svc.getBranches();
    const local = branches.filter((b) => b.type === 'local');
    const remote = branches.filter((b) => b.type === 'remote');

    expect(local).toHaveLength(2);
    expect(remote).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// getBranchStatus()
// ---------------------------------------------------------------------------

describe('GitService.getBranchStatus', () => {
  it('returns branch name with ahead/behind when upstream is configured', async () => {
    const svc = makeService(
      makeExec({
        'branch --show-current': 'main',
        'rev-parse --abbrev-ref --symbolic-full-name @{upstream}': 'refs/remotes/origin/main',
        'rev-list --left-right --count @{upstream}...HEAD': '2\t3',
      })
    );
    const status = await svc.getBranchStatus();
    expect(status).toEqual({
      branch: 'main',
      upstream: 'refs/remotes/origin/main',
      ahead: 3,
      behind: 2,
    });
  });

  it('returns zeros when no upstream is configured', async () => {
    // Both upstream calls throw — the service should swallow them and default to 0.
    const exec: ExecFn = async (_cmd, args = []) => {
      const key = args.join(' ');
      if (key === 'branch --show-current') return { stdout: 'local-only', stderr: '' };
      throw Object.assign(new Error('no upstream'), { code: 128 });
    };
    const svc = makeService(exec);
    const status = await svc.getBranchStatus();
    expect(status).toEqual({ branch: 'local-only', upstream: undefined, ahead: 0, behind: 0 });
  });
});

// ---------------------------------------------------------------------------
// getDefaultBranch()
// ---------------------------------------------------------------------------

describe('GitService.getDefaultBranch', () => {
  it('resolves from symbolic-ref cache (heuristic 1) when branch exists locally', async () => {
    const svc = makeService(
      makePermissiveExec({
        'symbolic-ref refs/remotes/origin/HEAD --short': 'origin/main',
        'rev-parse --verify refs/heads/main': 'abc123',
      })
    );
    const result = await svc.getDefaultBranch();
    expect(result).toEqual({ name: 'main', remote: 'origin', existsLocally: true });
  });

  it('resolves from symbolic-ref cache when branch does NOT exist locally', async () => {
    const exec: ExecFn = async (_cmd, args = []) => {
      const key = args.join(' ');
      if (key === 'symbolic-ref refs/remotes/origin/HEAD --short') {
        return { stdout: 'origin/main', stderr: '' };
      }
      // rev-parse for refs/heads/main throws → existsLocally = false
      throw Object.assign(new Error('no branch'), { code: 128 });
    };
    const svc = makeService(exec);
    const result = await svc.getDefaultBranch();
    expect(result).toEqual({ name: 'main', remote: 'origin', existsLocally: false });
  });

  it('falls back to local branch candidate "main" when symbolic-ref fails', async () => {
    const exec: ExecFn = async (_cmd, args = []) => {
      const key = args.join(' ');
      // heuristic 1 fails
      if (key === 'symbolic-ref refs/remotes/origin/HEAD --short') {
        throw Object.assign(new Error('no HEAD'), { code: 128 });
      }
      // heuristic 2 fails
      if (key === 'remote show origin') {
        throw Object.assign(new Error('no remote'), { code: 128 });
      }
      // heuristic 3: "main" exists locally
      if (key === 'rev-parse --verify refs/heads/main') {
        return { stdout: 'abc123', stderr: '' };
      }
      throw Object.assign(new Error('unexpected'), { code: 128 });
    };
    const svc = makeService(exec);
    const result = await svc.getDefaultBranch();
    expect(result).toEqual({ name: 'main', remote: undefined, existsLocally: true });
  });

  it('falls back to "main" convention when no heuristic resolves', async () => {
    const exec: ExecFn = async () => {
      throw Object.assign(new Error('nothing works'), { code: 128 });
    };
    const svc = makeService(exec);
    const result = await svc.getDefaultBranch();
    expect(result).toEqual({ name: 'main', remote: undefined, existsLocally: false });
  });
});

// ---------------------------------------------------------------------------
// computeBaseRef() — pure utility, no mocking needed
// ---------------------------------------------------------------------------

describe('computeBaseRef', () => {
  it('prefixes branch with remote name when both are provided', () => {
    // computeBaseRef(baseRef, remote, branch) — remote is the 2nd argument
    expect(computeBaseRef(undefined, 'origin', 'main')).toBe('origin/main');
  });

  it('uses the provided baseRef when it already contains a slash', () => {
    expect(computeBaseRef('origin/develop')).toBe('origin/develop');
  });

  it('falls back to remote/main when no branch is provided', () => {
    expect(computeBaseRef(undefined, 'origin')).toBe('origin/main');
  });

  it('maps a URL remote to "origin" and combines with branch', () => {
    // A URL remote (contains "://") is normalised to the "origin" remote name.
    expect(computeBaseRef(undefined, 'https://github.com/org/repo.git', 'main')).toBe(
      'origin/main'
    );
  });

  it('returns "main" when all arguments are absent', () => {
    expect(computeBaseRef()).toBe('main');
  });

  it('strips a leading slash from a baseRef that has no remote', () => {
    expect(computeBaseRef('/main')).toBe('main');
  });
});
