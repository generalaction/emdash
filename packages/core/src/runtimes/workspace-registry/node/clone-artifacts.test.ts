import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { executeCloneArtifacts } from './clone-artifacts';

// Unit tests for the clone-artifacts background step (spec: workspace-activation-speed):
// the full gitignored set rides into the new worktree, exclude patterns are deleted
// post-clone, replays redo only missing entries, and the deprecated preservePatterns
// shim keeps working when cloning is opted out.

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

describe('executeCloneArtifacts', () => {
  let root: string;
  let repoPath: string;
  let worktreePath: string;

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ws-clone-')));
    repoPath = path.join(root, 'repo');
    await fs.mkdir(repoPath, { recursive: true });
    git(repoPath, 'init', '--initial-branch=main');
    await fs.writeFile(path.join(repoPath, 'README.md'), '# repo\n');
    await fs.writeFile(path.join(repoPath, '.gitignore'), 'node_modules/\ndist/\n.env\n*.log\n');
    git(repoPath, 'add', '.');
    git(repoPath, 'commit', '-m', 'initial');

    // Ignored artifacts at several depths, including a nested per-package node_modules.
    await fs.mkdir(path.join(repoPath, 'node_modules', 'dep'), { recursive: true });
    await fs.writeFile(path.join(repoPath, 'node_modules', 'dep', 'index.js'), 'dep\n');
    await fs.mkdir(path.join(repoPath, 'node_modules', '.cache'), { recursive: true });
    await fs.writeFile(path.join(repoPath, 'node_modules', '.cache', 'junk'), 'junk\n');
    await fs.mkdir(path.join(repoPath, 'packages', 'a'), { recursive: true });
    await fs.writeFile(path.join(repoPath, 'packages', 'a', 'main.ts'), 'code\n');
    git(repoPath, 'add', 'packages');
    git(repoPath, 'commit', '-m', 'package a');
    await fs.mkdir(path.join(repoPath, 'packages', 'a', 'node_modules', 'x'), {
      recursive: true,
    });
    await fs.writeFile(path.join(repoPath, 'packages', 'a', 'node_modules', 'x', 'x.js'), 'x\n');
    await fs.mkdir(path.join(repoPath, 'dist'), { recursive: true });
    await fs.writeFile(path.join(repoPath, 'dist', 'out.js'), 'built\n');
    await fs.writeFile(path.join(repoPath, '.env'), 'SECRET=1\n');
    await fs.writeFile(path.join(repoPath, 'debug.log'), 'log\n');

    worktreePath = path.join(root, 'wt');
    git(repoPath, 'worktree', 'add', '-b', 'clone-test', worktreePath, 'main');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('clones the full gitignored set and deletes built-in exclude matches', async () => {
    const outcome = await executeCloneArtifacts({
      repositoryPath: repoPath,
      worktreePath,
      preservePatterns: [],
    });

    expect(outcome.status).toBe('succeeded');
    await fs.access(path.join(worktreePath, 'node_modules', 'dep', 'index.js'));
    await fs.access(path.join(worktreePath, 'packages', 'a', 'node_modules', 'x', 'x.js'));
    await fs.access(path.join(worktreePath, 'dist', 'out.js'));
    await fs.access(path.join(worktreePath, '.env'));
    await fs.access(path.join(worktreePath, 'debug.log'));
    // Built-in exclude: **/node_modules/.cache is deleted post-clone.
    await expect(fs.access(path.join(worktreePath, 'node_modules', '.cache'))).rejects.toThrow();
    // Tracked files stay untouched and git status stays clean.
    expect(git(worktreePath, 'status', '--porcelain')).toBe('');
  });

  it('replays idempotently: existing entries are trusted, missing ones are redone', async () => {
    const first = await executeCloneArtifacts({
      repositoryPath: repoPath,
      worktreePath,
      preservePatterns: [],
    });
    expect(first.status).toBe('succeeded');

    // A replayed clone must not clobber divergent workspace state...
    await fs.writeFile(path.join(worktreePath, '.env'), 'SECRET=changed\n');
    // ...and must redo entries that are missing (simulated torn clone).
    await fs.rm(path.join(worktreePath, 'dist'), { recursive: true });

    const second = await executeCloneArtifacts({
      repositoryPath: repoPath,
      worktreePath,
      preservePatterns: [],
    });
    expect(second.status).toBe('succeeded');
    expect(await fs.readFile(path.join(worktreePath, '.env'), 'utf8')).toBe('SECRET=changed\n');
    await fs.access(path.join(worktreePath, 'dist', 'out.js'));
  });

  it('honors user excludePatterns from the repository .emdash.json', async () => {
    await fs.writeFile(
      path.join(repoPath, EMDASH_CONFIG),
      JSON.stringify({ excludePatterns: ['dist'] })
    );
    const outcome = await executeCloneArtifacts({
      repositoryPath: repoPath,
      worktreePath,
      preservePatterns: [],
    });
    expect(outcome.status).toBe('succeeded');
    await expect(fs.access(path.join(worktreePath, 'dist'))).rejects.toThrow();
    await fs.access(path.join(worktreePath, 'node_modules', 'dep', 'index.js'));
  });

  it("['**'] opts out of cloning entirely while the preservePatterns shim still runs", async () => {
    await fs.writeFile(
      path.join(repoPath, EMDASH_CONFIG),
      JSON.stringify({ excludePatterns: ['**'] })
    );
    const outcome = await executeCloneArtifacts({
      repositoryPath: repoPath,
      worktreePath,
      preservePatterns: ['.env'],
    });
    expect(outcome.status).toBe('skipped');
    await expect(fs.access(path.join(worktreePath, 'node_modules'))).rejects.toThrow();
    await expect(fs.access(path.join(worktreePath, 'dist'))).rejects.toThrow();
    // The legacy preserve contract holds: the matched ignored file still arrives.
    expect(await fs.readFile(path.join(worktreePath, '.env'), 'utf8')).toBe('SECRET=1\n');
  });

  it('rejects unsafe preserve patterns with a warning instead of copying', async () => {
    await fs.writeFile(
      path.join(repoPath, EMDASH_CONFIG),
      JSON.stringify({ excludePatterns: ['**'] })
    );
    const outcome = await executeCloneArtifacts({
      repositoryPath: repoPath,
      worktreePath,
      preservePatterns: ['../outside', '/absolute'],
    });
    expect(outcome.status).toBe('skipped');
    await expect(fs.access(path.join(worktreePath, '.env'))).rejects.toThrow();
  });
});

const EMDASH_CONFIG = '.emdash.json';
