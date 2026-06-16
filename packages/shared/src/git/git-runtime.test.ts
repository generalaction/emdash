import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { IFileWatchService } from '../fs';
import { GitRuntime } from './index';

const execFileAsync = promisify(execFile);

async function makeRepo(): Promise<string> {
  const repo = await mkdtemp(path.join(tmpdir(), 'emdash-shared-runtime-'));
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  return repo;
}

async function makeRecordingGitExecutable(): Promise<{ executable: string; logPath: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'emdash-shared-runtime-git-bin-'));
  const executable = path.join(dir, 'git-wrapper.sh');
  const logPath = path.join(dir, 'git-calls.log');
  await writeFile(
    executable,
    ['#!/bin/sh', `printf '%s\\n' "$*" >> ${JSON.stringify(logPath)}`, 'exec git "$@"', ''].join(
      '\n'
    ),
    'utf8'
  );
  await chmod(executable, 0o755);
  return { executable, logPath };
}

function createNoopWatcher(): IFileWatchService {
  return {
    watch: () => ({
      ready: async () => {},
      release: () => {},
    }),
    dispose: async () => {},
  };
}

describe('GitRuntime', () => {
  it('inspects repository and non-repository paths without opening live models', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'emdash-shared-runtime-plain-'));
    const repo = await makeRepo();
    const runtime = new GitRuntime();

    try {
      await expect(runtime.inspectPath(directory)).resolves.toEqual({
        kind: 'not-repository',
        path: directory,
      });
      await expect(runtime.inspectPath(repo)).resolves.toMatchObject({
        kind: 'repository',
        rootPath: await realpath(repo),
        baseRef: 'main',
      });
    } finally {
      await runtime.dispose();
    }
  });

  it('does not classify bare repositories as project worktrees', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'emdash-shared-runtime-bare-'));
    await execFileAsync('git', ['init', '--bare'], { cwd: directory });
    const runtime = new GitRuntime();

    try {
      await expect(runtime.inspectPath(directory)).resolves.toEqual({
        kind: 'not-repository',
        path: directory,
      });
    } finally {
      await runtime.dispose();
    }
  });

  it('can initialize a missing repository when explicitly requested', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'emdash-shared-runtime-init-'));
    const runtime = new GitRuntime();

    try {
      await expect(runtime.ensureRepository(directory)).resolves.toEqual({
        success: false,
        error: { type: 'not-repository', path: directory },
      });

      const ensured = await runtime.ensureRepository(directory, { initIfMissing: true });

      expect(ensured).toMatchObject({
        success: true,
        data: {
          kind: 'repository',
          rootPath: await realpath(directory),
        },
      });
      await expect(runtime.inspectPath(directory)).resolves.toMatchObject({
        kind: 'repository',
        rootPath: await realpath(directory),
      });
    } finally {
      await runtime.dispose();
    }
  });

  it('can clone a repository and return its inspected identity', async () => {
    const source = await makeRepo();
    await writeFile(path.join(source, 'README.md'), '# Test\n', 'utf8');
    await execFileAsync('git', ['add', 'README.md'], { cwd: source });
    await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: source });

    const parent = await mkdtemp(path.join(tmpdir(), 'emdash-shared-runtime-clone-'));
    const target = path.join(parent, 'repo');
    const runtime = new GitRuntime();

    try {
      const result = await runtime.cloneRepository(source, target);

      expect(result).toMatchObject({
        success: true,
        data: {
          kind: 'repository',
          rootPath: await realpath(target),
          baseRef: 'origin/main',
        },
      });
    } finally {
      await runtime.dispose();
    }
  });

  it('deduplicates repositories by common git dir and releases them by lease', async () => {
    const repo = await makeRepo();
    const linked = await mkdtemp(path.join(tmpdir(), 'emdash-shared-runtime-linked-'));
    await execFileAsync('git', ['worktree', 'add', linked, '-b', 'feature'], { cwd: repo });

    const watcher = createNoopWatcher();
    const runtime = new GitRuntime({ watcher });
    try {
      const repoLease = await runtime.openRepository(repo);
      const worktreeLease = await runtime.openWorktree(linked);
      const commonDir = await realpath(path.join(repo, '.git'));

      expect(repoLease.value.gitCommonDir).toBe(commonDir);
      expect(worktreeLease.value.repository).toBe(repoLease.value);

      worktreeLease.release();
      repoLease.release();
    } finally {
      await runtime.dispose();
      await watcher.dispose();
    }
  });

  it('resolves git identity once when opening a cold worktree', async () => {
    const repo = await makeRepo();
    const { executable, logPath } = await makeRecordingGitExecutable();
    const runtime = new GitRuntime({ executable, watcher: createNoopWatcher() });

    try {
      const lease = await runtime.openWorktree(repo);
      lease.release();
    } finally {
      await runtime.dispose();
    }

    const calls = (await readFile(logPath, 'utf8')).trim().split('\n').filter(Boolean);
    expect(calls.filter((call) => call.startsWith('rev-parse '))).toHaveLength(4);
  });
});
