import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { GitWorktreeUpdate } from '@emdash/core/git';
import { afterEach, describe, expect, it } from 'vitest';
import { FALLBACK_REMOTE_SHELL_PROFILE } from '@main/core/ssh/lifecycle/remote-shell-profile';
import { invalidateLegacySshGitWorktreeStatus, LegacySshGitRuntime } from './ssh-git';

const TEST_CONNECTION_ID = 'test-ssh-connection';

const execFileAsync = promisify(execFile);

class LocalChannel extends EventEmitter {
  readonly stderr = new EventEmitter();
  private child: ChildProcessWithoutNullStreams | null = null;

  attach(child: ChildProcessWithoutNullStreams): void {
    this.child = child;
    child.stdout.on('data', (chunk) => this.emit('data', chunk));
    child.stderr.on('data', (chunk) => this.stderr.emit('data', chunk));
    child.on('close', (code) => this.emit('close', code));
    child.on('error', (error) => this.emit('error', error));
  }

  setEncoding(_encoding: BufferEncoding): void {}

  destroy(): void {
    this.child?.kill();
    this.emit('close', 1);
  }
}

const localSshProxy = {
  getRemoteShellProfile: async () => FALLBACK_REMOTE_SHELL_PROFILE,
  refreshRemoteShellProfile: async () => FALLBACK_REMOTE_SHELL_PROFILE,
  exec(command: string, callback: (error: Error | undefined, channel: LocalChannel) => void) {
    const channel = new LocalChannel();
    const child = spawn('/bin/sh', ['-lc', command]);
    channel.attach(child);
    callback(undefined, channel);
  },
};

async function eventually<T>(
  read: () => T | undefined,
  timeoutMs = 2_000,
  intervalMs = 25
): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Timed out waiting for condition');
}

async function createRepo(): Promise<string> {
  const repo = await mkdtemp(path.join(tmpdir(), 'emdash-ssh-git-'));
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  await writeFile(path.join(repo, 'tracked.ts'), 'tracked\n', 'utf8');
  await execFileAsync('git', ['add', 'tracked.ts'], { cwd: repo });
  await execFileAsync('git', ['commit', '-m', 'init'], { cwd: repo });
  return repo;
}

describe('LegacySshGitRuntime', () => {
  const repos: string[] = [];

  afterEach(async () => {
    await Promise.all(repos.map((repo) => rm(repo, { recursive: true, force: true })));
    repos.length = 0;
  });

  it('refreshes status when the SSH file-change feed invalidates it', async () => {
    const repo = await createRepo();
    repos.push(repo);
    const runtime = new LegacySshGitRuntime(localSshProxy as never, TEST_CONNECTION_ID);
    const lease = await runtime.openWorktree(repo);
    const worktree = lease.value;
    const updates: GitWorktreeUpdate[] = [];

    try {
      await expect(worktree.getStatus()).resolves.toMatchObject({ kind: 'ok', unstaged: [] });
      const unsubscribe = worktree.subscribe((update) => updates.push(update));

      await writeFile(path.join(repo, 'test.ts'), 'test\n', 'utf8');
      expect(invalidateLegacySshGitWorktreeStatus(worktree)).toBe(true);

      await eventually(() =>
        updates.some(
          (update) =>
            update.kind === 'status' &&
            update.model.kind === 'ok' &&
            update.model.unstaged.some((change) => change.path === path.posix.join(repo, 'test.ts'))
        )
          ? true
          : undefined
      );

      unsubscribe();
    } finally {
      await lease.release();
      await runtime.dispose();
    }
  });

  it('does not accept the first untracked fingerprint poll as a stale baseline', async () => {
    const repo = await createRepo();
    repos.push(repo);
    const runtime = new LegacySshGitRuntime(localSshProxy as never, TEST_CONNECTION_ID);
    const lease = await runtime.openWorktree(repo);
    const worktree = lease.value;
    const updates: GitWorktreeUpdate[] = [];

    try {
      await expect(worktree.getStatus()).resolves.toMatchObject({ kind: 'ok', unstaged: [] });
      const unsubscribe = worktree.subscribe((update) => updates.push(update));

      await writeFile(path.join(repo, 'test.ts'), 'test\n', 'utf8');
      await (
        worktree as unknown as { pollStatus(untracked: 'normal' | 'no'): Promise<void> }
      ).pollStatus('normal');

      await eventually(() =>
        updates.some(
          (update) =>
            update.kind === 'status' &&
            update.model.kind === 'ok' &&
            update.model.unstaged.some((change) => change.path === path.posix.join(repo, 'test.ts'))
        )
          ? true
          : undefined
      );

      unsubscribe();
    } finally {
      await lease.release();
      await runtime.dispose();
    }
  });
});
