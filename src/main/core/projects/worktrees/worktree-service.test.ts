import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Remote } from '@shared/git';
import { ok } from '@shared/result';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { getLocalExec, type ExecFn } from '@main/core/utils/exec';
import type { ProjectSettingsProvider } from '../settings/schema';
import { WorktreeService } from './worktree-service';

async function initRepo(dir: string, exec: ExecFn): Promise<void> {
  await exec('git', ['init'], { cwd: dir });
  await exec('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: dir });
  await exec('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  await exec('git', ['config', 'user.name', 'Test'], { cwd: dir });
  await exec('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir });
}

function makeSettings(preservePatterns: string[] = []): ProjectSettingsProvider {
  return {
    get: async () => ({ preservePatterns }),
    update: async () => ok(),
    ensure: async () => {},
    getWorktreeDirectory: async () => '',
    getDefaultBranch: async () => 'main',
    getRemote: async () => 'origin',
  } as ProjectSettingsProvider;
}

const originRemote = (url = 'ssh://example.com/repo.git'): Remote => ({ name: 'origin', url });

describe('WorktreeService', () => {
  let repoDir: string;
  let poolDir: string;
  let exec: ExecFn;

  beforeEach(async () => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-repo-'));
    poolDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-pool-'));
    exec = getLocalExec();
    await initRepo(repoDir, exec);
  });

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
    fs.rmSync(poolDir, { recursive: true, force: true });
  });

  function makeService(
    overrides: Partial<{
      worktreePoolPath: string;
      repoPath: string;
      exec: ExecFn;
      projectSettings: ProjectSettingsProvider;
    }> = {}
  ): WorktreeService {
    return new WorktreeService({
      worktreePoolPath: poolDir,
      repoPath: repoDir,
      exec,
      rootFs: new LocalFileSystem('/'),
      projectSettings: makeSettings(),
      ...overrides,
    });
  }

  describe('checkoutBranchWorktree', () => {
    it('creates a worktree from an existing local source branch', async () => {
      await exec('git', ['branch', 'task/local-checkout'], { cwd: repoDir });
      const svc = makeService();

      const result = await svc.checkoutBranchWorktree(
        { type: 'local', branch: 'main' },
        'task/local-checkout'
      );

      expect(result.success).toBe(true);
      if (!result.success) throw new Error('expected success');
      expect(result.data).toBe(path.join(poolDir, 'task', 'local-checkout'));
      expect(fs.existsSync(result.data)).toBe(true);
    });

    it('creates a worktree from a remote source branch when branch is not local', async () => {
      const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-remote-'));
      try {
        await exec('git', ['init', '--bare'], { cwd: remoteDir });
        await exec('git', ['remote', 'add', 'origin', remoteDir], { cwd: repoDir });
        await exec('git', ['branch', 'feature/remote-base'], { cwd: repoDir });
        await exec('git', ['push', '-u', 'origin', 'feature/remote-base'], { cwd: repoDir });
        await exec('git', ['branch', '-D', 'feature/remote-base'], { cwd: repoDir });

        const svc = makeService();
        const result = await svc.checkoutBranchWorktree(
          { type: 'remote', branch: 'feature/remote-base', remote: originRemote(remoteDir) },
          'task/from-remote'
        );

        expect(result.success).toBe(true);
        if (!result.success) throw new Error('expected success');
        expect(fs.existsSync(result.data)).toBe(true);

        const { stdout } = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
          cwd: result.data,
        });
        expect(stdout.trim()).toBe('task/from-remote');
      } finally {
        fs.rmSync(remoteDir, { recursive: true, force: true });
      }
    });

    it('returns existing checked out path when branch is already checked out elsewhere', async () => {
      await exec('git', ['branch', 'feature/already-open'], { cwd: repoDir });
      const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-external-'));
      const externalPath = path.join(externalDir, 'feature-already-open');
      await exec('git', ['worktree', 'add', externalPath, 'feature/already-open'], {
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
      await exec('git', ['branch', 'task/env-test'], { cwd: repoDir });
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

  describe('checkoutExistingBranch', () => {
    it('returns existing checked out path when branch is already checked out elsewhere', async () => {
      await exec('git', ['branch', 'feature/already-open-existing'], { cwd: repoDir });
      const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-external-'));
      const externalPath = path.join(externalDir, 'feature-already-open-existing');
      await exec('git', ['worktree', 'add', externalPath, 'feature/already-open-existing'], {
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
        await exec('git', ['init', '--bare'], { cwd: remoteDir });
        await exec('git', ['remote', 'add', 'origin', remoteDir], { cwd: repoDir });
        await exec('git', ['branch', 'feature/from-remote'], { cwd: repoDir });
        await exec('git', ['push', '-u', 'origin', 'feature/from-remote'], { cwd: repoDir });
        await exec('git', ['branch', '-D', 'feature/from-remote'], { cwd: repoDir });

        const svc = makeService();
        const result = await svc.checkoutExistingBranch('feature/from-remote');

        expect(result.success).toBe(true);
        if (!result.success) throw new Error('expected success');
        expect(fs.existsSync(result.data)).toBe(true);
      } finally {
        fs.rmSync(remoteDir, { recursive: true, force: true });
      }
    });
  });
});
