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
        exists: async (absPath: string) => ok(await (options.existsAbsolute?.(absPath) ?? false)),
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
  });

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
      expect(String(result.error.cause)).toContain('Failed to remove stale worktree directory');
      expect(String(result.error.cause)).toContain('permission denied');
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
