import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import type { FileSystemProvider } from '@main/core/fs/types';
import { GitService } from './git-service';
import { computeBaseRef } from './git-utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockExec = (cmd: string, args?: string[]) => Promise<{ stdout: string; stderr: string }>;

/**
 * Builds a mock exec that returns pre-baked responses keyed by the joined args
 * string. Throws for any unmapped key (surfaces missing mocks early).
 */
function makeExec(map: Record<string, string>): MockExec {
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
function makePermissiveExec(map: Record<string, string>): MockExec {
  return async (_cmd: string, args: string[] = []) => ({
    stdout: map[args.join(' ')] ?? '',
    stderr: '',
  });
}

const BRANCH_FORMAT =
  'branch -a --format=%(refname:short)|%(upstream:short)|%(upstream:track)|%(refname)';

const stubFs = {} as FileSystemProvider;
const execFileAsync = promisify(execFile);

function makeContext(exec: MockExec, root = '/repo'): IExecutionContext {
  return {
    root,
    supportsLocalSpawn: false,
    exec: (_cmd, args = [], _opts) => exec(_cmd, args),
    execStreaming: async (_cmd, _args, onChunk) => {
      onChunk('');
    },
    dispose: () => {},
  };
}

function makeService(exec: MockExec): GitService {
  const ctx = makeContext(exec);
  return new GitService(ctx, ctx, stubFs);
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd });
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout;
}

async function makeSubmoduleFixture(): Promise<{
  root: string;
  submodulePath: string;
  service: GitService;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'emdash-submodule-'));
  const subSrc = path.join(root, 'sub-src');
  const parent = path.join(root, 'parent');
  await fs.mkdir(subSrc);
  await fs.mkdir(parent);

  await git(subSrc, ['init', '-q']);
  await git(subSrc, ['config', 'user.email', 'test@example.com']);
  await git(subSrc, ['config', 'user.name', 'Test']);
  await fs.writeFile(path.join(subSrc, 'a.txt'), 'one\n');
  await git(subSrc, ['add', 'a.txt']);
  await git(subSrc, ['commit', '-qm', 'initial submodule']);

  await git(parent, ['init', '-q']);
  await git(parent, ['config', 'user.email', 'test@example.com']);
  await git(parent, ['config', 'user.name', 'Test']);
  await git(parent, [
    '-c',
    'protocol.file.allow=always',
    'submodule',
    'add',
    '-q',
    subSrc,
    'lib/sub',
  ]);
  await git(parent, ['commit', '-qm', 'add submodule']);

  const ctx = new LocalExecutionContext({ root: parent });
  const service = new GitService(ctx, ctx, new LocalFileSystem(parent));
  return { root: parent, submodulePath: 'lib/sub', service };
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

  it('normalizes disambiguated local short names like "heads/main" to "main"', async () => {
    const svc = makeService(
      makeExec({
        [BRANCH_FORMAT]: 'heads/main|||refs/heads/main\n',
      })
    );
    const [branch] = await svc.getBranches();
    expect(branch).toMatchObject({ type: 'local', branch: 'main' });
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
    expect(branches[0]).toMatchObject({
      type: 'remote',
      branch: 'main',
      remote: { name: 'origin' },
    });
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
      remote: { name: 'origin' },
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
// getDefaultBranch()
// ---------------------------------------------------------------------------

describe('GitService.getCurrentBranch', () => {
  it('returns canonical local branch name from symbolic full ref', async () => {
    const svc = makeService(
      makeExec({
        'rev-parse --symbolic-full-name HEAD': 'refs/heads/main',
      })
    );
    expect(await svc.getCurrentBranch()).toBe('main');
  });

  it('returns null when HEAD is detached', async () => {
    const svc = makeService(
      makeExec({
        'rev-parse --symbolic-full-name HEAD': 'HEAD',
      })
    );
    expect(await svc.getCurrentBranch()).toBeNull();
  });
});

describe('GitService.getStatusFingerprint', () => {
  it('hashes tracked-only porcelain status output', async () => {
    const stdout = ' M src/app.ts\0';
    const svc = makeService(
      makeExec({
        '--no-optional-locks status --porcelain=v1 -z -uno': stdout,
      })
    );

    await expect(svc.getStatusFingerprint('no')).resolves.toEqual({
      hash: createHash('sha256').update(stdout).digest('hex'),
      byteLength: Buffer.byteLength(stdout),
    });
  });

  it('can include untracked files in the fingerprint', async () => {
    const stdout = '?? nested/new-file.ts\0';
    const svc = makeService(
      makeExec({
        '--no-optional-locks status --porcelain=v1 -z --untracked-files=normal': stdout,
      })
    );

    await expect(svc.getStatusFingerprint('normal')).resolves.toMatchObject({
      hash: createHash('sha256').update(stdout).digest('hex'),
      byteLength: Buffer.byteLength(stdout),
    });
  });
});

describe('GitService submodule support', () => {
  it('expands dirty submodule files in full status', async () => {
    const { root, service } = await makeSubmoduleFixture();
    await fs.appendFile(path.join(root, 'lib/sub/a.txt'), 'two\n');

    const status = await service.getFullStatus();

    expect(status.unstaged).toEqual([
      {
        path: 'lib/sub/a.txt',
        status: 'modified',
        additions: 1,
        deletions: 0,
        submodule: { rootPath: 'lib/sub', path: 'a.txt' },
      },
    ]);
    expect(status.staged).toEqual([]);
  });

  it('does not expand uninitialized submodules as parent-repo files', async () => {
    const { root, service } = await makeSubmoduleFixture();
    await git(root, ['submodule', 'deinit', '-f', 'lib/sub']);
    await fs.writeFile(path.join(root, '.gitignore'), '.DS_Store\n');

    const status = await service.getFullStatus();
    const unstagedPaths = status.unstaged.map((change) => change.path);

    expect(unstagedPaths).toContain('.gitignore');
    expect(unstagedPaths).not.toContain('lib/sub/.gitignore');
  });

  it('stages and commits submodule file edits before committing the parent gitlink', async () => {
    const { root, service } = await makeSubmoduleFixture();
    await fs.appendFile(path.join(root, 'lib/sub/a.txt'), 'two\n');

    await service.stageFiles(['lib/sub/a.txt']);
    const staged = await service.getFullStatus();
    expect(staged.staged.map((change) => change.path)).toEqual(['lib/sub/a.txt']);

    const result = await service.commit('update submodule file');
    expect(result.success).toBe(true);

    await expect(gitOutput(path.join(root, 'lib/sub'), ['status', '--porcelain'])).resolves.toBe(
      ''
    );
    await expect(gitOutput(root, ['status', '--porcelain'])).resolves.toBe('');
    await expect(gitOutput(root, ['show', '--stat', '--oneline', 'HEAD'])).resolves.toContain(
      'lib/sub'
    );
  });

  it('expands committed submodule pointer changes to inner files', async () => {
    const { root, service } = await makeSubmoduleFixture();
    await fs.appendFile(path.join(root, 'lib/sub/a.txt'), 'two\n');
    await git(path.join(root, 'lib/sub'), ['add', 'a.txt']);
    await git(path.join(root, 'lib/sub'), ['commit', '-qm', 'change submodule file']);

    const status = await service.getFullStatus();

    expect(status.unstaged).toEqual([
      {
        path: 'lib/sub/a.txt',
        status: 'modified',
        additions: 1,
        deletions: 0,
        submodule: { rootPath: 'lib/sub', path: 'a.txt' },
      },
    ]);
  });

  it('reads submodule file contents from the parent gitlink ref for diffs', async () => {
    const { root, service } = await makeSubmoduleFixture();
    await fs.appendFile(path.join(root, 'lib/sub/a.txt'), 'two\n');
    await git(path.join(root, 'lib/sub'), ['add', 'a.txt']);
    await git(path.join(root, 'lib/sub'), ['commit', '-qm', 'change submodule file']);

    await expect(service.getFileAtHead('lib/sub/a.txt')).resolves.toBe('one');

    await service.stageFiles(['lib/sub/a.txt']);
    await expect(service.getFileAtIndex('lib/sub/a.txt')).resolves.toBe('one\ntwo');
  });
});

describe('GitService.isFileCleanlyTracked', () => {
  it('returns true when the file is tracked and unchanged', async () => {
    const svc = makeService(
      makeExec({
        'ls-files --error-unmatch -- .emdash.json': '.emdash.json\n',
        'diff --quiet -- .emdash.json': '',
        'diff --cached --quiet -- .emdash.json': '',
      })
    );

    await expect(svc.isFileCleanlyTracked('.emdash.json')).resolves.toBe(true);
  });

  it('returns false when the file is not tracked', async () => {
    const svc = makeService(makeExec({}));

    await expect(svc.isFileCleanlyTracked('.emdash.json')).resolves.toBe(false);
  });

  it('returns false when the file has unstaged changes', async () => {
    const exec: MockExec = async (_cmd, args = []) => {
      const key = args.join(' ');
      if (key === 'ls-files --error-unmatch -- .emdash.json') {
        return { stdout: '.emdash.json\n', stderr: '' };
      }
      if (key === 'diff --quiet -- .emdash.json') {
        throw Object.assign(new Error('diff found changes'), { code: 1 });
      }
      throw new Error(`Unexpected git command: git ${key}`);
    };

    await expect(makeService(exec).isFileCleanlyTracked('.emdash.json')).resolves.toBe(false);
  });
});

describe('GitService.getDefaultBranch', () => {
  it('resolves from symbolic-ref cache (heuristic 1)', async () => {
    const svc = makeService(
      makePermissiveExec({
        'symbolic-ref refs/remotes/origin/HEAD --short': 'origin/main',
      })
    );
    expect(await svc.getDefaultBranch()).toBe('main');
  });

  it('resolves from symbolic-ref cache when ref has no slash', async () => {
    const svc = makeService(
      makePermissiveExec({
        'symbolic-ref refs/remotes/origin/HEAD --short': 'main',
      })
    );
    expect(await svc.getDefaultBranch()).toBe('main');
  });

  it('falls back to local branch candidate "main" when symbolic-ref fails', async () => {
    const exec = makeExec({
      'rev-parse --verify refs/heads/main': 'abc123',
    });
    // Override to throw for the first two heuristics
    const overriddenExec: MockExec = async (_cmd, args = []) => {
      const key = args.join(' ');
      if (key === 'symbolic-ref refs/remotes/origin/HEAD --short') {
        throw Object.assign(new Error('no HEAD'), { code: 128 });
      }
      if (key === 'remote show origin') {
        throw Object.assign(new Error('no remote'), { code: 128 });
      }
      return exec(_cmd, args);
    };
    expect(await makeService(overriddenExec).getDefaultBranch()).toBe('main');
  });

  it('falls back to "main" convention when no heuristic resolves', async () => {
    const failingExec: MockExec = async () => {
      throw Object.assign(new Error('nothing works'), { code: 128 });
    };
    expect(await makeService(failingExec).getDefaultBranch()).toBe('main');
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

describe('GitService.push', () => {
  it('pushes the current branch to the preferred remote explicitly', async () => {
    const svc = makeService(
      makeExec({
        'branch --show-current': 'feature/test\n',
        'push fork HEAD:feature/test': 'pushed',
      })
    );

    await expect(svc.push('fork')).resolves.toEqual({
      success: true,
      data: { output: 'pushed' },
    });
  });
});
