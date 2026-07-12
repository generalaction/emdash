import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import nodePath from 'node:path';
import { contains, FilesRuntime, type IFileSystem } from '@emdash/core/files';
import type { GitRemote } from '@emdash/core/git';
import { err, ok, type Result } from '@emdash/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { IFilesRuntime, RuntimePath } from '@main/core/runtime/types';
import type { ProjectSettingsProvider } from '../settings/provider';
import { WorktreeService } from './worktree-service';

async function git(
  args: string[],
  opts: { cwd: string }
): Promise<{ stdout: string; stderr: string }> {
  const ctx = new LocalExecutionContext({ root: opts.cwd });
  return ctx.exec('git', args);
}

async function initRepo(dir: string): Promise<void> {
  await git(['init'], { cwd: dir });
  await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: dir });
  await git(['config', 'user.email', 'test@test.com'], { cwd: dir });
  await git(['config', 'user.name', 'Test'], { cwd: dir });
  await git(['commit', '--allow-empty', '-m', 'init'], { cwd: dir });
}

function deferred<T = void>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function makeSettings(preservePatterns: string[] = []): ProjectSettingsProvider {
  return {
    get: async () => ({ preservePatterns }),
    update: async () => ok(),
    patch: async () => ok(),
    ensure: async () => {},
    getDefaultWorktreeDirectory: async () => '',
    getWorktreeDirectory: async () => '',
    getDefaultBranch: async () => 'main',
    getBaseRemote: async () => 'origin',
    getPushRemote: async () => 'origin',
  } as ProjectSettingsProvider;
}

const originRemote = (url = 'ssh://example.com/repo.git'): GitRemote => ({ name: 'origin', url });

type FakeFilesRuntimeOptions = {
  pathApi?: RuntimePath;
  existsAbsolute?: (absPath: string) => Promise<boolean>;
  existsAbsoluteResult?: (
    absPath: string
  ) => Promise<Result<boolean, { type: 'fs-error'; path: string; message: string }>>;
  mkdirAbsolute?: (absPath: string, options?: { recursive?: boolean }) => Promise<void>;
  removeAbsolute?: (
    absPath: string,
    options?: { recursive?: boolean }
  ) => Promise<Result<void, { message: string }>>;
  realPathAbsolute?: (absPath: string) => Promise<string>;
};

function makeFakeFilesRuntime(options: FakeFilesRuntimeOptions = {}): IFilesRuntime {
  const pathApi = options.pathApi ?? nativeMachinePath;
  return {
    path: pathApi,
    openTree: vi.fn(),
    watchChanges: vi.fn(),
    fileSystem: vi.fn(() =>
      ok({
        exists: async (absPath: string) =>
          options.existsAbsoluteResult
            ? options.existsAbsoluteResult(absPath)
            : ok(await (options.existsAbsolute?.(absPath) ?? false)),
        mkdir: async (absPath: string, mkdirOptions?: { recursive?: boolean }) => {
          await options.mkdirAbsolute?.(absPath, mkdirOptions);
          return ok();
        },
        remove: async (absPath: string, removeOptions?: { recursive?: boolean }) => {
          const result = (await options.removeAbsolute?.(absPath, removeOptions)) ?? ok();
          return result.success
            ? ok()
            : err({
                type: 'fs-error' as const,
                path: absPath,
                message: result.error.message,
              });
        },
        realPath: async (absPath: string) =>
          ok(await (options.realPathAbsolute?.(absPath) ?? absPath)),
        stat: async () =>
          err({
            type: 'fs-error' as const,
            path: '',
            message: 'stat is not implemented by test fake',
            code: 'ENOENT',
          }),
        glob: () =>
          ok(
            (async function* () {
              // No preserved files in fake-runtime unit cases.
            })()
          ),
      } as unknown as IFileSystem)
    ),
    dispose: vi.fn(),
  } as unknown as IFilesRuntime;
}

const nativeMachinePath: RuntimePath = {
  join: (...parts: string[]) => nodePath.join(...parts),
  dirname: (value: string) => nodePath.dirname(value),
  basename: (value: string) => nodePath.basename(value),
  isAbsolute: (value: string) => nodePath.isAbsolute(value),
  relative: (from: string, to: string) => nodePath.relative(from, to),
  contains,
};

describe('WorktreeService', () => {
  let repoDir: string;
  let poolDir: string;

  beforeEach(async () => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-repo-'));
    poolDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-pool-'));
    await initRepo(repoDir);
  }, 30_000);

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
    fs.rmSync(poolDir, { recursive: true, force: true });
  });

  function makeService(
    overrides: Partial<{
      worktreePoolPath: string;
      resolveWorktreePoolPath: () => Promise<string>;
      repoPath: string;
      projectSettings: ProjectSettingsProvider;
    }> = {}
  ): WorktreeService {
    const repoPath = overrides.repoPath ?? repoDir;
    const worktreePoolPath = overrides.worktreePoolPath ?? poolDir;
    return new WorktreeService({
      repoPath,
      ctx: new LocalExecutionContext({ root: repoPath }),
      files: Object.assign(new FilesRuntime(), { path: nativeMachinePath }),
      projectSettings: overrides.projectSettings ?? makeSettings(),
      resolveWorktreePoolPath: overrides.resolveWorktreePoolPath ?? (async () => worktreePoolPath),
    });
  }

  function makeServiceWithFileSystemOverride(
    projectSettings: ProjectSettingsProvider,
    overrides: Partial<Pick<IFileSystem, 'glob' | 'copyFile'>>,
    ctx: IExecutionContext = new LocalExecutionContext({ root: repoDir })
  ): WorktreeService {
    const runtime = Object.assign(new FilesRuntime(), { path: nativeMachinePath });
    const opened = runtime.fileSystem();
    if (!opened.success) throw new Error('expected local file system');
    const fileSystem = new Proxy(opened.data, {
      get(target, property, receiver) {
        const overridden = overrides[property as keyof typeof overrides];
        if (overridden) return overridden;
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as IFileSystem;
    const files = Object.assign(runtime, { fileSystem: () => ok(fileSystem) });
    return new WorktreeService({
      repoPath: repoDir,
      ctx,
      files,
      projectSettings,
      resolveWorktreePoolPath: async () => poolDir,
    });
  }

  describe('createWorktreeAtCommit', () => {
    it('retains ambiguous ownership until an ignored late worktree add quiesces', async () => {
      const commit = (await git(['rev-parse', 'HEAD'], { cwd: repoDir })).stdout.trim();
      const branch = 'emdash/loop-held-add';
      const targetPath = path.join(poolDir, branch);
      const delegate = new LocalExecutionContext({ root: repoDir });
      let deadlineAt = Date.now() + 60_000;
      let releaseAdd: (() => void) | undefined;
      const addGate = new Promise<void>((resolve) => {
        releaseAdd = resolve;
      });
      let markAddStarted: (() => void) | undefined;
      const addStarted = new Promise<void>((resolve) => {
        markAddStarted = resolve;
      });
      const ctx: IExecutionContext = {
        root: repoDir,
        supportsLocalSpawn: true,
        exec: async (command, args = [], options) => {
          if (args[0] === 'worktree' && args[1] === 'add') {
            deadlineAt = Date.now() + 50;
            markAddStarted?.();
            await addGate;
            return delegate.exec(command, args, {
              ...options,
              signal: undefined,
              timeout: 120_000,
            });
          }
          return delegate.exec(command, args, options);
        },
        execStreaming: (command, args, onChunk, options) =>
          delegate.execStreaming(command, args, onChunk, options),
        dispose: () => delegate.dispose(),
      };
      const service = new WorktreeService({
        repoPath: repoDir,
        ctx,
        files: Object.assign(new FilesRuntime(), { path: nativeMachinePath }),
        projectSettings: makeSettings(),
        resolveWorktreePoolPath: async () => poolDir,
      });

      const creating = service.createWorktreeAtCommit(commit, branch, {
        get deadlineAt() {
          return deadlineAt;
        },
        expectedTargetPath: targetPath,
      });
      await addStarted;

      await expect(creating).resolves.toMatchObject({
        success: false,
        error: { type: 'worktree-rollback-incomplete' },
      });
      await expect(
        service.removeGeneratedWorktreeIfPresent(targetPath, {
          expectedBranchName: branch,
          expectedHead: commit,
        })
      ).resolves.toMatchObject({ success: false, error: { type: 'worktree-remove-failed' } });

      releaseAdd?.();
      await service.waitForGeneratedWorktreeOperations(targetPath);
      await expect(
        service.removeGeneratedWorktreeIfPresent(targetPath, {
          expectedBranchName: branch,
          expectedHead: commit,
        })
      ).resolves.toEqual(ok({ removed: true }));
      expect(fs.existsSync(targetPath)).toBe(false);
    }, 15_000);

    it('rejects resolver drift against the frozen target before worktree mutation', async () => {
      const commit = (await git(['rev-parse', 'HEAD'], { cwd: repoDir })).stdout.trim();
      const poolA = path.join(poolDir, 'a');
      const poolB = path.join(poolDir, 'b');
      let currentPool = poolA;
      const service = makeService({ resolveWorktreePoolPath: async () => currentPool });
      const branch = 'emdash/loop-frozen-target';
      const resolved = await service.resolveGeneratedWorktreePath(branch);
      if (!resolved.success) throw new Error('expected frozen target');
      currentPool = poolB;

      const result = await service.createWorktreeAtCommit(commit, branch, {
        expectedTargetPath: resolved.data,
      });

      expect(result).toMatchObject({
        success: false,
        error: { type: 'worktree-setup-failed' },
      });
      expect(fs.existsSync(path.join(poolB, branch))).toBe(false);
      await expect(
        git(['show-ref', '--verify', `refs/heads/${branch}`], { cwd: repoDir })
      ).rejects.toBeDefined();
    });

    it('preserves a competing actor worktree created at the add boundary', async () => {
      const commit = (await git(['rev-parse', 'HEAD'], { cwd: repoDir })).stdout.trim();
      const branch = 'emdash/loop-competing-actor';
      const targetPath = path.join(poolDir, branch);
      const delegate = new LocalExecutionContext({ root: repoDir });
      let injectActor = true;
      const ctx: IExecutionContext = {
        root: repoDir,
        supportsLocalSpawn: true,
        exec: async (command, args = [], options) => {
          if (injectActor && args[0] === 'worktree' && args[1] === 'add') {
            injectActor = false;
            await delegate.exec(command, args, options);
            fs.writeFileSync(path.join(targetPath, 'actor.txt'), 'actor bytes');
            throw new Error('original add lost to competing actor');
          }
          return delegate.exec(command, args, options);
        },
        execStreaming: (command, args, onChunk, options) =>
          delegate.execStreaming(command, args, onChunk, options),
        dispose: () => delegate.dispose(),
      };
      const service = new WorktreeService({
        repoPath: repoDir,
        ctx,
        files: Object.assign(new FilesRuntime(), { path: nativeMachinePath }),
        projectSettings: makeSettings(),
        resolveWorktreePoolPath: async () => poolDir,
      });

      const result = await service.createWorktreeAtCommit(commit, branch, {
        expectedTargetPath: targetPath,
      });

      expect(result).toMatchObject({
        success: false,
        error: { type: 'worktree-rollback-incomplete' },
      });
      expect(await git(['rev-parse', `refs/heads/${branch}`], { cwd: repoDir })).toMatchObject({
        stdout: `${commit}\n`,
      });
      expect(await git(['rev-parse', 'HEAD'], { cwd: targetPath })).toMatchObject({
        stdout: `${commit}\n`,
      });
      expect(fs.readFileSync(path.join(targetPath, 'actor.txt'), 'utf8')).toBe('actor bytes');
    });

    it('rejects a symlinked branch parent that escapes the generated pool', async () => {
      const commit = (await git(['rev-parse', 'HEAD'], { cwd: repoDir })).stdout.trim();
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-outside-'));
      fs.symlinkSync(outside, path.join(poolDir, 'emdash'), 'dir');
      const branch = 'emdash/loop-symlink-parent';
      const service = makeService();

      try {
        const result = await service.createWorktreeAtCommit(commit, branch, {
          expectedTargetPath: path.join(poolDir, branch),
        });

        expect(result).toMatchObject({
          success: false,
          error: { type: 'worktree-setup-failed' },
        });
        expect(fs.existsSync(path.join(outside, 'loop-symlink-parent'))).toBe(false);
        await expect(
          git(['show-ref', '--verify', `refs/heads/${branch}`], { cwd: repoDir })
        ).rejects.toBeDefined();
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });

    it('returns a typed failure when the pool resolver rejects', async () => {
      const commit = (await git(['rev-parse', 'HEAD'], { cwd: repoDir })).stdout.trim();
      const service = makeService({
        resolveWorktreePoolPath: async () => {
          throw new Error('settings unavailable');
        },
      });

      await expect(
        service.createWorktreeAtCommit(commit, 'emdash/loop-resolver-rejects')
      ).resolves.toMatchObject({
        success: false,
        error: { type: 'worktree-setup-failed' },
      });
    });

    it('settles cancellation while the pool resolver is held without Git mutation', async () => {
      const commit = 'a'.repeat(40);
      const controller = new AbortController();
      let resolverStarted: (() => void) | undefined;
      const started = new Promise<void>((resolve) => {
        resolverStarted = resolve;
      });
      const exec = vi.fn(async () => ({ stdout: '', stderr: '' }));
      const service = new WorktreeService({
        repoPath: repoDir,
        ctx: {
          root: repoDir,
          supportsLocalSpawn: true,
          exec,
          execStreaming: async () => {},
          dispose: () => {},
        },
        files: makeFakeFilesRuntime(),
        projectSettings: makeSettings(),
        resolveWorktreePoolPath: () => {
          resolverStarted?.();
          return new Promise<string>(() => {});
        },
      });
      exec.mockClear();

      const creating = service.createWorktreeAtCommit(commit, 'emdash/loop-held-resolver', {
        signal: controller.signal,
      });
      await started;
      controller.abort();

      await expect(creating).resolves.toMatchObject({
        success: false,
        error: { type: 'cancelled' },
      });
      expect(exec).not.toHaveBeenCalled();
    });

    it('settles deadline while pool directory creation is held without worktree mutation', async () => {
      const commit = 'a'.repeat(40);
      let mkdirStarted: (() => void) | undefined;
      const started = new Promise<void>((resolve) => {
        mkdirStarted = resolve;
      });
      const exec = vi.fn(async () => ({ stdout: '', stderr: '' }));
      const service = new WorktreeService({
        repoPath: repoDir,
        ctx: {
          root: repoDir,
          supportsLocalSpawn: true,
          exec,
          execStreaming: async () => {},
          dispose: () => {},
        },
        files: makeFakeFilesRuntime({
          mkdirAbsolute: () => {
            mkdirStarted?.();
            return new Promise<void>(() => {});
          },
        }),
        projectSettings: makeSettings(),
        resolveWorktreePoolPath: async () => poolDir,
      });
      exec.mockClear();

      const creating = service.createWorktreeAtCommit(commit, 'emdash/loop-held-mkdir', {
        deadlineAt: Date.now() + 25,
      });
      await started;

      await expect(creating).resolves.toMatchObject({
        success: false,
        error: { type: 'deadline-exceeded' },
      });
      expect(exec).not.toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['worktree', 'add']),
        expect.anything()
      );
    });

    it('settles deadline while nested branch-parent creation is held without worktree mutation', async () => {
      const commit = 'a'.repeat(40);
      let deadlineAt = Date.now() + 60_000;
      let mkdirCalls = 0;
      let nestedMkdirStarted: (() => void) | undefined;
      const started = new Promise<void>((resolve) => {
        nestedMkdirStarted = resolve;
      });
      const exec = vi.fn(async () => ({ stdout: '', stderr: '' }));
      const service = new WorktreeService({
        repoPath: repoDir,
        ctx: {
          root: repoDir,
          supportsLocalSpawn: true,
          exec,
          execStreaming: async () => {},
          dispose: () => {},
        },
        files: makeFakeFilesRuntime({
          mkdirAbsolute: () => {
            mkdirCalls += 1;
            if (mkdirCalls === 2) {
              deadlineAt = Date.now() + 25;
              nestedMkdirStarted?.();
              return new Promise<void>(() => {});
            }
            return Promise.resolve();
          },
        }),
        projectSettings: makeSettings(),
        resolveWorktreePoolPath: async () => poolDir,
      });
      exec.mockClear();

      const creating = service.createWorktreeAtCommit(commit, 'emdash/loop-held-nested-mkdir', {
        get deadlineAt() {
          return deadlineAt;
        },
      });
      await started;

      await expect(creating).resolves.toMatchObject({
        success: false,
        error: { type: 'deadline-exceeded' },
      });
      expect(mkdirCalls).toBe(2);
      expect(exec).not.toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['worktree', 'add']),
        expect.anything()
      );
    }, 15_000);

    it('does not remove a stale path when cancellation lands during its validity probe', async () => {
      const commit = 'a'.repeat(40);
      const branch = 'emdash/loop-cancel-stale-probe';
      const targetPath = path.join(poolDir, branch);
      const controller = new AbortController();
      let releaseProbe: ((value: { stdout: string; stderr: string }) => void) | undefined;
      let markProbeStarted: (() => void) | undefined;
      const probeStarted = new Promise<void>((resolve) => {
        markProbeStarted = resolve;
      });
      const removeAbsolute = vi.fn(async () => ok<void>());
      const exec = vi.fn(async (_command: string, args: string[] = []) => {
        if (args[0] === '-C' && args[1] === targetPath && args[2] === 'rev-parse') {
          return new Promise<{ stdout: string; stderr: string }>((resolve) => {
            releaseProbe = resolve;
            markProbeStarted?.();
          });
        }
        return { stdout: '', stderr: '' };
      });
      const service = new WorktreeService({
        repoPath: repoDir,
        ctx: {
          root: repoDir,
          supportsLocalSpawn: true,
          exec,
          execStreaming: async () => {},
          dispose: () => {},
        },
        files: makeFakeFilesRuntime({
          existsAbsolute: async (candidate) =>
            candidate === targetPath || candidate === path.join(targetPath, '.git'),
          removeAbsolute,
          realPathAbsolute: async (candidate) => candidate,
        }),
        projectSettings: makeSettings(),
        resolveWorktreePoolPath: async () => poolDir,
      });

      const creating = service.createWorktreeAtCommit(commit, branch, {
        signal: controller.signal,
        expectedTargetPath: targetPath,
      });
      await probeStarted;
      controller.abort();
      releaseProbe?.({ stdout: 'false\n', stderr: '' });
      await expect(creating).resolves.toMatchObject({
        success: false,
        error: { type: 'cancelled' },
      });
      expect(removeAbsolute).not.toHaveBeenCalled();
      expect(exec).not.toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['worktree', 'add']),
        expect.anything()
      );
    });

    it('does not remove a stale path when the deadline expires during its validity probe', async () => {
      const commit = 'a'.repeat(40);
      const branch = 'emdash/loop-deadline-stale-probe';
      const targetPath = path.join(poolDir, branch);
      const deadlineAt = Date.now() + 60_000;
      let releaseProbe: ((value: { stdout: string; stderr: string }) => void) | undefined;
      let markProbeStarted: (() => void) | undefined;
      const probeStarted = new Promise<void>((resolve) => {
        markProbeStarted = resolve;
      });
      const removeAbsolute = vi.fn(async () => ok<void>());
      const exec = vi.fn(async (_command: string, args: string[] = []) => {
        if (args[0] === '-C' && args[1] === targetPath && args[2] === 'rev-parse') {
          return new Promise<{ stdout: string; stderr: string }>((resolve) => {
            releaseProbe = resolve;
            markProbeStarted?.();
          });
        }
        return { stdout: '', stderr: '' };
      });
      const service = new WorktreeService({
        repoPath: repoDir,
        ctx: {
          root: repoDir,
          supportsLocalSpawn: true,
          exec,
          execStreaming: async () => {},
          dispose: () => {},
        },
        files: makeFakeFilesRuntime({
          existsAbsolute: async (candidate) =>
            candidate === targetPath || candidate === path.join(targetPath, '.git'),
          removeAbsolute,
          realPathAbsolute: async (candidate) => candidate,
        }),
        projectSettings: makeSettings(),
        resolveWorktreePoolPath: async () => poolDir,
      });

      const creating = service.createWorktreeAtCommit(commit, branch, {
        deadlineAt,
        expectedTargetPath: targetPath,
      });
      await probeStarted;
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(deadlineAt + 1);
      releaseProbe?.({ stdout: 'false\n', stderr: '' });
      try {
        await expect(creating).resolves.toMatchObject({
          success: false,
          error: { type: 'deadline-exceeded' },
        });
      } finally {
        nowSpy.mockRestore();
      }
      expect(removeAbsolute).not.toHaveBeenCalled();
    });

    it('requires post-create generated path and ref attestation', async () => {
      const commit = (await git(['rev-parse', 'HEAD'], { cwd: repoDir })).stdout.trim();
      const branch = 'emdash/loop-post-attestation';
      const targetPath = path.join(poolDir, branch);
      const delegate = new LocalExecutionContext({ root: repoDir });
      let worktreeAdded = false;
      const ctx: IExecutionContext = {
        root: repoDir,
        supportsLocalSpawn: true,
        exec: async (command, args = [], options) => {
          const result = await delegate.exec(command, args, options);
          if (args[0] === 'worktree' && args[1] === 'add') worktreeAdded = true;
          if (worktreeAdded && args[0] === 'worktree' && args[1] === 'list') {
            return { stdout: '', stderr: '' };
          }
          return result;
        },
        execStreaming: (command, args, onChunk, options) =>
          delegate.execStreaming(command, args, onChunk, options),
        dispose: () => delegate.dispose(),
      };
      const service = new WorktreeService({
        repoPath: repoDir,
        ctx,
        files: Object.assign(new FilesRuntime(), { path: nativeMachinePath }),
        projectSettings: makeSettings(),
        resolveWorktreePoolPath: async () => poolDir,
      });

      const result = await service.createWorktreeAtCommit(commit, branch, {
        expectedTargetPath: targetPath,
      });

      expect(result).toMatchObject({
        success: false,
        error: { type: 'worktree-rollback-incomplete' },
      });
      expect(fs.existsSync(targetPath)).toBe(true);
      await expect(
        git(['show-ref', '--verify', `refs/heads/${branch}`], { cwd: repoDir })
      ).resolves.toBeDefined();
    }, 15_000);

    it('pins a generated worktree to the exact immutable commit when the source branch moves', async () => {
      fs.writeFileSync(path.join(repoDir, 'feature.txt'), 'base');
      await git(['add', 'feature.txt'], { cwd: repoDir });
      await git(['commit', '-m', 'base'], { cwd: repoDir });
      const baseCommit = (await git(['rev-parse', 'HEAD'], { cwd: repoDir })).stdout.trim();

      fs.writeFileSync(path.join(repoDir, 'feature.txt'), 'moved');
      await git(['commit', '-am', 'move source'], { cwd: repoDir });

      const result = await makeService().createWorktreeAtCommit(
        baseCommit,
        'emdash/loop-verify-exact'
      );

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('expected success');
      expect(result.data).toBe(path.join(poolDir, 'emdash', 'loop-verify-exact'));
      await expect(git(['rev-parse', 'HEAD'], { cwd: result.data })).resolves.toMatchObject({
        stdout: `${baseCommit}\n`,
      });
      expect(fs.readFileSync(path.join(result.data, 'feature.txt'), 'utf8')).toBe('base');
    });

    it('attests an uppercase immutable commit case-insensitively', async () => {
      const commit = (await git(['rev-parse', 'HEAD'], { cwd: repoDir })).stdout
        .trim()
        .toUpperCase();

      const result = await makeService().createWorktreeAtCommit(
        commit,
        'emdash/loop-uppercase-head'
      );

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('expected uppercase commit attestation');
      await expect(git(['rev-parse', 'HEAD'], { cwd: result.data })).resolves.toMatchObject({
        stdout: `${commit.toLowerCase()}\n`,
      });
    });

    it('attests canonical Windows-equivalent paths from NUL porcelain records', async () => {
      const winPathApi: RuntimePath = {
        join: (...parts: string[]) => path.win32.join(...parts),
        dirname: (input: string) => path.win32.dirname(input),
        basename: (input: string) => path.win32.basename(input),
        isAbsolute: (input: string) => path.win32.isAbsolute(input),
        relative: (from: string, to: string) => path.win32.relative(from, to),
        contains: (parent: string, child: string) => {
          const rel = path.win32.relative(parent, child);
          return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.win32.sep}`));
        },
      };
      const canonical = (value: string) => path.win32.normalize(value).toLowerCase();
      const repoPath = 'C:\\Repo';
      const poolPath = 'C:\\Worktrees\\Project';
      const branch = 'emdash/loop-win-canonical';
      const targetPath = path.win32.join(poolPath, branch);
      const listedPath = 'c:/WORKTREES/PROJECT/emdash/loop-win-canonical';
      const commit = 'a'.repeat(40);
      let added = false;
      const exec = vi.fn(async (_command: string, args: string[] = []) => {
        if (args[0] === 'worktree' && args[1] === 'add') added = true;
        if (args[0] === '-C' && args.includes('--git-common-dir')) {
          return { stdout: 'C:\\Repo\\.git\n', stderr: '' };
        }
        if (args[0] === '-C' && canonical(args[1]) === canonical(targetPath)) {
          if (args[2] === 'symbolic-ref') {
            return { stdout: `refs/heads/${branch}\n`, stderr: '' };
          }
          if (args[2] === 'rev-parse' && args[3] === '--is-inside-work-tree') {
            return { stdout: 'true\n', stderr: '' };
          }
          if (args[2] === 'rev-parse' && args[3] === 'HEAD') {
            return { stdout: `${commit}\n`, stderr: '' };
          }
        }
        if (args[0] === 'worktree' && args[1] === 'list' && args.includes('-z') && added) {
          return {
            stdout: `worktree ${listedPath}\0HEAD ${commit.toUpperCase()}\0branch refs/heads/${branch}\0\0`,
            stderr: '',
          };
        }
        return { stdout: '', stderr: '' };
      });
      const service = new WorktreeService({
        repoPath,
        ctx: {
          root: repoPath,
          supportsLocalSpawn: false,
          exec,
          execStreaming: async () => {},
          dispose: () => {},
        },
        files: makeFakeFilesRuntime({
          pathApi: winPathApi,
          existsAbsolute: async (candidate) =>
            added &&
            (canonical(candidate) === canonical(targetPath) ||
              canonical(candidate) === canonical(path.win32.join(targetPath, '.git'))),
          mkdirAbsolute: async () => {},
          realPathAbsolute: async (candidate) => canonical(candidate),
        }),
        projectSettings: makeSettings(),
        resolveWorktreePoolPath: async () => poolPath,
      });

      const result = await service.createWorktreeAtCommit(commit, branch);

      expect(result).toEqual({ success: true, data: targetPath });
      expect(exec).toHaveBeenCalledWith(
        'git',
        ['worktree', 'list', '--porcelain', '-z'],
        expect.objectContaining({ timeout: expect.any(Number) })
      );
    });

    it('fails closed for an invalid or missing full commit without creating a branch', async () => {
      const missingCommit = 'f'.repeat(40);

      const result = await makeService().createWorktreeAtCommit(
        missingCommit,
        'emdash/loop-verify-missing'
      );

      expect(result).toEqual({
        success: false,
        error: {
          type: 'commit-not-found',
          commit: missingCommit,
        },
      });
      await expect(
        git(['show-ref', '--verify', 'refs/heads/emdash/loop-verify-missing'], { cwd: repoDir })
      ).rejects.toBeDefined();
    });

    it('uses machine path algebra and argument-array git for remote worktree creation', async () => {
      const stripHost = (value: string) => value.replace(/^host:/, '');
      const remotePathApi: RuntimePath = {
        join: (...segments: string[]) =>
          `host:${path.posix.join(...segments.map((segment) => stripHost(segment)))}`,
        dirname: (input: string) => `host:${path.posix.dirname(stripHost(input))}`,
        basename: (input: string) => path.posix.basename(stripHost(input)),
        isAbsolute: (input: string) => input.startsWith('host:/') || path.posix.isAbsolute(input),
        relative: (from: string, to: string) => path.posix.relative(stripHost(from), stripHost(to)),
        contains: (parent: string, child: string) => {
          const rel = path.posix.relative(stripHost(parent), stripHost(child));
          return rel === '' || (rel !== '..' && !rel.startsWith('../'));
        },
      };
      const commit = 'a'.repeat(40);
      let added = false;
      const targetPath = 'host:/remote/worktrees/project/emdash/loop-verify-remote';
      const exec = vi.fn(async (_command: string, args: string[] = []) => {
        if (args[0] === 'worktree' && args[1] === 'add') added = true;
        if (args[0] === '-C' && args.includes('--git-common-dir')) {
          return { stdout: 'host:/remote/repo/.git\n', stderr: '' };
        }
        if (args[0] === '-C' && args[1] === targetPath && args[2] === 'symbolic-ref') {
          return { stdout: 'refs/heads/emdash/loop-verify-remote\n', stderr: '' };
        }
        if (
          args[0] === '-C' &&
          args[1] === targetPath &&
          args[2] === 'rev-parse' &&
          args[3] === '--is-inside-work-tree'
        ) {
          return { stdout: 'true\n', stderr: '' };
        }
        if (args[0] === '-C' && args[1] === targetPath && args[2] === 'rev-parse') {
          return { stdout: `${commit}\n`, stderr: '' };
        }
        if (args[0] === 'worktree' && args[1] === 'list' && added) {
          return {
            stdout: `worktree ${targetPath}\0HEAD ${commit}\0branch refs/heads/emdash/loop-verify-remote\0\0`,
            stderr: '',
          };
        }
        return { stdout: '', stderr: '' };
      });
      const service = new WorktreeService({
        repoPath: '/remote/repo',
        ctx: {
          root: '/remote/repo',
          supportsLocalSpawn: false,
          exec,
          execStreaming: async () => {},
          dispose: () => {},
        },
        files: makeFakeFilesRuntime({
          pathApi: remotePathApi,
          existsAbsolute: async (candidate) =>
            added && (candidate === targetPath || candidate === `${targetPath}/.git`),
          mkdirAbsolute: async () => {},
          realPathAbsolute: async (candidate) => candidate,
        }),
        projectSettings: makeSettings(),
        resolveWorktreePoolPath: async () => '/remote/worktrees/project',
      });
      exec.mockClear();

      const result = await service.createWorktreeAtCommit(commit, 'emdash/loop-verify-remote');

      expect(result.success).toBe(true);
      expect(exec).toHaveBeenCalledWith(
        'git',
        ['cat-file', '-e', `${commit}^{commit}`],
        expect.objectContaining({ timeout: expect.any(Number) })
      );
      expect(exec).toHaveBeenCalledWith(
        'git',
        ['worktree', 'add', '-b', 'emdash/loop-verify-remote', targetPath, commit],
        expect.objectContaining({ timeout: expect.any(Number) })
      );
    });

    it('does not delete a generated target whose exact ownership cannot be attested', async () => {
      const commit = 'b'.repeat(40);
      const targetPath = path.join(poolDir, 'emdash', 'loop-verify-rollback');
      let targetExists = false;
      let branchExists = false;
      const removeAbsolute = vi.fn(async () => {
        targetExists = false;
        return ok<void>();
      });
      const exec = vi.fn(async (_command: string, args: string[] = []) => {
        if (args[0] === 'for-each-ref') {
          return {
            stdout: branchExists ? 'refs/heads/emdash/loop-verify-rollback\n' : '',
            stderr: '',
          };
        }
        if (args.slice(0, 2).join(' ') === 'worktree add') {
          targetExists = true;
          branchExists = true;
        }
        if (args[0] === 'branch') branchExists = false;
        if (args[0] === '-C' && args[2] === 'rev-parse') {
          return { stdout: `${'c'.repeat(40)}\n`, stderr: '' };
        }
        return { stdout: '', stderr: '' };
      });
      const service = new WorktreeService({
        repoPath: repoDir,
        ctx: {
          root: repoDir,
          supportsLocalSpawn: true,
          exec,
          execStreaming: async () => {},
          dispose: () => {},
        },
        files: makeFakeFilesRuntime({
          existsAbsolute: async (candidate) => targetExists && candidate === targetPath,
          removeAbsolute,
          realPathAbsolute: async (candidate) => candidate,
        }),
        projectSettings: makeSettings(),
        resolveWorktreePoolPath: async () => poolDir,
      });
      exec.mockClear();

      const result = await service.createWorktreeAtCommit(commit, 'emdash/loop-verify-rollback');

      expect(result).toMatchObject({
        success: false,
        error: { type: 'worktree-rollback-incomplete' },
      });
      expect(removeAbsolute).not.toHaveBeenCalled();
      expect(exec).not.toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['branch', '--delete', '--force'])
      );
    });

    it('surfaces an incomplete generated-worktree rollback without exposing paths', async () => {
      const commit = 'd'.repeat(40);
      const targetPath = path.join(poolDir, 'emdash', 'loop-verify-rollback-fails');
      let targetExists = false;
      let branchExists = false;
      const exec = vi.fn(async (_command: string, args: string[] = []) => {
        if (args.slice(0, 2).join(' ') === 'worktree add') {
          targetExists = true;
          branchExists = true;
        }
        if (args[0] === '-C' && args[2] === 'rev-parse') {
          return { stdout: `${'e'.repeat(40)}\n`, stderr: '' };
        }
        if (args[0] === 'for-each-ref') {
          return {
            stdout: branchExists ? 'refs/heads/emdash/loop-verify-rollback-fails\n' : '',
            stderr: '',
          };
        }
        if (args[0] === 'branch') throw new Error('branch still checked out');
        return { stdout: '', stderr: '' };
      });
      const service = new WorktreeService({
        repoPath: repoDir,
        ctx: {
          root: repoDir,
          supportsLocalSpawn: true,
          exec,
          execStreaming: async () => {},
          dispose: () => {},
        },
        files: makeFakeFilesRuntime({
          existsAbsolute: async (candidate) => targetExists && candidate === targetPath,
          removeAbsolute: async () => err({ message: 'busy' }),
          realPathAbsolute: async (candidate) => candidate,
        }),
        projectSettings: makeSettings(),
        resolveWorktreePoolPath: async () => poolDir,
      });

      const result = await service.createWorktreeAtCommit(
        commit,
        'emdash/loop-verify-rollback-fails'
      );

      expect(result).toEqual({
        success: false,
        error: {
          type: 'worktree-rollback-incomplete',
          message: 'Generated worktree creation failed and rollback was incomplete.',
        },
      });
      expect(JSON.stringify(result)).not.toContain(targetPath);
    });

    it('does not prune metadata or CAS-delete a branch when owned path removal fails', async () => {
      const commit = (await git(['rev-parse', 'HEAD'], { cwd: repoDir })).stdout.trim();
      const branch = 'emdash/loop-removal-boundary';
      const targetPath = path.join(poolDir, branch);
      const controller = new AbortController();
      const delegate = new LocalExecutionContext({ root: repoDir });
      let added = false;
      let removalFailed = false;
      const forbiddenAfterRemoval: string[][] = [];
      const ctx: IExecutionContext = {
        root: repoDir,
        supportsLocalSpawn: true,
        exec: async (command, args = [], options) => {
          if (
            removalFailed &&
            ((args[0] === 'worktree' && args[1] === 'prune') ||
              (args[0] === 'update-ref' && args[1] === '-d'))
          ) {
            forbiddenAfterRemoval.push([...args]);
          }
          const result = await delegate.exec(command, args, options);
          if (args[0] === 'worktree' && args[1] === 'add') added = true;
          if (added && !controller.signal.aborted && args[0] === 'worktree' && args[1] === 'list') {
            controller.abort();
          }
          return result;
        },
        execStreaming: (command, args, onChunk, options) =>
          delegate.execStreaming(command, args, onChunk, options),
        dispose: () => delegate.dispose(),
      };
      const runtime = Object.assign(new FilesRuntime(), { path: nativeMachinePath });
      const opened = runtime.fileSystem();
      if (!opened.success) throw new Error('expected local file system');
      const fileSystem = new Proxy(opened.data, {
        get(target, property, receiver) {
          if (property === 'remove') {
            return async (candidate: string) => {
              if (candidate === targetPath) {
                removalFailed = true;
                return err({
                  type: 'fs-error' as const,
                  path: candidate,
                  message: 'actor holds the path',
                });
              }
              return target.remove.bind(target)(candidate, { recursive: true });
            };
          }
          const value = Reflect.get(target, property, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      }) as IFileSystem;
      const service = new WorktreeService({
        repoPath: repoDir,
        ctx,
        files: Object.assign(runtime, { fileSystem: () => ok(fileSystem) }),
        projectSettings: makeSettings(),
        resolveWorktreePoolPath: async () => poolDir,
      });

      const result = await service.createWorktreeAtCommit(commit, branch, {
        expectedTargetPath: targetPath,
        signal: controller.signal,
      });

      expect(result).toMatchObject({
        success: false,
        error: { type: 'worktree-rollback-incomplete' },
      });
      expect(removalFailed).toBe(true);
      expect(forbiddenAfterRemoval).toEqual([]);
      expect(fs.existsSync(targetPath)).toBe(true);
      await expect(
        git(['rev-parse', `refs/heads/${branch}`], { cwd: repoDir })
      ).resolves.toMatchObject({ stdout: `${commit}\n` });
    });

    it('uses owned-commit CAS and preserves a branch moved before rollback', async () => {
      const commit = 'd'.repeat(40);
      const movedCommit = 'e'.repeat(40);
      const branch = 'emdash/loop-rollback-cas';
      const targetPath = path.join(poolDir, branch);
      const controller = new AbortController();
      let targetExists = false;
      let branchHead = '';
      let attestationLists = 0;
      const exec = vi.fn(async (_command: string, args: string[] = []) => {
        if (args[0] === '-C' && args.includes('--git-common-dir')) {
          return { stdout: `${path.join(repoDir, '.git')}\n`, stderr: '' };
        }
        if (args[0] === 'for-each-ref') {
          return {
            stdout: branchHead
              ? args[1] === '--format=%(refname)'
                ? `refs/heads/${branch}\n`
                : `${branchHead}\n`
              : '',
            stderr: '',
          };
        }
        if (args[0] === 'worktree' && args[1] === 'add') {
          targetExists = true;
          branchHead = commit;
        }
        if (args[0] === '-C' && args[1] === targetPath) {
          if (args[2] === 'symbolic-ref') {
            return { stdout: `refs/heads/${branch}\n`, stderr: '' };
          }
          if (args[2] === 'rev-parse' && args[3] === '--is-inside-work-tree') {
            return { stdout: 'true\n', stderr: '' };
          }
          if (args[2] === 'rev-parse' && args[3] === 'HEAD') {
            return { stdout: `${branchHead}\n`, stderr: '' };
          }
        }
        if (args[0] === 'worktree' && args[1] === 'list' && targetExists) {
          attestationLists += 1;
          if (attestationLists === 1) controller.abort();
          return {
            stdout: `worktree ${targetPath}\0HEAD ${branchHead}\0branch refs/heads/${branch}\0\0`,
            stderr: '',
          };
        }
        if (args[0] === 'update-ref' && args[1] === '-d') {
          branchHead = movedCommit;
          if (branchHead !== args[3]) throw new Error('CAS lost');
          branchHead = '';
        }
        if (args[0] === 'branch') branchHead = '';
        return { stdout: '', stderr: '' };
      });
      const service = new WorktreeService({
        repoPath: repoDir,
        ctx: {
          root: repoDir,
          supportsLocalSpawn: true,
          exec,
          execStreaming: async () => {},
          dispose: () => {},
        },
        files: makeFakeFilesRuntime({
          existsAbsolute: async (candidate) =>
            targetExists &&
            (candidate === targetPath || candidate === path.join(targetPath, '.git')),
          removeAbsolute: async () => {
            targetExists = false;
            return ok();
          },
          realPathAbsolute: async (candidate) => candidate,
        }),
        projectSettings: makeSettings(),
        resolveWorktreePoolPath: async () => poolDir,
      });

      const result = await service.createWorktreeAtCommit(commit, branch, {
        expectedTargetPath: targetPath,
        signal: controller.signal,
      });

      expect(result).toMatchObject({
        success: false,
        error: { type: 'worktree-rollback-incomplete' },
      });
      expect(branchHead).toBe(movedCommit);
      expect(exec).toHaveBeenCalledWith('git', [
        'update-ref',
        '-d',
        `refs/heads/${branch}`,
        commit,
      ]);
      expect(exec).not.toHaveBeenCalledWith(
        'git',
        expect.arrayContaining(['branch', '--delete', '--force'])
      );
    });

    it.each([
      { label: 'untracked', actorFile: 'actor.txt', ignore: false },
      { label: 'ignored', actorFile: 'ignored-actor.txt', ignore: true },
    ])(
      'preserves $label actor bytes that appear immediately before rollback removal',
      async ({ actorFile, ignore }) => {
        if (ignore) {
          fs.writeFileSync(path.join(repoDir, '.gitignore'), `${actorFile}\n`);
          await git(['add', '.gitignore'], { cwd: repoDir });
          await git(['commit', '-m', 'ignore actor fixture'], { cwd: repoDir });
        }
        const commit = (await git(['rev-parse', 'HEAD'], { cwd: repoDir })).stdout.trim();
        const branch = 'emdash/loop-rollback-dirty';
        const targetPath = path.join(poolDir, branch);
        const controller = new AbortController();
        const delegate = new LocalExecutionContext({ root: repoDir });
        let added = false;
        let abortAfterAttestation = true;
        let injectActorBytes = true;
        const ctx: IExecutionContext = {
          root: repoDir,
          supportsLocalSpawn: true,
          exec: async (command, args = [], options) => {
            const result = await delegate.exec(command, args, options);
            if (args[0] === 'worktree' && args[1] === 'add') added = true;
            if (added && abortAfterAttestation && args[0] === 'worktree' && args[1] === 'list') {
              abortAfterAttestation = false;
              controller.abort();
            }
            if (
              added &&
              injectActorBytes &&
              args[0] === '-C' &&
              args[1] === targetPath &&
              args[2] === 'status'
            ) {
              injectActorBytes = false;
              fs.writeFileSync(path.join(targetPath, actorFile), 'actor bytes');
              return delegate.exec(command, args, options);
            }
            return result;
          },
          execStreaming: (command, args, onChunk, options) =>
            delegate.execStreaming(command, args, onChunk, options),
          dispose: () => delegate.dispose(),
        };
        const service = new WorktreeService({
          repoPath: repoDir,
          ctx,
          files: Object.assign(new FilesRuntime(), { path: nativeMachinePath }),
          projectSettings: makeSettings(),
          resolveWorktreePoolPath: async () => poolDir,
        });

        const result = await service.createWorktreeAtCommit(commit, branch, {
          signal: controller.signal,
          expectedTargetPath: targetPath,
        });

        expect(result).toMatchObject({
          success: false,
          error: { type: 'worktree-rollback-incomplete' },
        });
        expect(fs.readFileSync(path.join(targetPath, actorFile), 'utf8')).toBe('actor bytes');
        expect(await git(['rev-parse', `refs/heads/${branch}`], { cwd: repoDir })).toMatchObject({
          stdout: `${commit}\n`,
        });
      }
    );
  });

  it('finds a branch whose registered worktree path contains a newline', async () => {
    const branch = 'task/newline-worktree';
    const newlinePath = path.join(poolDir, 'line\nbreak');
    await git(['worktree', 'add', '-b', branch, newlinePath], { cwd: repoDir });

    await expect(makeService().findBranchAnywhere(branch)).resolves.toBe(newlinePath);
  });

  describe('copyPreservedFilesToWorktree', () => {
    it('keeps held preserve settings quiescent before generated worktree removal', async () => {
      fs.writeFileSync(path.join(repoDir, '.env.local'), 'SECRET=abc');
      const commit = (await git(['rev-parse', 'HEAD'], { cwd: repoDir })).stdout.trim();
      const branch = 'emdash/loop-held-preserve-settings';
      const settingsGate = deferred<Awaited<ReturnType<ProjectSettingsProvider['get']>>>();
      const settingsStarted = deferred();
      const controller = new AbortController();
      const settings = makeSettings();
      settings.get = () => {
        settingsStarted.resolve();
        return settingsGate.promise;
      };
      const service = makeService({ projectSettings: settings });
      const created = await service.createWorktreeAtCommit(commit, branch);
      if (!created.success) throw new Error('expected worktree');

      const copying = service.copyPreservedFilesToWorktree(created.data, {
        signal: controller.signal,
      });
      let settled = false;
      void copying.then(() => {
        settled = true;
      });
      await settingsStarted.promise;
      controller.abort();
      await Promise.resolve();

      expect(settled).toBe(false);
      await expect(
        service.removeGeneratedWorktreeIfPresent(created.data, {
          expectedBranchName: branch,
          expectedHead: commit,
        })
      ).resolves.toMatchObject({ success: false, error: { type: 'worktree-remove-failed' } });

      settingsGate.resolve({ preservePatterns: ['.env.local'] });
      await expect(copying).resolves.toMatchObject({
        success: false,
        error: { type: 'cancelled' },
      });
      await service.waitForGeneratedWorktreeOperations(created.data);
      await expect(
        service.removeGeneratedWorktreeIfPresent(created.data, {
          expectedBranchName: branch,
          expectedHead: commit,
        })
      ).resolves.toEqual(ok({ removed: true }));
    }, 15_000);

    it('keeps held preserve glob enumeration quiescent before removal', async () => {
      fs.writeFileSync(path.join(repoDir, '.env.local'), 'SECRET=abc');
      const commit = (await git(['rev-parse', 'HEAD'], { cwd: repoDir })).stdout.trim();
      const branch = 'emdash/loop-held-preserve-glob';
      const globGate = deferred();
      const globStarted = deferred();
      const controller = new AbortController();
      const service = makeServiceWithFileSystemOverride(makeSettings(['.env.local']), {
        glob: () =>
          ok(
            (async function* () {
              globStarted.resolve();
              await globGate.promise;
              yield path.join(repoDir, '.env.local');
            })()
          ),
      });
      const created = await service.createWorktreeAtCommit(commit, branch);
      if (!created.success) throw new Error('expected worktree');
      const copying = service.copyPreservedFilesToWorktree(created.data, {
        signal: controller.signal,
      });

      await globStarted.promise;
      controller.abort();
      await expect(
        service.removeGeneratedWorktreeIfPresent(created.data, {
          expectedBranchName: branch,
          expectedHead: commit,
        })
      ).resolves.toMatchObject({ success: false, error: { type: 'worktree-remove-failed' } });
      globGate.resolve();

      await expect(copying).resolves.toMatchObject({
        success: false,
        error: { type: 'cancelled' },
      });
      expect(fs.existsSync(path.join(created.data, '.env.local'))).toBe(false);
    });

    it('waits a late preserve copy before cleanup removes every copied byte', async () => {
      const source = path.join(repoDir, '.env.local');
      fs.writeFileSync(source, 'SECRET=abc');
      const commit = (await git(['rev-parse', 'HEAD'], { cwd: repoDir })).stdout.trim();
      const branch = 'emdash/loop-held-preserve-copy';
      const copyGate = deferred();
      const copyStarted = deferred();
      const controller = new AbortController();
      const service = makeServiceWithFileSystemOverride(makeSettings(['.env.local']), {
        copyFile: async (from, to) => {
          copyStarted.resolve();
          await copyGate.promise;
          fs.copyFileSync(from, to);
          return ok();
        },
      });
      const created = await service.createWorktreeAtCommit(commit, branch);
      if (!created.success) throw new Error('expected worktree');
      const copying = service.copyPreservedFilesToWorktree(created.data, {
        signal: controller.signal,
      });

      await copyStarted.promise;
      controller.abort();
      await expect(
        service.removeGeneratedWorktreeIfPresent(created.data, {
          expectedBranchName: branch,
          expectedHead: commit,
        })
      ).resolves.toMatchObject({ success: false, error: { type: 'worktree-remove-failed' } });
      copyGate.resolve();
      await expect(copying).resolves.toMatchObject({
        success: false,
        error: { type: 'cancelled' },
      });
      await service.waitForGeneratedWorktreeOperations(created.data);
      await expect(
        service.removeGeneratedWorktreeIfPresent(created.data, {
          expectedBranchName: branch,
          expectedHead: commit,
        })
      ).resolves.toEqual(ok({ removed: true }));
      expect(fs.existsSync(created.data)).toBe(false);
    });

    it('resolves feature-version preserve rules after replay and copies only untracked files', async () => {
      fs.writeFileSync(path.join(repoDir, '.env.local'), 'SECRET=abc');
      fs.writeFileSync(path.join(repoDir, 'tracked.txt'), 'tracked');
      await git(['add', 'tracked.txt'], { cwd: repoDir });
      await git(['commit', '-m', 'tracked'], { cwd: repoDir });
      const commit = (await git(['rev-parse', 'HEAD'], { cwd: repoDir })).stdout.trim();
      const settings = makeSettings();
      settings.get = async () => ({});
      const service = makeService({ projectSettings: settings });
      const created = await service.createWorktreeAtCommit(commit, 'emdash/loop-preserve');
      if (!created.success) throw new Error('expected worktree');
      fs.writeFileSync(
        path.join(created.data, '.emdash.json'),
        JSON.stringify({ preservePatterns: ['.env.local', 'tracked.txt'] })
      );

      const copied = await service.copyPreservedFilesToWorktree(created.data);

      expect(copied).toEqual({ success: true, data: { copied: ['.env.local'] } });
      expect(fs.readFileSync(path.join(created.data, '.env.local'), 'utf8')).toBe('SECRET=abc');
    });

    it('safely excludes a preserved symlink whose real source escapes the repository', async () => {
      const external = path.join(os.tmpdir(), `loop-preserve-${Date.now()}.txt`);
      fs.writeFileSync(external, 'outside');
      fs.symlinkSync(external, path.join(repoDir, '.env.local'));
      const commit = (await git(['rev-parse', 'HEAD'], { cwd: repoDir })).stdout.trim();
      const service = makeService({ projectSettings: makeSettings(['.env.local']) });
      const created = await service.createWorktreeAtCommit(commit, 'emdash/loop-symlink');
      if (!created.success) throw new Error('expected worktree');

      try {
        await expect(service.copyPreservedFilesToWorktree(created.data)).resolves.toEqual({
          success: true,
          data: { copied: [] },
        });
        expect(fs.existsSync(path.join(created.data, '.env.local'))).toBe(false);
      } finally {
        fs.rmSync(external, { force: true });
      }
    });

    it('fails closed when a required preserve pattern has no source matches', async () => {
      const commit = (await git(['rev-parse', 'HEAD'], { cwd: repoDir })).stdout.trim();
      const service = makeService({ projectSettings: makeSettings(['missing.env']) });
      const created = await service.createWorktreeAtCommit(commit, 'emdash/loop-missing-preserve');
      if (!created.success) throw new Error('expected worktree');

      await expect(service.copyPreservedFilesToWorktree(created.data)).resolves.toEqual({
        success: false,
        error: {
          type: 'preserve-source-failed',
          pattern: 'missing.env',
          message: 'Required preserve pattern did not match a source file.',
        },
      });
    });

    it('fails closed for malformed feature-version .emdash.json instead of falling back', async () => {
      fs.writeFileSync(path.join(repoDir, '.env.local'), 'SECRET=abc');
      const commit = (await git(['rev-parse', 'HEAD'], { cwd: repoDir })).stdout.trim();
      const service = makeService({ projectSettings: makeSettings(['.env.local']) });
      const created = await service.createWorktreeAtCommit(commit, 'emdash/loop-bad-config');
      if (!created.success) throw new Error('expected worktree');
      fs.writeFileSync(path.join(created.data, '.emdash.json'), '{not-json');

      await expect(service.copyPreservedFilesToWorktree(created.data)).resolves.toEqual({
        success: false,
        error: {
          type: 'preserve-config-unavailable',
          message: 'Feature .emdash.json could not be read safely.',
        },
      });
    });

    it('returns a typed config failure when project settings reject', async () => {
      const commit = (await git(['rev-parse', 'HEAD'], { cwd: repoDir })).stdout.trim();
      const settings = makeSettings(['.env.local']);
      settings.get = async () => {
        throw new Error('settings unavailable');
      };
      const service = makeService({ projectSettings: settings });
      const created = await service.createWorktreeAtCommit(commit, 'emdash/loop-settings-failure');
      if (!created.success) throw new Error('expected worktree');

      await expect(service.copyPreservedFilesToWorktree(created.data)).resolves.toEqual({
        success: false,
        error: {
          type: 'preserve-config-unavailable',
          message: 'Required preserve settings could not be resolved.',
        },
      });
    });

    it('returns a typed failure when the preserve glob cannot be evaluated', async () => {
      fs.writeFileSync(path.join(repoDir, '.env.local'), 'SECRET=abc');
      const commit = (await git(['rev-parse', 'HEAD'], { cwd: repoDir })).stdout.trim();
      const service = makeServiceWithFileSystemOverride(makeSettings(['.env.local']), {
        glob: () =>
          err({
            type: 'fs-error',
            path: repoDir,
            message: 'glob unavailable',
          }),
      });
      const created = await service.createWorktreeAtCommit(commit, 'emdash/loop-glob-failure');
      if (!created.success) throw new Error('expected worktree');

      await expect(service.copyPreservedFilesToWorktree(created.data)).resolves.toEqual({
        success: false,
        error: {
          type: 'preserve-glob-failed',
          pattern: '.env.local',
          message: 'Required preserve pattern could not be matched.',
        },
      });
    });

    it('returns a typed failure when a required preserved file cannot be copied', async () => {
      fs.writeFileSync(path.join(repoDir, '.env.local'), 'SECRET=abc');
      const commit = (await git(['rev-parse', 'HEAD'], { cwd: repoDir })).stdout.trim();
      const service = makeServiceWithFileSystemOverride(makeSettings(['.env.local']), {
        copyFile: async (_source, destination) =>
          err({
            type: 'fs-error',
            path: destination,
            message: 'copy unavailable',
          }),
      });
      const created = await service.createWorktreeAtCommit(commit, 'emdash/loop-copy-failure');
      if (!created.success) throw new Error('expected worktree');

      await expect(service.copyPreservedFilesToWorktree(created.data)).resolves.toEqual({
        success: false,
        error: {
          type: 'preserve-copy-failed',
          pattern: '.env.local',
          message: 'Required preserve pattern could not be copied.',
        },
      });
    });

    it('fails closed when Git cannot prove a preserve source is untracked', async () => {
      fs.writeFileSync(path.join(repoDir, '.env.local'), 'SECRET=abc');
      const commit = (await git(['rev-parse', 'HEAD'], { cwd: repoDir })).stdout.trim();
      const delegate = new LocalExecutionContext({ root: repoDir });
      const ctx: IExecutionContext = {
        root: repoDir,
        supportsLocalSpawn: true,
        exec: (command, args = [], options) => {
          if (command === 'git' && args[0] === 'ls-files') {
            return Promise.reject(new Error('Git transport unavailable'));
          }
          return delegate.exec(command, args, options);
        },
        execStreaming: (command, args, onChunk, options) =>
          delegate.execStreaming(command, args, onChunk, options),
        dispose: () => delegate.dispose(),
      };
      const service = makeServiceWithFileSystemOverride(makeSettings(['.env.local']), {}, ctx);
      const created = await service.createWorktreeAtCommit(commit, 'emdash/loop-tracked-failure');
      if (!created.success) throw new Error('expected worktree');

      await expect(service.copyPreservedFilesToWorktree(created.data)).resolves.toEqual({
        success: false,
        error: {
          type: 'preserve-source-failed',
          pattern: '.env.local',
          message: 'Required preserve source tracking status could not be verified.',
        },
      });
    });
  });

  it('uses the runtime path API for worktree paths', async () => {
    const stripHost = (value: string) => value.replace(/^host:/, '');
    const remotePathApi: RuntimePath = {
      join: (...segments: string[]) =>
        `host:${path.posix.join(...segments.map((segment) => stripHost(segment)))}`,
      dirname: (input: string) => `host:${path.posix.dirname(stripHost(input))}`,
      basename: (input: string) => path.posix.basename(stripHost(input)),
      isAbsolute: (input: string) => input.startsWith('host:/') || path.posix.isAbsolute(input),
      relative: (from: string, to: string) => path.posix.relative(stripHost(from), stripHost(to)),
      contains: (parent: string, child: string) => {
        const rel = path.posix.relative(stripHost(parent), stripHost(child));
        return (
          rel === '' || (rel !== '..' && !rel.startsWith('../') && !path.posix.isAbsolute(rel))
        );
      },
    };
    const existsAbsolute = vi.fn().mockResolvedValue(false);
    const mkdirAbsolute = vi.fn().mockResolvedValue(undefined);
    const files = makeFakeFilesRuntime({
      pathApi: remotePathApi,
      existsAbsolute,
      mkdirAbsolute,
      realPathAbsolute: async (absPath) => absPath,
    });
    const remoteCtx = {
      root: '/remote/repo',
      supportsLocalSpawn: false,
      exec: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
      execStreaming: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn(),
    } satisfies IExecutionContext;
    const svc = new WorktreeService({
      repoPath: '/remote/repo',
      ctx: remoteCtx,
      files,
      projectSettings: makeSettings(),
      resolveWorktreePoolPath: async () => '/remote/worktrees/project',
    });

    await expect(svc.getWorktree('emdash/task-abc')).resolves.toBeUndefined();

    expect(existsAbsolute).toHaveBeenCalledWith('host:/remote/worktrees/project/emdash/task-abc');

    const checkoutResult = await svc.checkoutBranchWorktree(
      { type: 'local', branch: 'main' },
      'emdash/task-created'
    );

    expect(checkoutResult.success).toBe(true);
    expect(mkdirAbsolute).toHaveBeenCalledWith('host:/remote/worktrees/project/emdash', {
      recursive: true,
    });
  });

  describe('checkoutBranchWorktree', () => {
    it('ignores stale worktree-list entries under the pool', async () => {
      const branchName = 'emdash/openrouter-embedding-3hvp5';
      const stalePath = path.join(poolDir, 'backend', branchName);
      await git(['branch', branchName], { cwd: repoDir });
      await git(['worktree', 'add', stalePath, branchName], { cwd: repoDir });
      fs.rmSync(stalePath, { recursive: true, force: true });

      const svc = makeService({ worktreePoolPath: path.join(poolDir, 'backend') });

      await expect(svc.getWorktree(branchName)).resolves.toBeUndefined();
    });

    it('returns undefined when stale lookup cleanup fails', async () => {
      const branchName = 'task/stuck-lookup';
      const targetPath = path.join(poolDir, branchName);
      const exec = vi.fn(async () => ({ stdout: '', stderr: '' }));
      const ctx: IExecutionContext = {
        root: repoDir,
        supportsLocalSpawn: false,
        exec,
        execStreaming: async () => {},
        dispose: () => {},
      };
      const removeAbsolute = vi.fn(async () => err({ message: 'permission denied' }));
      const files = makeFakeFilesRuntime({
        existsAbsolute: async (absPath) => absPath === targetPath,
        removeAbsolute,
        realPathAbsolute: async (absPath) => absPath,
      });
      const svc = new WorktreeService({
        repoPath: repoDir,
        ctx,
        files,
        projectSettings: makeSettings(),
        resolveWorktreePoolPath: async () => poolDir,
      });

      await expect(svc.getWorktree(branchName)).resolves.toBeUndefined();

      expect(removeAbsolute).toHaveBeenCalledWith(targetPath, { recursive: true });
    });

    it('creates a worktree from an existing local source branch', async () => {
      await git(['branch', 'task/local-checkout'], { cwd: repoDir });
      const svc = makeService();

      const result = await svc.checkoutBranchWorktree(
        { type: 'local', branch: 'main' },
        'task/local-checkout'
      );

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('expected success');
      expect(result.data).toBe(path.join(poolDir, 'task', 'local-checkout'));
      expect(fs.existsSync(result.data)).toBe(true);
      const { stdout } = await git(['config', '--get', 'branch.task/local-checkout.base'], {
        cwd: repoDir,
      });
      expect(stdout.trim()).toBe('main');
    });

    it('repairs an invalid target directory before creating the worktree', async () => {
      const branchName = 'task/stale-target';
      const stalePath = path.join(poolDir, branchName);
      fs.mkdirSync(path.join(stalePath, 'node_modules', 'electron', 'dist'), { recursive: true });
      fs.writeFileSync(
        path.join(stalePath, 'node_modules', 'electron', 'dist', 'default_app.asar'),
        'stale'
      );

      const svc = makeService();
      const result = await svc.checkoutBranchWorktree(
        { type: 'local', branch: 'main' },
        branchName
      );

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('expected success');
      expect(result.data).toBe(stalePath);
      expect(fs.existsSync(path.join(stalePath, '.git'))).toBe(true);
      expect(fs.existsSync(path.join(stalePath, 'node_modules'))).toBe(false);
    });

    it('returns setup failure when an invalid target directory cannot be removed', async () => {
      const branchName = 'task/stuck-target';
      const targetPath = path.join(poolDir, branchName);
      const exec = vi.fn(async (_command: string, args: string[] = []) => {
        if (args.join(' ') === 'worktree list --porcelain') return { stdout: '', stderr: '' };
        throw new Error(`Unexpected git command: git ${args.join(' ')}`);
      });
      const ctx: IExecutionContext = {
        root: repoDir,
        supportsLocalSpawn: false,
        exec,
        execStreaming: async () => {},
        dispose: () => {},
      };
      const files = makeFakeFilesRuntime({
        existsAbsolute: async (absPath) => absPath === targetPath,
        removeAbsolute: async () => err({ message: 'permission denied' }),
        realPathAbsolute: async (absPath) => absPath,
      });
      const svc = new WorktreeService({
        repoPath: repoDir,
        ctx,
        files,
        projectSettings: makeSettings(),
        resolveWorktreePoolPath: async () => poolDir,
      });

      const result = await svc.checkoutBranchWorktree(
        { type: 'local', branch: 'main' },
        branchName
      );

      expect(result.success).toBe(false);
      if (result.success) throw new Error('expected failure');
      expect(result.error.type).toBe('worktree-setup-failed');
      if (result.error.type !== 'worktree-setup-failed') throw new Error('expected setup failure');
      expect(result.error.cause?.message).toContain('Failed to remove stale worktree directory');
      expect(result.error.cause?.message).toContain('permission denied');
    });

    it('uses the current resolved pool path when creating a worktree', async () => {
      await git(['branch', 'task/dynamic-pool'], { cwd: repoDir });
      const updatedPool = path.join(poolDir, 'updated');
      let currentPool = path.join(poolDir, 'initial');
      const svc = makeService({
        resolveWorktreePoolPath: async () => currentPool,
      });

      currentPool = updatedPool;
      const result = await svc.checkoutBranchWorktree(
        { type: 'local', branch: 'main' },
        'task/dynamic-pool'
      );

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('expected success');
      expect(result.data).toBe(path.join(updatedPool, 'task', 'dynamic-pool'));
      expect(fs.existsSync(result.data)).toBe(true);
    });

    it('records base metadata before returning an existing valid target worktree', async () => {
      const branchName = 'task/existing-target';
      const targetPath = path.join(poolDir, branchName);
      const exec = vi.fn(async (_command: string, args: string[] = []) => {
        const key = args.join(' ');
        if (key === 'worktree prune' || key === 'worktree list --porcelain') {
          return { stdout: '', stderr: '' };
        }
        if (key === `-C ${targetPath} rev-parse --is-inside-work-tree`) {
          return { stdout: 'true\n', stderr: '' };
        }
        if (key === `config --get branch.${branchName}.base`) {
          throw Object.assign(new Error('missing config'), { code: 1 });
        }
        if (key === `config branch.${branchName}.base main`) {
          return { stdout: '', stderr: '' };
        }
        throw new Error(`Unexpected git command: git ${key}`);
      });
      const ctx: IExecutionContext = {
        root: repoDir,
        supportsLocalSpawn: false,
        exec,
        execStreaming: async () => {},
        dispose: () => {},
      };
      const files = makeFakeFilesRuntime({
        existsAbsolute: async (absPath) => {
          return absPath === targetPath || absPath === path.join(targetPath, '.git');
        },
        removeAbsolute: async () => ok(),
        realPathAbsolute: async (absPath) => absPath,
      });
      const svc = new WorktreeService({
        repoPath: repoDir,
        ctx,
        files,
        projectSettings: makeSettings(),
        resolveWorktreePoolPath: async () => poolDir,
      });

      const result = await svc.checkoutBranchWorktree(
        { type: 'local', branch: 'main' },
        branchName
      );

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('expected success');
      expect(result.data).toBe(targetPath);
      expect(exec).toHaveBeenCalledWith('git', ['config', `branch.${branchName}.base`, 'main']);
    });

    it('creates a worktree from a remote source branch when branch is not local', async () => {
      const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-remote-'));
      try {
        await git(['init', '--bare'], { cwd: remoteDir });
        await git(['remote', 'add', 'origin', remoteDir], { cwd: repoDir });
        await git(['branch', 'feature/remote-base'], { cwd: repoDir });
        await git(['push', '-u', 'origin', 'feature/remote-base'], { cwd: repoDir });
        await git(['branch', '-D', 'feature/remote-base'], { cwd: repoDir });

        const svc = makeService();
        const result = await svc.checkoutBranchWorktree(
          { type: 'remote', branch: 'feature/remote-base', remote: originRemote(remoteDir) },
          'task/from-remote'
        );

        expect(result.success).toBe(true);
        if (!result.success) throw new Error('expected success');
        expect(fs.existsSync(result.data)).toBe(true);

        const { stdout } = await git(['rev-parse', '--abbrev-ref', 'HEAD'], {
          cwd: result.data,
        });
        expect(stdout.trim()).toBe('task/from-remote');
        const baseConfig = await git(['config', '--get', 'branch.task/from-remote.base'], {
          cwd: repoDir,
        });
        expect(baseConfig.stdout.trim()).toBe('origin/feature/remote-base');
      } finally {
        fs.rmSync(remoteDir, { recursive: true, force: true });
      }
    });

    it('returns existing checked out path when branch is already checked out elsewhere', async () => {
      await git(['branch', 'feature/already-open'], { cwd: repoDir });
      const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-external-'));
      const externalPath = path.join(externalDir, 'feature-already-open');
      await git(['worktree', 'add', externalPath, 'feature/already-open'], {
        cwd: repoDir,
      });

      const svc = makeService();
      const result = await svc.checkoutBranchWorktree(
        { type: 'local', branch: 'main' },
        'feature/already-open'
      );

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('expected success');
      expect(result.data).toBe(fs.realpathSync(externalPath));

      fs.rmSync(externalDir, { recursive: true, force: true });
    });

    it('returns branch-not-found when source branch does not exist', async () => {
      const svc = makeService();

      const result = await svc.checkoutBranchWorktree(
        { type: 'local', branch: 'does-not-exist' },
        'task/no-source'
      );

      expect(result.success).toBe(false);
      if (result.success) throw new Error('expected failure');
      expect(result.error.type).toBe('branch-not-found');
    });

    it('copies preserved files into the created worktree', async () => {
      fs.writeFileSync(path.join(repoDir, '.env'), 'SECRET=abc');
      await git(['branch', 'task/env-test'], { cwd: repoDir });
      const svc = makeService({ projectSettings: makeSettings(['.env']) });

      const result = await svc.checkoutBranchWorktree(
        { type: 'local', branch: 'main' },
        'task/env-test'
      );

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('expected success');
      expect(fs.readFileSync(path.join(result.data, '.env'), 'utf8')).toBe('SECRET=abc');
    });

    it('skips preserve patterns that can escape the source repo or target worktree', async () => {
      fs.writeFileSync(path.join(repoDir, '.env'), 'SECRET=abc');
      const parentSecret = path.join(path.dirname(repoDir), 'preserve-secret.txt');
      const absoluteSecret = path.join(os.tmpdir(), `preserve-secret-${Date.now()}.txt`);
      fs.writeFileSync(parentSecret, 'parent-secret');
      fs.writeFileSync(absoluteSecret, 'absolute-secret');
      await git(['branch', 'task/safe-preserve'], { cwd: repoDir });
      const svc = makeService({
        projectSettings: makeSettings(['.env', '../preserve-secret.txt', absoluteSecret]),
      });

      try {
        const result = await svc.checkoutBranchWorktree(
          { type: 'local', branch: 'main' },
          'task/safe-preserve'
        );

        expect(result.success).toBe(true);
        if (!result.success) throw new Error('expected success');
        expect(fs.readFileSync(path.join(result.data, '.env'), 'utf8')).toBe('SECRET=abc');
        expect(fs.existsSync(path.join(path.dirname(result.data), 'preserve-secret.txt'))).toBe(
          false
        );
        expect(fs.existsSync(path.join(result.data, path.basename(absoluteSecret)))).toBe(false);
      } finally {
        fs.rmSync(parentSecret, { force: true });
        fs.rmSync(absoluteSecret, { force: true });
      }
    });
  });

  describe('removeWorktree', () => {
    it('prunes git worktree metadata when directory removal fails', async () => {
      const worktreePath = path.join(poolDir, 'task', 'stuck-remove');
      const exec = vi.fn(async () => ({ stdout: '', stderr: '' }));
      const ctx: IExecutionContext = {
        root: repoDir,
        supportsLocalSpawn: false,
        exec,
        execStreaming: async () => {},
        dispose: () => {},
      };
      const files = makeFakeFilesRuntime({
        existsAbsolute: async () => false,
        removeAbsolute: async () => err({ message: 'permission denied' }),
        realPathAbsolute: async (absPath) => absPath,
      });
      const svc = new WorktreeService({
        repoPath: repoDir,
        ctx,
        files,
        projectSettings: makeSettings(),
        resolveWorktreePoolPath: async () => poolDir,
      });
      exec.mockClear();

      await expect(svc.removeWorktree(worktreePath)).rejects.toThrow(
        'Failed to remove stale worktree directory'
      );

      expect(exec).toHaveBeenCalledWith('git', ['worktree', 'prune']);
    });

    it('treats an already absent generated worktree as success and still prunes metadata', async () => {
      const exec = vi.fn(async () => ({ stdout: '', stderr: '' }));
      const service = new WorktreeService({
        repoPath: repoDir,
        ctx: {
          root: repoDir,
          supportsLocalSpawn: false,
          exec,
          execStreaming: async () => {},
          dispose: () => {},
        },
        files: makeFakeFilesRuntime({ existsAbsolute: async () => false }),
        projectSettings: makeSettings(),
        resolveWorktreePoolPath: async () => poolDir,
      });
      exec.mockClear();

      await expect(
        service.removeGeneratedWorktreeIfPresent(path.join(poolDir, 'missing'), {
          expectedBranchName: 'missing',
          expectedHead: null,
        })
      ).resolves.toEqual({ success: true, data: { removed: false } });
      expect(exec).toHaveBeenCalledWith('git', ['worktree', 'prune'], {
        timeout: 120_000,
      });
    });

    it('fails closed when remote filesystem presence cannot be determined', async () => {
      const exec = vi.fn(async () => ({ stdout: '', stderr: '' }));
      const service = new WorktreeService({
        repoPath: '/remote/repo',
        ctx: {
          root: '/remote/repo',
          supportsLocalSpawn: false,
          exec,
          execStreaming: async () => {},
          dispose: () => {},
        },
        files: makeFakeFilesRuntime({
          existsAbsoluteResult: async (absPath) =>
            err({
              type: 'fs-error',
              path: absPath,
              message: 'SSH filesystem unavailable',
            }),
        }),
        projectSettings: makeSettings(),
        resolveWorktreePoolPath: async () => '/remote/worktrees/project',
      });
      exec.mockClear();

      await expect(
        service.removeGeneratedWorktreeIfPresent('/remote/worktrees/project/loop', {
          expectedBranchName: 'loop',
          expectedHead: null,
        })
      ).resolves.toEqual({
        success: false,
        error: {
          type: 'worktree-remove-failed',
          message: 'Generated worktree presence could not be verified.',
        },
      });
      expect(exec).not.toHaveBeenCalledWith('git', ['worktree', 'prune']);
    });

    it('removes only the exact canonical generated worktree attested by branch and head', async () => {
      const commit = (await git(['rev-parse', 'HEAD'], { cwd: repoDir })).stdout.trim();
      const branch = 'emdash/loop-cleanup-owned';
      const service = makeService();
      const created = await service.createWorktreeAtCommit(commit, branch);
      if (!created.success) throw new Error('expected generated worktree');

      await expect(
        service.removeGeneratedWorktreeIfPresent(created.data, {
          expectedBranchName: branch,
          expectedHead: commit,
        })
      ).resolves.toEqual({ success: true, data: { removed: true } });
      expect(fs.existsSync(created.data)).toBe(false);
      await expect(
        git(['rev-parse', `refs/heads/${branch}`], { cwd: repoDir })
      ).resolves.toMatchObject({ stdout: `${commit}\n` });
    });

    it('preserves a foreign worktree when expected branch or head attestation differs', async () => {
      const commit = (await git(['rev-parse', 'HEAD'], { cwd: repoDir })).stdout.trim();
      const branch = 'emdash/loop-cleanup-foreign';
      const service = makeService();
      const created = await service.createWorktreeAtCommit(commit, branch);
      if (!created.success) throw new Error('expected generated worktree');
      fs.writeFileSync(path.join(created.data, 'foreign.txt'), 'foreign bytes');

      await expect(
        service.removeGeneratedWorktreeIfPresent(created.data, {
          expectedBranchName: branch,
          expectedHead: 'f'.repeat(40),
        })
      ).resolves.toMatchObject({
        success: false,
        error: { type: 'worktree-remove-failed' },
      });
      expect(fs.readFileSync(path.join(created.data, 'foreign.txt'), 'utf8')).toBe('foreign bytes');
      expect(await git(['rev-parse', `refs/heads/${branch}`], { cwd: repoDir })).toMatchObject({
        stdout: `${commit}\n`,
      });
    });

    it('rejects a replacement repository occupying a stale canonical worktree path', async () => {
      const commit = (await git(['rev-parse', 'HEAD'], { cwd: repoDir })).stdout.trim();
      const branch = 'emdash/loop-replacement-repo';
      const service = makeService();
      const created = await service.createWorktreeAtCommit(commit, branch);
      if (!created.success) throw new Error('expected generated worktree');
      fs.rmSync(created.data, { recursive: true, force: true });
      fs.mkdirSync(created.data, { recursive: true });
      await git(['init'], { cwd: created.data });
      await git(['config', 'user.email', 'test@test.com'], { cwd: created.data });
      await git(['config', 'user.name', 'Test'], { cwd: created.data });
      await git(['fetch', repoDir, commit], { cwd: created.data });
      await git(['symbolic-ref', 'HEAD', `refs/heads/${branch}`], { cwd: created.data });
      await git(['reset', '--hard', commit], { cwd: created.data });
      fs.writeFileSync(path.join(created.data, 'foreign.txt'), 'foreign repository bytes');

      await expect(service.attestGeneratedWorktree(created.data, branch)).resolves.toMatchObject({
        success: false,
        error: { type: 'invalid-generated-worktree' },
      });
      await expect(
        service.removeGeneratedWorktreeIfPresent(created.data, {
          expectedBranchName: branch,
          expectedHead: commit,
        })
      ).resolves.toMatchObject({
        success: false,
        error: { type: 'worktree-remove-failed' },
      });
      expect(fs.readFileSync(path.join(created.data, 'foreign.txt'), 'utf8')).toBe(
        'foreign repository bytes'
      );
    });
  });

  describe('checkoutExistingBranch', () => {
    it('returns existing checked out path when branch is already checked out elsewhere', async () => {
      await git(['branch', 'feature/already-open-existing'], { cwd: repoDir });
      const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-external-'));
      const externalPath = path.join(externalDir, 'feature-already-open-existing');
      await git(['worktree', 'add', externalPath, 'feature/already-open-existing'], {
        cwd: repoDir,
      });

      const svc = makeService();
      const result = await svc.checkoutExistingBranch('feature/already-open-existing');

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('expected success');
      expect(result.data).toBe(fs.realpathSync(externalPath));

      fs.rmSync(externalDir, { recursive: true, force: true });
    });

    it('creates local branch from remote when needed', async () => {
      const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-remote-'));
      try {
        await git(['init', '--bare'], { cwd: remoteDir });
        await git(['remote', 'add', 'origin', remoteDir], { cwd: repoDir });
        await git(['branch', 'feature/from-remote'], { cwd: repoDir });
        await git(['push', '-u', 'origin', 'feature/from-remote'], { cwd: repoDir });
        await git(['branch', '-D', 'feature/from-remote'], { cwd: repoDir });

        const svc = makeService();
        const result = await svc.checkoutExistingBranch('feature/from-remote');

        expect(result.success).toBe(true);
        if (!result.success) throw new Error('expected success');
        expect(fs.existsSync(result.data)).toBe(true);
      } finally {
        fs.rmSync(remoteDir, { recursive: true, force: true });
      }
    }, 15_000);
  });
});
