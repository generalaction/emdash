import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getLocalExec, type ExecFn } from '@main/core/utils/exec';
import type { ProjectSettingsProvider } from '../settings/schema';
import { WorktreeService } from './worktree-service';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

async function initRepo(dir: string, exec: ExecFn): Promise<void> {
  await exec('git', ['init'], { cwd: dir });
  // Force "main" as the initial branch regardless of system git config.
  await exec('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: dir });
  await exec('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
  await exec('git', ['config', 'user.name', 'Test'], { cwd: dir });
  // A commit is required before worktrees or additional branches can be created.
  await exec('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir });
}

function makeSettings(preservePatterns: string[] = []): ProjectSettingsProvider {
  return {
    get: async () => ({ preservePatterns }),
    update: async () => {},
    ensure: async () => {},
    getWorktreeDirectory: async () => '',
  } as ProjectSettingsProvider;
}

async function listWorktrees(repoDir: string, exec: ExecFn): Promise<string[]> {
  const { stdout } = await exec('git', ['worktree', 'list', '--porcelain'], { cwd: repoDir });
  return stdout
    .trim()
    .split(/\n\n/)
    .filter(Boolean)
    .map((block) => {
      const line = block.split('\n').find((l) => l.startsWith('worktree '));
      return line ? line.slice('worktree '.length) : '';
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

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
      defaultBranch: string;
      repoPath: string;
      exec: ExecFn;
      projectSettings: ProjectSettingsProvider;
    }> = {}
  ): WorktreeService {
    return new WorktreeService({
      worktreePoolPath: poolDir,
      defaultBranch: 'main',
      repoPath: repoDir,
      exec,
      projectSettings: makeSettings(),
      ...overrides,
    });
  }

  // -------------------------------------------------------------------------
  // ensureReserve / createReserve
  // -------------------------------------------------------------------------

  describe('ensureReserve', () => {
    it('creates reserve worktree and branch from scratch', async () => {
      const svc = makeService();
      await svc.ensureReserve('main');

      const reservePath = path.join(poolDir, '_reserve-main');
      expect(fs.existsSync(reservePath)).toBe(true);

      // The reserve branch must be registered in git
      const { stdout } = await exec('git', ['rev-parse', '--verify', '_reserve-main'], {
        cwd: repoDir,
      });
      expect(stdout.trim()).toBeTruthy();
    });

    it('is idempotent — calling twice does not throw or duplicate the worktree', async () => {
      const svc = makeService();
      await svc.ensureReserve('main');
      await svc.ensureReserve('main'); // second call — must be a no-op

      const worktrees = await listWorktrees(repoDir, exec);
      const reserveEntries = worktrees.filter((p) => p.endsWith('_reserve-main'));
      expect(reserveEntries).toHaveLength(1);
    });

    it('deduplicates concurrent calls via reserveInProgress map', async () => {
      const svc = makeService();
      // Fire three simultaneous calls (the constructor also fires one in the background).
      await Promise.all([
        svc.ensureReserve('main'),
        svc.ensureReserve('main'),
        svc.ensureReserve('main'),
      ]);

      const worktrees = await listWorktrees(repoDir, exec);
      const reserveEntries = worktrees.filter((p) => p.endsWith('_reserve-main'));
      expect(reserveEntries).toHaveLength(1);
    });

    it('re-adds worktree when branch exists but directory was deleted (stale branch)', async () => {
      // Regression: previously failed with "branch already exists" because createReserve
      // attempted `worktree add -b` even when the branch was already present.
      const svc = makeService();
      await svc.ensureReserve('main');

      const reservePath = path.join(poolDir, '_reserve-main');
      // Simulate accidental directory deletion without a proper worktree remove.
      fs.rmSync(reservePath, { recursive: true, force: true });
      // Prune stale git worktree entry so git no longer considers the branch checked out.
      await exec('git', ['worktree', 'prune'], { cwd: repoDir });

      // Now the branch exists but has no live worktree — ensureReserve must recover.
      await svc.ensureReserve('main');
      expect(fs.existsSync(reservePath)).toBe(true);
    });

    it('migrates reserve from old pool path to new pool path (pool path changed)', async () => {
      // Regression: previously failed with "already checked out at <old-path>" after the
      // worktree pool was reorganised to include a per-project subdirectory.
      const poolA = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-pool-a-'));
      const poolB = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-pool-b-'));

      try {
        const svc1 = makeService({ worktreePoolPath: poolA });
        await svc1.ensureReserve('main');
        expect(fs.existsSync(path.join(poolA, '_reserve-main'))).toBe(true);

        // New service uses poolB — must detect the branch is checked out at poolA
        // and move it rather than trying to create a fresh worktree.
        const svc2 = makeService({ worktreePoolPath: poolB });
        await svc2.ensureReserve('main');

        expect(fs.existsSync(path.join(poolB, '_reserve-main'))).toBe(true);
        expect(fs.existsSync(path.join(poolA, '_reserve-main'))).toBe(false);
      } finally {
        fs.rmSync(poolA, { recursive: true, force: true });
        fs.rmSync(poolB, { recursive: true, force: true });
      }
    });

    it('recovers from a stale directory that exists on disk but is not a registered git worktree', async () => {
      // Regression: previously claimReserve would call `git worktree move` on the stale
      // directory and fail with "is not a working tree".
      const svc = makeService();
      await svc.ensureReserve('main');

      const reservePath = path.join(poolDir, '_reserve-main');
      // Remove the worktree registration from git (keeps the branch, removes tracking).
      await exec('git', ['worktree', 'remove', '--force', reservePath], { cwd: repoDir });
      // Leave behind an empty directory to simulate a stale/orphaned path.
      await fs.promises.mkdir(reservePath, { recursive: true });

      // ensureReserve must detect the stale directory, clean it up, and recreate properly.
      await svc.ensureReserve('main');

      // The directory must now be a valid, git-tracked worktree.
      const { stdout } = await exec('git', ['rev-parse', '--git-dir'], { cwd: reservePath });
      expect(stdout.trim()).toBeTruthy();
    });

    it('handles a sourceBranch that contains slashes (e.g. feature/main)', async () => {
      // Slashes in branch names are slugified to dashes so the reserve lives as a
      // flat directory under the pool rather than creating nested subdirectories.
      await exec('git', ['branch', 'feature/main'], { cwd: repoDir });

      const svc = makeService();
      await svc.ensureReserve('feature/main');

      // Reserve lives at poolDir/_reserve-feature-main (slash → dash, flat path)
      const reservePath = path.join(poolDir, '_reserve-feature-main');
      expect(fs.existsSync(reservePath)).toBe(true);
    });

    it('serializes concurrent ensureReserve calls for different branches', async () => {
      // Regression: two simultaneous git worktree add commands on the same repo can
      // race on git ref/lock files and fail. The gitOpQueue must serialize them.
      await exec('git', ['branch', 'other'], { cwd: repoDir });

      const svc = makeService();
      await Promise.all([svc.ensureReserve('main'), svc.ensureReserve('other')]);

      expect(fs.existsSync(path.join(poolDir, '_reserve-main'))).toBe(true);
      expect(fs.existsSync(path.join(poolDir, '_reserve-other'))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // claimReserve
  // -------------------------------------------------------------------------

  describe('claimReserve', () => {
    it('claims the reserve and returns the target worktree path', async () => {
      const svc = makeService();
      const result = await svc.claimReserve('main', 'emdash/mytask-abc', {
        syncWithRemote: false,
      });

      expect(result).toBe(path.join(poolDir, 'emdash', 'mytask-abc'));
      expect(fs.existsSync(result)).toBe(true);
    });

    it('creates parent directory for branch names with slashes', async () => {
      // Regression: git worktree move does not create intermediate directories.
      // The parent of poolDir/emdash/mytask-xyz must be created before the move.
      const svc = makeService();
      const result = await svc.claimReserve('main', 'emdash/mytask-xyz', {
        syncWithRemote: false,
      });

      expect(fs.existsSync(result)).toBe(true);
      expect(fs.existsSync(path.join(poolDir, 'emdash'))).toBe(true);
    });

    it('auto-creates reserve when called without a prior ensureReserve', async () => {
      const svc = makeService();
      // Do NOT call ensureReserve — claimReserve must create the reserve on demand.
      const result = await svc.claimReserve('main', 'task/demand-test', {
        syncWithRemote: false,
      });

      expect(fs.existsSync(result)).toBe(true);
    });

    it('replenishes the default-branch reserve after claiming it', async () => {
      const svc = makeService();
      await svc.claimReserve('main', 'task/replenish-test', { syncWithRemote: false });

      // The background replenishment is fire-and-forget; calling ensureReserve
      // joins the in-progress promise or finds it already complete.
      await svc.ensureReserve('main');

      expect(fs.existsSync(path.join(poolDir, '_reserve-main'))).toBe(true);
    });

    it('replenishes reserve when sourceBranch matches the defaultBranch (bare name equality check)', async () => {
      // Regression: when defaultBranch was "origin/main" but sourceBranch was "main"
      // the equality check (sourceBranch === this.defaultBranch) never fired.
      // With the fix, defaultBranch is always the bare name so replenishment works.
      const svc = makeService({ defaultBranch: 'main' });
      await svc.claimReserve('main', 'task/replenish-equality', { syncWithRemote: false });

      // Join any in-progress background replenishment.
      await svc.ensureReserve('main');

      expect(fs.existsSync(path.join(poolDir, '_reserve-main'))).toBe(true);
    });

    it('does not replenish reserve when sourceBranch is not the default branch', async () => {
      await exec('git', ['branch', 'other'], { cwd: repoDir });

      const svc = makeService();
      await svc.ensureReserve('other');
      await svc.claimReserve('other', 'task/other-task', { syncWithRemote: false });

      // No automatic replenishment for non-default branches.
      // The reserve path should not exist at this point.
      await new Promise((r) => setTimeout(r, 50)); // give any background work a moment
      expect(fs.existsSync(path.join(poolDir, '_reserve-other'))).toBe(false);
    });

    it('silently swallows fetch and reset errors when syncWithRemote=true and no remote', async () => {
      // The fetch origin and reset --hard origin/X calls both have .catch(() => {}).
      // This test verifies those errors are swallowed and the claim succeeds.
      const svc = makeService();
      await expect(
        svc.claimReserve('main', 'task/no-remote', { syncWithRemote: true })
      ).resolves.toBeTruthy();
    });

    it('copies preserved files into the claimed worktree', async () => {
      fs.writeFileSync(path.join(repoDir, '.env'), 'SECRET=abc');

      const svc = makeService({ projectSettings: makeSettings(['.env']) });
      const result = await svc.claimReserve('main', 'task/env-test', {
        syncWithRemote: false,
      });

      expect(fs.existsSync(path.join(result, '.env'))).toBe(true);
      expect(fs.readFileSync(path.join(result, '.env'), 'utf8')).toBe('SECRET=abc');
    });

    it('copies preserved files in nested subdirectories', async () => {
      fs.mkdirSync(path.join(repoDir, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(repoDir, '.claude', 'settings.json'), '{}');

      const svc = makeService({ projectSettings: makeSettings(['.claude/**']) });
      const result = await svc.claimReserve('main', 'task/nested-env', {
        syncWithRemote: false,
      });

      expect(fs.existsSync(path.join(result, '.claude', 'settings.json'))).toBe(true);
    });

    it('completes silently when preserve pattern matches no files', async () => {
      const svc = makeService({ projectSettings: makeSettings(['.env.nonexistent']) });
      await expect(
        svc.claimReserve('main', 'task/no-match', { syncWithRemote: false })
      ).resolves.toBeTruthy();
    });

    it('recovers when reserve directory is stale (exists on disk but not tracked by git)', async () => {
      // Regression: previously failed with "fatal: '..._reserve-main' is not a working tree"
      // because claimReserve only checked fs.existsSync and skipped ensureReserve entirely.
      const svc = makeService();
      await svc.ensureReserve('main');

      const reservePath = path.join(poolDir, '_reserve-main');
      // Unregister the worktree from git and recreate an empty stale directory.
      await exec('git', ['worktree', 'remove', '--force', reservePath], { cwd: repoDir });
      await fs.promises.mkdir(reservePath, { recursive: true });

      // claimReserve must detect the stale reserve, rebuild it, and complete normally.
      const result = await svc.claimReserve('main', 'task/stale-recover', {
        syncWithRemote: false,
      });

      expect(fs.existsSync(result)).toBe(true);
    });

    it('returns existing path when called twice with the same branchName (duplicate claim)', async () => {
      // Regression: previously attempted a second git worktree move which failed
      // because the target path was already occupied.
      const svc = makeService();
      const first = await svc.claimReserve('main', 'task/dup', { syncWithRemote: false });
      const second = await svc.claimReserve('main', 'task/dup', { syncWithRemote: false });

      expect(first).toBe(second);
      expect(fs.existsSync(first)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // getWorktree
  // -------------------------------------------------------------------------

  describe('getWorktree', () => {
    it('returns the path when the worktree directory exists', async () => {
      const svc = makeService();
      await svc.ensureReserve('main');

      const result = await svc.getWorktree('_reserve-main');
      expect(result).toBe(path.join(poolDir, '_reserve-main'));
    });

    it('returns undefined for a branch name with no matching directory', async () => {
      const svc = makeService();
      const result = await svc.getWorktree('nonexistent-branch');
      expect(result).toBeUndefined();
    });

    it('returns path for a claimed worktree', async () => {
      const svc = makeService();
      await svc.claimReserve('main', 'emdash/my-task', { syncWithRemote: false });

      const result = await svc.getWorktree('emdash/my-task');
      expect(result).toBe(path.join(poolDir, 'emdash', 'my-task'));
    });
  });

  // -------------------------------------------------------------------------
  // removeWorktree
  // -------------------------------------------------------------------------

  describe('removeWorktree', () => {
    it('removes the worktree directory and prunes the git entry', async () => {
      const svc = makeService();
      await svc.ensureReserve('main');

      const reservePath = path.join(poolDir, '_reserve-main');
      expect(fs.existsSync(reservePath)).toBe(true);

      await svc.removeWorktree(reservePath);

      expect(fs.existsSync(reservePath)).toBe(false);

      const worktrees = await listWorktrees(repoDir, exec);
      expect(worktrees.some((p) => p.endsWith('_reserve-main'))).toBe(false);
    });

    it('does not throw when the path does not exist', async () => {
      const svc = makeService();
      await expect(svc.removeWorktree(path.join(poolDir, 'nonexistent'))).resolves.not.toThrow();
    });
  });
});
