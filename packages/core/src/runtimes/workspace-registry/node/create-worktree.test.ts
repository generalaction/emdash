import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeCreateWorktree } from './create-worktree';
import { createRegistryGitContext } from './git-context';

// Unit tests for the foreground pipeline's resolve-base stage (spec:
// workspace-activation-speed): creation never fetches when the base ref resolves
// locally; an unresolvable remote-shaped ref triggers exactly one targeted fetch.

const gitContext = createRegistryGitContext();

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      GIT_TERMINAL_PROMPT: '0',
    },
  }).trim();
}

async function makeRepo(root: string, name: string): Promise<string> {
  const repoPath = path.join(root, name);
  await fs.mkdir(repoPath, { recursive: true });
  git(repoPath, 'init', '--initial-branch=main');
  await fs.writeFile(path.join(repoPath, 'README.md'), `# ${name}\n`);
  git(repoPath, 'add', '.');
  git(repoPath, 'commit', '-m', 'initial');
  return repoPath;
}

/**
 * Seeds a bare "remote" carrying a PR-style ref (refs/pull/7/head) whose commit is not
 * on main, plus main itself. Returns the remote path and the PR head's OID.
 */
async function makePrRemote(
  root: string,
  name: string
): Promise<{ originPath: string; prHeadOid: string }> {
  const seed = await makeRepo(root, `${name}-seed`);
  git(seed, 'checkout', '-b', 'pr-source');
  await fs.writeFile(path.join(seed, 'pr-change.txt'), 'from the PR\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-m', 'pr change');
  const prHeadOid = git(seed, 'rev-parse', 'HEAD');
  const originPath = path.join(root, `${name}.git`);
  git(root, 'init', '--bare', originPath);
  git(seed, 'push', originPath, 'main', 'HEAD:refs/pull/7/head');
  return { originPath, prHeadOid };
}

describe('executeCreateWorktree resolve-base', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ws-create-')));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('creates from a locally resolvable ref with zero network (unreachable remote)', async () => {
    const repoPath = await makeRepo(root, 'repo');
    // A remote that would hang or fail: resolve-base must never touch it.
    git(repoPath, 'remote', 'add', 'origin', path.join(root, 'missing.git'));

    const stages: string[] = [];
    const result = await executeCreateWorktree({
      git: gitContext,
      repositoryPath: repoPath,
      worktreePath: path.join(root, 'local-wt'),
      branch: 'feature/local',
      baseRef: 'main',
      onStage: (stage) => stages.push(stage),
    });

    expect(result).toMatchObject({ status: 'succeeded', createdWorktree: true });
    expect(stages).toEqual(['inspect', 'resolve-base', 'add-worktree', 'verify']);
  });

  it.each([undefined, false, true])(
    'creates from the selected remote base with fetchLatestBase=%s',
    async (fetchLatestBase) => {
      const seed = await makeRepo(root, 'seed');
      const remotePath = path.join(root, 'company.git');
      git(root, 'init', '--bare', remotePath);
      git(seed, 'push', remotePath, 'HEAD:refs/heads/feature/base');
      const cachedOid = git(seed, 'rev-parse', 'HEAD');
      const repoPath = await makeRepo(root, 'repo');
      git(repoPath, 'remote', 'add', 'company', remotePath);
      git(
        repoPath,
        'fetch',
        'company',
        'refs/heads/feature/base:refs/remotes/company/feature/base',
        '--no-write-fetch-head'
      );
      await fs.writeFile(path.join(seed, 'latest.txt'), 'latest\n');
      git(seed, 'add', '.');
      git(seed, 'commit', '-m', 'remote advance');
      git(seed, 'tag', 'latest-tag');
      git(
        seed,
        'push',
        remotePath,
        'HEAD:refs/heads/feature/base',
        'HEAD:refs/heads/other',
        'latest-tag'
      );
      const latestOid = git(seed, 'rev-parse', 'HEAD');
      const sourceOid = git(repoPath, 'rev-parse', 'HEAD');
      await fs.writeFile(path.join(repoPath, 'README.md'), 'local uncommitted edit\n');
      const worktreePath = path.join(root, 'fresh-wt');
      const stages: string[] = [];
      const fetchTimeouts: (number | undefined)[] = [];
      const recordingGit = {
        ...gitContext,
        exec: (...params: Parameters<typeof gitContext.exec>) => {
          const bound = gitContext.exec(...params);
          return {
            ...bound,
            exec: async (...args: Parameters<typeof bound.exec>) => {
              if (args[0][0] === 'fetch') fetchTimeouts.push(args[1]?.timeoutMs);
              const result = await bound.exec(...args);
              if (
                fetchLatestBase &&
                args[0][0] === 'rev-parse' &&
                args[0].includes('refs/remotes/company/feature/base^{commit}')
              ) {
                // Simulate another fetch moving the tracking ref after we resolve its commit.
                git(repoPath, 'update-ref', 'refs/remotes/company/feature/base', cachedOid);
              }
              return result;
            },
          };
        },
      };

      const result = await executeCreateWorktree({
        git: recordingGit,
        repositoryPath: repoPath,
        worktreePath,
        branch: 'feature/task',
        baseRef: 'company/feature/base',
        fetchLatestBase,
        onStage: (stage) => stages.push(stage),
      });

      expect(result.status).toBe('succeeded');
      expect(git(worktreePath, 'rev-parse', 'HEAD')).toBe(fetchLatestBase ? latestOid : cachedOid);
      expect(stages.includes('fetch-base')).toBe(fetchLatestBase === true);
      expect(fetchTimeouts).toEqual(fetchLatestBase ? [60_000] : []);
      expect(git(repoPath, 'rev-parse', 'HEAD')).toBe(sourceOid);
      expect(await fs.readFile(path.join(repoPath, 'README.md'), 'utf8')).toBe(
        'local uncommitted edit\n'
      );
      expect(git(repoPath, 'for-each-ref', 'refs/remotes', '--format=%(refname)')).toBe(
        'refs/remotes/company/feature/base'
      );
      expect(git(repoPath, 'tag')).toBe('');
      await expect(fs.access(path.join(repoPath, '.git', 'FETCH_HEAD'))).rejects.toThrow();
    },
    15_000
  );

  it.each(['unreachable', 'deleted'] as const)(
    'blocks creation when the cached remote base is %s',
    async (state) => {
      const repoPath = await makeRepo(root, 'repo');
      const remotePath = path.join(root, 'origin.git');
      if (state === 'deleted') git(root, 'init', '--bare', remotePath);
      git(repoPath, 'remote', 'add', 'origin', remotePath);
      git(repoPath, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
      const worktreePath = path.join(root, 'failed-fetch-wt');
      const stages: string[] = [];

      const result = await executeCreateWorktree({
        git: gitContext,
        repositoryPath: repoPath,
        worktreePath,
        branch: 'feature/failed-fetch',
        baseRef: 'origin/main',
        fetchLatestBase: true,
        onStage: (stage) => stages.push(stage),
      });

      expect(result).toMatchObject({ status: 'failed', stage: 'resolve-base' });
      expect(stages).toContain('fetch-base');
      expect(stages).not.toContain('add-worktree');
      expect(git(repoPath, 'branch', '--list', 'feature/failed-fetch')).toBe('');
      await expect(fs.access(worktreePath)).rejects.toThrow();
    }
  );

  it('rejects enabled fetching from a local base', async () => {
    const repoPath = await makeRepo(root, 'repo');
    const result = await executeCreateWorktree({
      git: gitContext,
      repositoryPath: repoPath,
      worktreePath: path.join(root, 'local-fetch-wt'),
      branch: 'feature/invalid',
      baseRef: 'main',
      fetchLatestBase: true,
      onStage: () => undefined,
    });
    expect(result).toMatchObject({
      status: 'failed',
      message: 'Select a remote base branch to fetch its latest commit',
    });
  });

  it('reuses an existing branch without fetching an enabled base', async () => {
    const repoPath = await makeRepo(root, 'repo');
    git(repoPath, 'branch', 'feature/existing');
    git(repoPath, 'remote', 'add', 'origin', path.join(root, 'missing.git'));
    const oid = git(repoPath, 'rev-parse', 'feature/existing');
    const worktreePath = path.join(root, 'existing-branch-wt');
    const stages: string[] = [];
    const result = await executeCreateWorktree({
      git: gitContext,
      repositoryPath: repoPath,
      worktreePath,
      branch: 'feature/existing',
      baseRef: 'origin/main',
      fetchLatestBase: true,
      onStage: (stage) => stages.push(stage),
    });
    expect(result).toMatchObject({ status: 'succeeded', createdBranch: false });
    expect(stages).not.toContain('fetch-base');
    expect(git(worktreePath, 'rev-parse', 'HEAD')).toBe(oid);
  });

  it('fetches only the missing remote-shaped base ref — no tags, no other branches', async () => {
    const seed = await makeRepo(root, 'seed');
    git(seed, 'checkout', '-b', 'feature/base');
    await fs.writeFile(path.join(seed, 'base.txt'), 'base\n');
    git(seed, 'add', '.');
    git(seed, 'commit', '-m', 'base branch');
    git(seed, 'tag', 'v1');
    const originPath = path.join(root, 'origin.git');
    git(root, 'init', '--bare', originPath);
    git(seed, 'push', originPath, 'main', 'feature/base', 'v1');

    const repoPath = await makeRepo(root, 'repo');
    git(repoPath, 'remote', 'add', 'origin', originPath);
    expect(git(repoPath, 'branch', '-r')).toBe('');

    const stages: string[] = [];
    const result = await executeCreateWorktree({
      git: gitContext,
      repositoryPath: repoPath,
      worktreePath: path.join(root, 'remote-wt'),
      branch: 'feature/from-remote',
      baseRef: 'origin/feature/base',
      onStage: (stage) => stages.push(stage),
    });

    expect(result).toMatchObject({ status: 'succeeded' });
    expect(stages).toContain('fetch-base');
    const remoteRefs = git(repoPath, 'for-each-ref', 'refs/remotes', '--format=%(refname)');
    expect(remoteRefs).toBe('refs/remotes/origin/feature/base');
    expect(git(repoPath, 'tag')).toBe('');
    expect(
      git(repoPath, 'for-each-ref', 'refs/heads/feature/from-remote', '--format=%(upstream:short)')
    ).toBe('');
  });

  it("fails creation cleanly with git's error when the remote base ref does not exist", async () => {
    const originPath = path.join(root, 'origin.git');
    git(root, 'init', '--bare', originPath);
    const repoPath = await makeRepo(root, 'repo');
    git(repoPath, 'remote', 'add', 'origin', originPath);

    const result = await executeCreateWorktree({
      git: gitContext,
      repositoryPath: repoPath,
      worktreePath: path.join(root, 'doomed-wt'),
      branch: 'feature/doomed',
      baseRef: 'origin/never-pushed',
      onStage: () => undefined,
    });

    expect(result).toMatchObject({ status: 'failed', stage: 'resolve-base' });
  });
});

// Integration tests for the gitSetup stages (spec: pr-workspace-model provisioning):
// fetch-branch materializes refs/heads/<branch> from an arbitrary source ref with a
// plain (never force) refspec, configure-branch writes upstream tracking and the PR
// breadcrumb idempotently, and failures stage-tag and roll back like every other stage.
describe('executeCreateWorktree gitSetup', () => {
  let root: string;
  let repoPath: string;
  let originPath: string;
  let prHeadOid: string;

  const gitSetup = {
    fetchBranch: { remote: 'origin', sourceRef: 'refs/pull/7/head' },
    upstream: { remote: 'origin', mergeRef: 'refs/pull/7/head' },
    breadcrumb: { prUrl: 'https://github.com/acme/repo/pull/7' },
  };

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ws-gitsetup-')));
    ({ originPath, prHeadOid } = await makePrRemote(root, 'origin'));
    repoPath = await makeRepo(root, 'repo');
    git(repoPath, 'remote', 'add', 'origin', originPath);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('fetches the source ref into the branch, checks it out, and configures it', async () => {
    const stages: string[] = [];
    const result = await executeCreateWorktree({
      git: gitContext,
      repositoryPath: repoPath,
      worktreePath: path.join(root, 'pr-wt'),
      branch: 'pr/7/fix',
      baseRef: null,
      gitSetup,
      onStage: (stage) => stages.push(stage),
    });

    expect(result).toMatchObject({
      status: 'succeeded',
      createdWorktree: true,
      createdBranch: true,
    });
    expect(stages).toEqual([
      'inspect',
      'fetch-branch',
      'add-worktree',
      'configure-branch',
      'verify',
    ]);
    expect(git(repoPath, 'rev-parse', 'refs/heads/pr/7/fix')).toBe(prHeadOid);
    expect(git(path.join(root, 'pr-wt'), 'branch', '--show-current')).toBe('pr/7/fix');
    expect(git(repoPath, 'config', 'branch.pr/7/fix.remote')).toBe('origin');
    expect(git(repoPath, 'config', 'branch.pr/7/fix.merge')).toBe('refs/pull/7/head');
    expect(git(repoPath, 'config', 'branch.pr/7/fix.emdash-pr-url')).toBe(
      'https://github.com/acme/repo/pull/7'
    );
  });

  it('reuses an existing branch untouched (fetch skipped) and still configures it', async () => {
    git(repoPath, 'branch', 'pr/7/fix');
    const localOid = git(repoPath, 'rev-parse', 'refs/heads/pr/7/fix');
    expect(localOid).not.toBe(prHeadOid);

    const stages: string[] = [];
    const result = await executeCreateWorktree({
      git: gitContext,
      repositoryPath: repoPath,
      worktreePath: path.join(root, 'reuse-wt'),
      branch: 'pr/7/fix',
      baseRef: null,
      gitSetup,
      onStage: (stage) => stages.push(stage),
    });

    expect(result).toMatchObject({
      status: 'succeeded',
      createdWorktree: true,
      createdBranch: false,
    });
    expect(stages).not.toContain('fetch-branch');
    expect(stages).toContain('configure-branch');
    // The replay rule: refs/heads/<branch> is never force-updated by the host.
    expect(git(repoPath, 'rev-parse', 'refs/heads/pr/7/fix')).toBe(localOid);
    expect(git(repoPath, 'config', 'branch.pr/7/fix.remote')).toBe('origin');
    expect(git(repoPath, 'config', 'branch.pr/7/fix.emdash-pr-url')).toBe(
      'https://github.com/acme/repo/pull/7'
    );
  });

  it('a fetchBranch without upstream or breadcrumb never runs configure-branch', async () => {
    const stages: string[] = [];
    const result = await executeCreateWorktree({
      git: gitContext,
      repositoryPath: repoPath,
      worktreePath: path.join(root, 'plain-wt'),
      branch: 'pr/7/plain',
      baseRef: null,
      gitSetup: { fetchBranch: gitSetup.fetchBranch, followRef: true },
      onStage: (stage) => stages.push(stage),
    });

    expect(result).toMatchObject({ status: 'succeeded' });
    expect(stages).toContain('fetch-branch');
    expect(stages).not.toContain('configure-branch');
  });

  it('a failed fetch is a stage-tagged fetch-branch failure leaving no debris branch', async () => {
    const result = await executeCreateWorktree({
      git: gitContext,
      repositoryPath: repoPath,
      worktreePath: path.join(root, 'doomed-wt'),
      branch: 'pr/999/missing',
      baseRef: null,
      gitSetup: {
        fetchBranch: { remote: 'origin', sourceRef: 'refs/pull/999/head' },
        breadcrumb: { prUrl: 'https://github.com/acme/repo/pull/999' },
      },
      onStage: () => undefined,
    });

    expect(result).toMatchObject({ status: 'failed', stage: 'fetch-branch' });
    expect(git(repoPath, 'branch', '--list', 'pr/999/missing')).toBe('');
    await expect(fs.access(path.join(root, 'doomed-wt'))).rejects.toThrow();
  });

  it('a failed configure-branch rolls back the worktree and the fetched branch', async () => {
    // A stale config lock makes every `git config` write fail while fetch and
    // worktree-add (which never touch the config file) still succeed.
    await fs.writeFile(path.join(repoPath, '.git', 'config.lock'), '');

    const result = await executeCreateWorktree({
      git: gitContext,
      repositoryPath: repoPath,
      worktreePath: path.join(root, 'locked-wt'),
      branch: 'pr/7/locked',
      baseRef: null,
      gitSetup: {
        fetchBranch: { remote: 'origin', sourceRef: 'refs/pull/7/head' },
        upstream: { remote: 'origin', mergeRef: 'refs/pull/7/head' },
      },
      onStage: () => undefined,
    });

    expect(result).toMatchObject({ status: 'failed', stage: 'configure-branch' });
    expect(git(repoPath, 'branch', '--list', 'pr/7/locked')).toBe('');
    await expect(fs.access(path.join(root, 'locked-wt'))).rejects.toThrow();
  });
});
