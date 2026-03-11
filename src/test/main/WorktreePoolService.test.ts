import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { WorktreePoolService } from '../../main/services/WorktreePoolService';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue(os.tmpdir()),
    getName: vi.fn().mockReturnValue('emdash-test'),
    getVersion: vi.fn().mockReturnValue('0.0.0-test'),
  },
}));

vi.mock('../../main/services/DatabaseService', () => ({
  databaseService: {
    getDatabase: vi.fn(),
  },
}));

vi.mock('../../main/services/ProjectSettingsService', () => ({
  projectSettingsService: {
    getProjectSettings: vi.fn().mockResolvedValue({
      baseRef: 'origin/main',
      gitBranch: 'main',
    }),
    updateProjectSettings: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../main/lib/logger', () => ({
  log: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../main/settings', () => ({
  getAppSettings: vi.fn().mockReturnValue({
    repository: {
      branchPrefix: 'emdash',
      pushOnCreate: false,
    },
  }),
}));

describe('WorktreePoolService', () => {
  let tempDir: string;
  let projectPath: string;
  let pool: WorktreePoolService;

  const addRemote = (repoPath: string, barePath: string) => {
    // Create a bare clone to act as "origin"
    execSync(`git clone --bare "${repoPath}" "${barePath}"`, { stdio: 'pipe' });
    execSync(`git remote add origin "${barePath}"`, { cwd: repoPath, stdio: 'pipe' });
    execSync('git fetch origin', { cwd: repoPath, stdio: 'pipe' });
  };

  let pusherCounter = 0;
  const pushCommitToRemote = (barePath: string) => {
    // Clone the bare repo to a unique temp location, make a commit, push
    const pusherPath = `${barePath}-pusher-${++pusherCounter}`;
    execSync(`git clone "${barePath}" "${pusherPath}"`, { stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: pusherPath, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: pusherPath, stdio: 'pipe' });
    fs.writeFileSync(path.join(pusherPath, 'new-file.txt'), 'new content');
    execSync('git add new-file.txt', { cwd: pusherPath, stdio: 'pipe' });
    execSync('git commit -m "remote update"', { cwd: pusherPath, stdio: 'pipe' });
    execSync('git push', { cwd: pusherPath, stdio: 'pipe' });
  };

  const initRepo = (repoPath: string) => {
    fs.mkdirSync(repoPath, { recursive: true });
    execSync('git init', { cwd: repoPath, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: repoPath, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: repoPath, stdio: 'pipe' });
    fs.writeFileSync(path.join(repoPath, 'README.md'), '# Test');
    fs.writeFileSync(path.join(repoPath, '.gitignore'), '.claude/\n');
    fs.writeFileSync(
      path.join(repoPath, '.emdash.json'),
      JSON.stringify({ preservePatterns: ['.claude/**'] }, null, 2)
    );
    execSync('git add README.md .gitignore .emdash.json', { cwd: repoPath, stdio: 'pipe' });
    execSync('git commit -m "init"', { cwd: repoPath, stdio: 'pipe' });
    fs.mkdirSync(path.join(repoPath, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(repoPath, '.claude', 'settings.local.json'),
      '{"sandbox":"workspace-write"}'
    );
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-pool-test-'));
    projectPath = path.join(tempDir, 'project');
    initRepo(projectPath);

    pool = new WorktreePoolService();
    // Keep this test deterministic; reserve replenishment is orthogonal.
    (pool as any).replenishReserve = () => {};
  });

  afterEach(async () => {
    await pool.cleanup();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('preserves configured ignored files when claiming a reserve worktree', async () => {
    await pool.ensureReserve('project-1', projectPath, 'HEAD');

    const claimed = await pool.claimReserve('project-1', projectPath, 'preserve-claude');

    expect(claimed).not.toBeNull();
    const settingsPath = path.join(claimed!.worktree.path, '.claude', 'settings.local.json');
    expect(fs.existsSync(settingsPath)).toBe(true);
    expect(fs.readFileSync(settingsPath, 'utf8')).toContain('workspace-write');
  });

  it('removes reserve artifacts from disk even when in-memory state was lost', async () => {
    await pool.ensureReserve('project-1', projectPath, 'HEAD');
    const reserve = pool.getReserve('project-1');
    expect(reserve).toBeDefined();

    const restartedPool = new WorktreePoolService();
    await restartedPool.removeReserve('project-1', projectPath);

    expect(fs.existsSync(reserve!.path)).toBe(false);
    const branchOutput = execSync('git branch --list "_reserve/*"', {
      cwd: projectPath,
      stdio: 'pipe',
    }).toString();
    expect(branchOutput.trim()).toBe('');
  });

  it('does not remove reserve worktrees owned by a different repository', async () => {
    const otherProjectPath = path.join(tempDir, 'other-project');
    initRepo(otherProjectPath);

    const otherPool = new WorktreePoolService();
    (otherPool as any).replenishReserve = () => {};

    await pool.ensureReserve('project-1', projectPath, 'HEAD');
    await otherPool.ensureReserve('project-2', otherProjectPath, 'HEAD');

    const otherReserve = otherPool.getReserve('project-2');
    expect(otherReserve).toBeDefined();

    const restartedPool = new WorktreePoolService();
    await restartedPool.removeReserve('project-1', projectPath);

    expect(fs.existsSync(otherReserve!.path)).toBe(true);
    const otherBranches = execSync('git branch --list "_reserve/*"', {
      cwd: otherProjectPath,
      stdio: 'pipe',
    }).toString();
    expect(otherBranches).toContain(otherReserve!.branch);

    await otherPool.cleanup();
  });

  it('captures commitHash on reserve creation', async () => {
    await pool.ensureReserve('project-1', projectPath, 'HEAD');

    const reserve = pool.getReserve('project-1');
    expect(reserve).toBeDefined();
    expect(reserve!.commitHash).toBeDefined();
    expect(reserve!.commitHash).toMatch(/^[0-9a-f]{40}$/);
  });

  describe('freshness polling', () => {
    it('detects stale reserve and recreates it when remote changes', async () => {
      const barePath = projectPath + '-bare';
      addRemote(projectPath, barePath);

      await pool.ensureReserve('project-1', projectPath, 'HEAD');
      const originalReserve = pool.getReserve('project-1');
      expect(originalReserve).toBeDefined();
      const originalHash = originalReserve!.commitHash;

      // Simulate someone pushing a new commit to origin
      pushCommitToRemote(barePath);

      // Trigger freshness check (cleanup + recreation are now awaited)
      await (pool as any).checkAndRefreshReserves();

      // Reserve should have been recreated with a new commit hash
      const newReserve = pool.getReserve('project-1');
      expect(newReserve).toBeDefined();
      expect(newReserve!.commitHash).not.toBe(originalHash);
    });

    it('starts and stops freshness polling with reserve lifecycle', async () => {
      const barePath = projectPath + '-bare';
      addRemote(projectPath, barePath);

      // No poll before any reserve
      expect((pool as any).pollTimer).toBeUndefined();

      await pool.ensureReserve('project-1', projectPath, 'HEAD');

      // Poll should be running after reserve creation
      expect((pool as any).pollTimer).toBeDefined();

      // Cleanup should stop the poll
      await pool.cleanup();
      expect((pool as any).pollTimer).toBeUndefined();
    });

    it('does not recreate reserve when remote has not changed', async () => {
      const barePath = projectPath + '-bare';
      addRemote(projectPath, barePath);

      await pool.ensureReserve('project-1', projectPath, 'HEAD');
      const originalReserve = pool.getReserve('project-1');
      const originalPath = originalReserve!.path;

      // Trigger freshness check without any remote changes
      await (pool as any).checkAndRefreshReserves();

      const reserve = pool.getReserve('project-1');
      expect(reserve).toBeDefined();
      expect(reserve!.path).toBe(originalPath);
    });
  });

  describe('preflightCheck', () => {
    it('refreshes a stale reserve before claim', async () => {
      const barePath = projectPath + '-bare';
      addRemote(projectPath, barePath);

      await pool.ensureReserve('project-1', projectPath, 'HEAD');
      const originalHash = pool.getReserve('project-1')!.commitHash;

      pushCommitToRemote(barePath);

      await pool.preflightCheck('project-1', projectPath);

      const newReserve = pool.getReserve('project-1');
      expect(newReserve).toBeDefined();
      expect(newReserve!.commitHash).not.toBe(originalHash);
    });

    it('is a no-op when remote has not changed', async () => {
      const barePath = projectPath + '-bare';
      addRemote(projectPath, barePath);

      await pool.ensureReserve('project-1', projectPath, 'HEAD');
      const originalPath = pool.getReserve('project-1')!.path;

      await pool.preflightCheck('project-1', projectPath);

      expect(pool.getReserve('project-1')!.path).toBe(originalPath);
    });

    it('creates a reserve when none exists', async () => {
      expect(pool.getReserve('project-1')).toBeUndefined();
      await pool.preflightCheck('project-1', projectPath);
      expect(pool.getReserve('project-1')).toBeDefined();
    });
  });

  it('resolves owner repo path correctly when repo path contains a worktrees segment', async () => {
    const nestedProjectPath = path.join(tempDir, 'worktrees', 'nested-project');
    initRepo(nestedProjectPath);

    const nestedPool = new WorktreePoolService();
    (nestedPool as any).replenishReserve = () => {};
    await nestedPool.ensureReserve('project-nested', nestedProjectPath, 'HEAD');

    const reserve = nestedPool.getReserve('project-nested');
    expect(reserve).toBeDefined();

    const ownerPath = (nestedPool as any).getMainRepoPathFromWorktree(reserve!.path);
    expect(ownerPath).toBeDefined();
    expect(fs.realpathSync(ownerPath)).toBe(fs.realpathSync(nestedProjectPath));

    await nestedPool.cleanup();
  });
});
