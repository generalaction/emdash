import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeCreateWorktree } from './create-worktree';

// Unit tests for the foreground pipeline's resolve-base stage (spec:
// workspace-activation-speed): creation never fetches when the base ref resolves
// locally; an unresolvable remote-shaped ref triggers exactly one targeted fetch.

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
      repositoryPath: repoPath,
      worktreePath: path.join(root, 'local-wt'),
      branch: 'feature/local',
      baseRef: 'main',
      onStage: (stage) => stages.push(stage),
    });

    expect(result).toMatchObject({ status: 'succeeded', createdWorktree: true });
    expect(stages).toEqual(['inspect', 'resolve-base', 'add-worktree', 'verify']);
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
  });

  it("fails creation cleanly with git's error when the remote base ref does not exist", async () => {
    const originPath = path.join(root, 'origin.git');
    git(root, 'init', '--bare', originPath);
    const repoPath = await makeRepo(root, 'repo');
    git(repoPath, 'remote', 'add', 'origin', originPath);

    const result = await executeCreateWorktree({
      repositoryPath: repoPath,
      worktreePath: path.join(root, 'doomed-wt'),
      branch: 'feature/doomed',
      baseRef: 'origin/never-pushed',
      onStage: () => undefined,
    });

    expect(result).toMatchObject({ status: 'failed', stage: 'resolve-base' });
  });
});
