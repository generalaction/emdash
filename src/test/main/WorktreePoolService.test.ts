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

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-pool-test-'));
    projectPath = path.join(tempDir, 'project');
    fs.mkdirSync(projectPath, { recursive: true });

    execSync('git init', { cwd: projectPath, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: projectPath, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: projectPath, stdio: 'pipe' });

    fs.writeFileSync(path.join(projectPath, 'README.md'), '# Test');
    fs.writeFileSync(path.join(projectPath, '.gitignore'), '.claude/\n');
    fs.writeFileSync(
      path.join(projectPath, '.emdash.json'),
      JSON.stringify({ preservePatterns: ['.claude/**'] }, null, 2)
    );
    execSync('git add README.md .gitignore .emdash.json', { cwd: projectPath, stdio: 'pipe' });
    execSync('git commit -m "init"', { cwd: projectPath, stdio: 'pipe' });

    fs.mkdirSync(path.join(projectPath, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(projectPath, '.claude', 'settings.local.json'),
      '{"sandbox":"workspace-write"}'
    );

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
});
