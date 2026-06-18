import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { GitRemote } from '@emdash/core/git';
import { ok } from '@emdash/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { ProjectSettingsProvider } from '../settings/provider';
import { LocalWorktreeHost } from './hosts/local-worktree-host';
import type { WorktreeHost } from './hosts/worktree-host';
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

describe('WorktreeService', () => {
  let repoDir: string;
  let poolDir: string;
  let host: WorktreeHost;

  beforeEach(async () => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-repo-'));
    poolDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-pool-'));
    await initRepo(repoDir);
    host = await LocalWorktreeHost.create({
      allowedRoots: [repoDir, poolDir],
    });
  });

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    fs.rmSync(poolDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
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
      host,
      projectSettings: overrides.projectSettings ?? makeSettings(),
      resolveWorktreePoolPath: overrides.resolveWorktreePoolPath ?? (async () => worktreePoolPath),
    });
  }

  it('uses the host path API for worktree paths', async () => {
    const remoteHost: WorktreeHost = {
      existsAbsolute: vi.fn().mockResolvedValue(false),
      mkdirAbsolute: vi.fn().mockResolvedValue(undefined),
      removeAbsolute: vi.fn().mockResolvedValue({ success: true }),
      realPathAbsolute: vi.fn().mockResolvedValue('/remote/worktrees/project'),
      globAbsolute: vi.fn().mockResolvedValue([]),
      readFileAbsolute: vi.fn().mockResolvedValue(''),
      copyFileAbsolute: vi.fn().mockResolvedValue(undefined),
      statAbsolute: vi.fn().mockResolvedValue(null),
      pathApi: {
        join: (...segments: string[]) => `host:${path.posix.join(...segments)}`,
        dirname: (input: string) => `host-dir:${path.posix.dirname(input.replace(/^host:/, ''))}`,
      },
    };
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
      host: remoteHost,
      projectSettings: makeSettings(),
      resolveWorktreePoolPath: async () => '/remote/worktrees/project',
    });

    await expect(svc.getWorktree('emdash/task-abc')).resolves.toBeUndefined();

    expect(remoteHost.existsAbsolute).toHaveBeenCalledWith(
      'host:/remote/worktrees/project/emdash/task-abc'
    );

    const checkoutResult = await svc.checkoutBranchWorktree(
      { type: 'local', branch: 'main' },
      'emdash/task-created'
    );

    expect(checkoutResult.success).toBe(true);
    expect(remoteHost.mkdirAbsolute).toHaveBeenCalledWith(
      'host-dir:/remote/worktrees/project/emdash',
      { recursive: true }
    );
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
      const fakeHost: WorktreeHost = {
        pathApi: path,
        existsAbsolute: vi.fn(async (absPath: string) => absPath === targetPath),
        mkdirAbsolute: vi.fn(async () => {}),
        removeAbsolute: vi.fn(async () => ({ success: false, error: 'permission denied' })),
        realPathAbsolute: vi.fn(async (absPath: string) => absPath),
        globAbsolute: vi.fn(async () => []),
        readFileAbsolute: vi.fn(async () => ''),
        copyFileAbsolute: vi.fn(async () => {}),
        statAbsolute: vi.fn(async () => null),
      };
      const svc = new WorktreeService({
        repoPath: repoDir,
        ctx,
        host: fakeHost,
        projectSettings: makeSettings(),
        resolveWorktreePoolPath: async () => poolDir,
      });

      await expect(svc.getWorktree(branchName)).resolves.toBeUndefined();

      expect(fakeHost.removeAbsolute).toHaveBeenCalledWith(targetPath, { recursive: true });
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
      const fakeHost: WorktreeHost = {
        pathApi: path,
        existsAbsolute: vi.fn(async (absPath: string) => absPath === targetPath),
        mkdirAbsolute: vi.fn(async () => {}),
        removeAbsolute: vi.fn(async () => ({ success: false, error: 'permission denied' })),
        realPathAbsolute: vi.fn(async (absPath: string) => absPath),
        globAbsolute: vi.fn(async () => []),
        readFileAbsolute: vi.fn(async () => ''),
        copyFileAbsolute: vi.fn(async () => {}),
        statAbsolute: vi.fn(async () => null),
      };
      const svc = new WorktreeService({
        repoPath: repoDir,
        ctx,
        host: fakeHost,
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

    it('creates a resumed worktree at the persisted path outside the current pool', async () => {
      const branchName = 'task/resume-persisted';
      await git(['branch', branchName], { cwd: repoDir });
      const persistedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-persisted-'));
      const persistedPath = path.join(persistedRoot, 'task', 'resume-persisted');
      const svc = makeService();

      const result = await svc.serveBranchWorktreeAtPath(branchName, undefined, persistedPath);

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('expected success');
      expect(result.data).toBe(persistedPath);
      expect(fs.existsSync(path.join(persistedPath, '.git'))).toBe(true);
      expect(fs.existsSync(path.join(poolDir, 'task', 'resume-persisted'))).toBe(false);

      await git(['worktree', 'remove', '--force', persistedPath], { cwd: repoDir });
      fs.rmSync(persistedRoot, { recursive: true, force: true });
    });

    it('does not remove a stale persisted directory outside the current pool', async () => {
      const branchName = 'task/resume-stale-persisted';
      await git(['branch', branchName], { cwd: repoDir });
      const persistedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-persisted-'));
      const persistedPath = path.join(persistedRoot, 'task', 'resume-stale-persisted');
      fs.mkdirSync(path.join(persistedPath, 'node_modules'), { recursive: true });
      fs.writeFileSync(path.join(persistedPath, 'node_modules', 'stale.txt'), 'stale');
      const svc = makeService();

      const result = await svc.serveBranchWorktreeAtPath(branchName, undefined, persistedPath);

      expect(result.success).toBe(false);
      if (result.success) throw new Error('expected failure');
      expect(result.error.type).toBe('worktree-setup-failed');
      expect(fs.existsSync(path.join(persistedPath, 'node_modules', 'stale.txt'))).toBe(true);

      fs.rmSync(persistedRoot, { recursive: true, force: true });
    });

    it('repairs a stale persisted directory inside the current pool', async () => {
      const branchName = 'task/resume-stale-pool';
      await git(['branch', branchName], { cwd: repoDir });
      const persistedPath = path.join(poolDir, 'task', 'resume-stale-pool');
      fs.mkdirSync(path.join(persistedPath, 'node_modules'), { recursive: true });
      fs.writeFileSync(path.join(persistedPath, 'node_modules', 'stale.txt'), 'stale');
      const svc = makeService();

      const result = await svc.serveBranchWorktreeAtPath(branchName, undefined, persistedPath);

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('expected success');
      expect(result.data).toBe(persistedPath);
      expect(fs.existsSync(path.join(persistedPath, '.git'))).toBe(true);
      expect(fs.existsSync(path.join(persistedPath, 'node_modules'))).toBe(false);

      await git(['worktree', 'remove', '--force', persistedPath], { cwd: repoDir });
    });

    it('does not remove a stale persisted directory inside the current pool when it contains user files', async () => {
      const branchName = 'task/resume-stale-pool-with-changes';
      await git(['branch', branchName], { cwd: repoDir });
      const persistedPath = path.join(poolDir, 'task', 'resume-stale-pool-with-changes');
      const userFile = path.join(persistedPath, 'notes.txt');
      fs.mkdirSync(persistedPath, { recursive: true });
      fs.writeFileSync(userFile, 'do not delete');
      const svc = makeService();

      const result = await svc.serveBranchWorktreeAtPath(branchName, undefined, persistedPath);

      expect(result.success).toBe(false);
      if (result.success) throw new Error('expected failure');
      expect(result.error.type).toBe('worktree-setup-failed');
      expect(fs.readFileSync(userFile, 'utf8')).toBe('do not delete');
      expect(fs.existsSync(path.join(persistedPath, '.git'))).toBe(false);

      fs.rmSync(persistedPath, { recursive: true, force: true });
    });

    it('keeps uncommitted changes in a valid persisted worktree', async () => {
      const branchName = 'task/resume-valid-with-changes';
      await git(['branch', branchName], { cwd: repoDir });
      const persistedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-persisted-'));
      const persistedPath = path.join(persistedRoot, 'task', 'resume-valid-with-changes');
      await git(['worktree', 'add', persistedPath, branchName], { cwd: repoDir });
      const changedFile = path.join(persistedPath, 'notes.txt');
      fs.writeFileSync(changedFile, 'keep me');
      const svc = makeService();

      const result = await svc.serveBranchWorktreeAtPath(branchName, undefined, persistedPath);

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('expected success');
      expect(result.data).toBe(persistedPath);
      expect(fs.readFileSync(changedFile, 'utf8')).toBe('keep me');

      await git(['worktree', 'remove', '--force', persistedPath], { cwd: repoDir });
      fs.rmSync(persistedRoot, { recursive: true, force: true });
    });

    it('moves a branch from the current pool back to the persisted resume path', async () => {
      const branchName = 'task/resume-move-back';
      await git(['branch', branchName], { cwd: repoDir });
      const persistedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-persisted-'));
      const persistedPath = path.join(persistedRoot, 'task', 'resume-move-back');
      const svc = makeService();
      const currentPoolResult = await svc.checkoutExistingBranch(branchName);
      expect(currentPoolResult.success).toBe(true);
      if (!currentPoolResult.success) throw new Error('expected success');

      const result = await svc.serveBranchWorktreeAtPath(branchName, undefined, persistedPath);

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('expected success');
      expect(result.data).toBe(persistedPath);
      expect(fs.existsSync(path.join(persistedPath, '.git'))).toBe(true);
      expect(fs.existsSync(currentPoolResult.data)).toBe(false);

      await git(['worktree', 'remove', '--force', persistedPath], { cwd: repoDir });
      fs.rmSync(persistedRoot, { recursive: true, force: true });
    });

    it('does not move a branch from an unrelated external worktree to the persisted path', async () => {
      const branchName = 'task/resume-external';
      await git(['branch', branchName], { cwd: repoDir });
      const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-external-'));
      const persistedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-persisted-'));
      const externalPath = path.join(externalRoot, 'task', 'resume-external');
      const persistedPath = path.join(persistedRoot, 'task', 'resume-external');
      await git(['worktree', 'add', externalPath, branchName], { cwd: repoDir });
      const svc = makeService();

      const result = await svc.serveBranchWorktreeAtPath(branchName, undefined, persistedPath);

      expect(result.success).toBe(false);
      if (result.success) throw new Error('expected failure');
      expect(result.error.type).toBe('worktree-setup-failed');
      expect(fs.existsSync(path.join(externalPath, '.git'))).toBe(true);
      expect(fs.existsSync(persistedPath)).toBe(false);

      await git(['worktree', 'remove', '--force', externalPath], { cwd: repoDir });
      fs.rmSync(externalRoot, { recursive: true, force: true });
      fs.rmSync(persistedRoot, { recursive: true, force: true });
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
      const fakeHost: WorktreeHost = {
        pathApi: path,
        existsAbsolute: vi.fn(async (absPath: string) => {
          return absPath === targetPath || absPath === path.join(targetPath, '.git');
        }),
        mkdirAbsolute: vi.fn(async () => {}),
        removeAbsolute: vi.fn(async () => ({ success: true })),
        realPathAbsolute: vi.fn(async (absPath: string) => absPath),
        globAbsolute: vi.fn(async () => []),
        readFileAbsolute: vi.fn(async () => ''),
        copyFileAbsolute: vi.fn(async () => {}),
        statAbsolute: vi.fn(async () => null),
      };
      const svc = new WorktreeService({
        repoPath: repoDir,
        ctx,
        host: fakeHost,
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
      const fakeHost: WorktreeHost = {
        pathApi: path,
        existsAbsolute: vi.fn(async () => false),
        mkdirAbsolute: vi.fn(async () => {}),
        removeAbsolute: vi.fn(async () => ({ success: false, error: 'permission denied' })),
        realPathAbsolute: vi.fn(async (absPath: string) => absPath),
        globAbsolute: vi.fn(async () => []),
        readFileAbsolute: vi.fn(async () => ''),
        copyFileAbsolute: vi.fn(async () => {}),
        statAbsolute: vi.fn(async () => null),
      };
      const svc = new WorktreeService({
        repoPath: repoDir,
        ctx,
        host: fakeHost,
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
