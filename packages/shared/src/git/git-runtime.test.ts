import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { FileWatchService } from '../fs';
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

describe('GitRuntime', () => {
  it('deduplicates repositories by common git dir and releases them by lease', async () => {
    const repo = await makeRepo();
    const linked = await mkdtemp(path.join(tmpdir(), 'emdash-shared-runtime-linked-'));
    await execFileAsync('git', ['worktree', 'add', linked, '-b', 'feature'], { cwd: repo });

    const watch = new FileWatchService();
    const runtime = new GitRuntime({ watch });
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
      await watch.dispose();
    }
  });

  it('resolves git identity once when opening a cold worktree', async () => {
    const repo = await makeRepo();
    const { executable, logPath } = await makeRecordingGitExecutable();
    const runtime = new GitRuntime({ executable });

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
