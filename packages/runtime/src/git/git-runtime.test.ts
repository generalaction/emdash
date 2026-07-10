import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { ExecError, type BoundExec } from '@emdash/core/exec';
import { gitContract } from '@emdash/core/git';
import type { IWatchService } from '@emdash/core/services/fs-watch/api';
import { describe, expect, it } from 'vitest';
import { createGitExec } from './exec/git-exec';
import { GitRuntime } from './index';

const execFileAsync = promisify(execFile);

async function makeRepo(): Promise<string> {
  const repo = await mkdtemp(path.join(tmpdir(), 'emdash-shared-runtime-'));
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: repo });
  await writeFile(path.join(repo, 'INITIAL.md'), '# Initial\n', 'utf8');
  await execFileAsync('git', ['add', 'INITIAL.md'], { cwd: repo });
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: repo });
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createNoopWatcher(): IWatchService {
  return {
    watch: () => ({
      ready: async () => {},
      release: async () => {},
    }),
    dispose: async () => {},
  };
}

function createFailingExec(error: unknown): BoundExec {
  return {
    file: 'git',
    cwd: '/',
    async exec() {
      throw error;
    },
    async execStreaming() {
      throw error;
    },
    async execBuffer() {
      throw error;
    },
    spawn() {
      throw error;
    },
    withCwd() {
      return this;
    },
  };
}

describe('GitRuntime', () => {
  it('owns the live-model hosts served by the standard Git contract', async () => {
    const runtime = new GitRuntime({ watcher: createNoopWatcher() });

    try {
      expect(runtime.repository.model.contract.id).toBe(gitContract.repository.model.id);
      expect(runtime.checkout.model.contract.id).toBe(gitContract.checkout.model.id);
      expect(runtime.checkout.fileDiffModel.contract.id).toBe(gitContract.checkout.fileDiff.id);
    } finally {
      await runtime.dispose();
    }
  });

  it('inspects repository and non-repository paths without opening live models', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'emdash-shared-runtime-plain-'));
    const repo = await makeRepo();
    const runtime = new GitRuntime();

    try {
      await expect(runtime.provisioning.inspectPath(directory)).resolves.toEqual({
        kind: 'not-repository',
        path: directory,
      });
      await expect(runtime.provisioning.inspectPath(repo)).resolves.toMatchObject({
        kind: 'repository',
        rootPath: await realpath(repo),
        baseRef: 'main',
      });
    } finally {
      await runtime.dispose();
    }
  });

  it('inspects paths with git -C instead of spawning inside the target directory', async () => {
    const repo = await makeRepo();
    const { executable, logPath } = await makeRecordingGitExecutable();
    const runtime = new GitRuntime({ executable });

    try {
      await expect(runtime.provisioning.inspectPath(repo)).resolves.toMatchObject({
        kind: 'repository',
        rootPath: await realpath(repo),
      });
    } finally {
      await runtime.dispose();
    }

    const calls = (await readFile(logPath, 'utf8')).trim().split('\n').filter(Boolean);
    expect(calls[0]).toBe(`-C ${repo} rev-parse --is-inside-work-tree`);
  });

  it('does not classify git inspection failures as non-repositories', async () => {
    const targetPath = '/Volumes/Data/dev/myapp';
    const error = new ExecError(
      'git',
      ['-C', targetPath, 'rev-parse', '--is-inside-work-tree'],
      128,
      '',
      `fatal: cannot change to '${targetPath}': Permission denied`
    );
    const runtime = new GitRuntime({
      exec: createFailingExec(error),
      watcher: createNoopWatcher(),
    });

    try {
      await expect(runtime.provisioning.inspectPath(targetPath)).resolves.toEqual({
        kind: 'inspect-failed',
        path: targetPath,
        message: `fatal: cannot change to '${targetPath}': Permission denied`,
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
      await expect(runtime.provisioning.inspectPath(directory)).resolves.toEqual({
        kind: 'not-repository',
        path: directory,
      });
    } finally {
      await runtime.dispose();
    }
  });

  it('returns selector resolution failures through the declared result channel', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'emdash-shared-runtime-non-repo-'));
    const runtime = new GitRuntime({ watcher: createNoopWatcher() });

    try {
      await expect(
        runtime.checkout.getLog({ checkout: { path: directory }, options: { limit: 1 } })
      ).resolves.toMatchObject({
        success: false,
        error: { type: 'resolution_failed', path: directory },
      });
    } finally {
      await runtime.dispose();
    }
  });

  it('keeps unexpected resource construction failures thrown', async () => {
    const repo = await makeRepo();
    const failure = new TypeError('watch construction bug');
    const watcher: IWatchService = {
      watch: () => {
        throw failure;
      },
      dispose: async () => {},
    };
    const runtime = new GitRuntime({ watcher });

    try {
      await expect(
        runtime.checkout.getLog({ checkout: { path: repo }, options: { limit: 1 } })
      ).rejects.toBe(failure);
    } finally {
      await runtime.dispose();
    }
  });

  it('can initialize a missing repository when explicitly requested', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'emdash-shared-runtime-init-'));
    const runtime = new GitRuntime();

    try {
      await expect(runtime.provisioning.ensureRepository(directory)).resolves.toEqual({
        success: false,
        error: { type: 'not-repository', path: directory },
      });

      const ensured = await runtime.provisioning.ensureRepository(directory, {
        initIfMissing: true,
      });

      expect(ensured).toMatchObject({
        success: true,
        data: {
          kind: 'repository',
          rootPath: await realpath(directory),
        },
      });
      await expect(runtime.provisioning.inspectPath(directory)).resolves.toMatchObject({
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
      const result = await runtime.provisioning.cloneRepository(source, target);

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

  it('deduplicates repositories by common git dir across linked checkout leases', async () => {
    const repo = await makeRepo();
    const linked = await mkdtemp(path.join(tmpdir(), 'emdash-shared-runtime-linked-'));
    await execFileAsync('git', ['worktree', 'add', linked, '-b', 'feature'], { cwd: repo });

    const watcher = createNoopWatcher();
    const runtime = new GitRuntime({ watcher });
    try {
      const mainRepositoryLease = runtime.repository.model.acquireState(
        { repository: { path: repo } },
        'refs'
      );
      const linkedRepositoryLease = runtime.repository.model.acquireState(
        { repository: { path: linked } },
        'refs'
      );
      const linkedCheckoutLease = runtime.checkout.model.acquireState(
        { checkout: { path: linked } },
        'head'
      );
      const [mainRepository, linkedRepository] = await Promise.all([
        mainRepositoryLease.ready(),
        linkedRepositoryLease.ready(),
        linkedCheckoutLease.ready(),
      ]);

      expect(linkedRepository).toBe(mainRepository);

      await linkedCheckoutLease.release();
      await linkedRepositoryLease.release();
      await mainRepositoryLease.release();
    } finally {
      await runtime.dispose();
      await watcher.dispose();
    }
  });

  it('targets repository reads independently of the runtime cwd', async () => {
    const target = await makeRepo();
    const runtimeCwd = await makeRepo();
    await writeFile(path.join(target, 'INITIAL.md'), '# Target\n', 'utf8');
    await execFileAsync('git', ['commit', '-am', 'target content'], { cwd: target });
    await writeFile(path.join(runtimeCwd, 'INITIAL.md'), '# Other\n', 'utf8');
    await execFileAsync('git', ['commit', '-am', 'other content'], { cwd: runtimeCwd });
    const runtime = new GitRuntime({
      exec: createGitExec({ cwd: runtimeCwd }),
      watcher: createNoopWatcher(),
    });

    try {
      await expect(
        runtime.repository.readBlobAtRef({
          repository: { path: target },
          ref: 'HEAD',
          filePath: 'INITIAL.md',
        })
      ).resolves.toEqual({ success: true, data: '# Target\n' });
    } finally {
      await runtime.dispose();
      await rm(target, { recursive: true, force: true });
      await rm(runtimeCwd, { recursive: true, force: true });
    }
  });

  it('uses the configured executable for persistent repository reads', async () => {
    const repo = await makeRepo();
    const gitDir = await realpath(path.join(repo, '.git'));
    const { executable, logPath } = await makeRecordingGitExecutable();
    const runtime = new GitRuntime({ executable, watcher: createNoopWatcher() });

    try {
      await expect(
        runtime.repository.readBlobAtRef({
          repository: { path: repo },
          ref: 'HEAD',
          filePath: 'INITIAL.md',
        })
      ).resolves.toEqual({ success: true, data: '# Initial\n' });
      await runtime.dispose();

      const calls = (await readFile(logPath, 'utf8')).trim().split('\n').filter(Boolean);
      expect(calls).toContain(`--git-dir=${gitDir} cat-file --batch`);
    } finally {
      await runtime.dispose();
      await rm(repo, { recursive: true, force: true });
      await rm(path.dirname(executable), { recursive: true, force: true });
    }
  });

  it('waits for repository watcher release during dispose', async () => {
    const repo = await makeRepo();
    const releaseGate = deferred<void>();
    let releaseStarted = 0;
    const watcher: IWatchService = {
      watch: () => ({
        ready: async () => {},
        release: async () => {
          releaseStarted += 1;
          await releaseGate.promise;
        },
      }),
      dispose: async () => {},
    };
    const runtime = new GitRuntime({ watcher });

    const lease = runtime.repository.model.acquireState({ repository: { path: repo } }, 'refs');
    await lease.ready();

    const dispose = runtime.dispose();
    let disposed = false;
    void dispose.then(() => {
      disposed = true;
    });

    await new Promise((resolve) => setImmediate(resolve));
    expect(releaseStarted).toBe(1);
    expect(disposed).toBe(false);

    releaseGate.resolve();
    await dispose;
    await lease.release();
    expect(disposed).toBe(true);
  });

  it('resolves git identity once when opening a cold checkout', async () => {
    const repo = await makeRepo();
    const { executable, logPath } = await makeRecordingGitExecutable();
    const runtime = new GitRuntime({ executable, watcher: createNoopWatcher() });

    try {
      const lease = runtime.checkout.model.acquireState({ checkout: { path: repo } }, 'head');
      await lease.ready();
      await lease.release();
    } finally {
      await runtime.dispose();
    }

    const calls = (await readFile(logPath, 'utf8')).trim().split('\n').filter(Boolean);
    // Identity resolution (toplevel + 3 path lookups) runs once, shared by the
    // repository and checkout constructions.
    expect(calls.filter((call) => call.startsWith('rev-parse --show-toplevel'))).toHaveLength(1);
    expect(
      calls.filter((call) => call.startsWith('rev-parse --path-format=absolute'))
    ).toHaveLength(3);
  });
});
