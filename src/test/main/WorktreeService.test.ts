import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync, execFileSync } from 'child_process';

// Mock electron app before importing anything that depends on it
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue(os.tmpdir()),
    getName: vi.fn().mockReturnValue('emdash-test'),
    getVersion: vi.fn().mockReturnValue('0.0.0-test'),
  },
}));

// Mock the database and project settings services
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

// Mock logger
vi.mock('../../main/lib/logger', () => ({
  log: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('WorktreeService', () => {
  describe('preserveFilesToWorktree', () => {
    let tempDir: string;
    let sourceDir: string;
    let destDir: string;
    let service: Awaited<typeof import('../../main/services/WorktreeService')>['worktreeService'];

    beforeEach(async () => {
      // Create temp directories
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-test-'));
      sourceDir = path.join(tempDir, 'source');
      destDir = path.join(tempDir, 'dest');

      fs.mkdirSync(sourceDir);
      fs.mkdirSync(destDir);

      // Initialize git repo in source
      execSync('git init', { cwd: sourceDir, stdio: 'pipe' });
      execSync('git config user.email "test@test.com"', { cwd: sourceDir, stdio: 'pipe' });
      execSync('git config user.name "Test"', { cwd: sourceDir, stdio: 'pipe' });

      // Create .gitignore
      fs.writeFileSync(path.join(sourceDir, '.gitignore'), '.env\n.env.*\n.envrc\nnode_modules/\n');

      // Create initial commit so git works properly
      fs.writeFileSync(path.join(sourceDir, 'README.md'), '# Test');
      execSync('git add .gitignore README.md', { cwd: sourceDir, stdio: 'pipe' });
      execSync('git commit -m "init"', { cwd: sourceDir, stdio: 'pipe' });

      // Reset modules and import fresh
      vi.resetModules();
      const mod = await import('../../main/services/WorktreeService');
      service = mod.worktreeService;
    });

    afterEach(() => {
      // Cleanup temp directory
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should copy .env file from source to destination', async () => {
      // Create .env file in source (gitignored)
      fs.writeFileSync(path.join(sourceDir, '.env'), 'SECRET_KEY=abc123\nAPI_URL=http://localhost');

      const result = await service.preserveFilesToWorktree(sourceDir, destDir);

      expect(result.copied).toContain('.env');
      expect(fs.existsSync(path.join(destDir, '.env'))).toBe(true);
      expect(fs.readFileSync(path.join(destDir, '.env'), 'utf8')).toBe(
        'SECRET_KEY=abc123\nAPI_URL=http://localhost'
      );
    });

    it('should copy multiple env files matching patterns', async () => {
      // Create multiple env files
      fs.writeFileSync(path.join(sourceDir, '.env'), 'BASE=value');
      fs.writeFileSync(path.join(sourceDir, '.env.local'), 'LOCAL=value');
      fs.writeFileSync(path.join(sourceDir, '.env.development.local'), 'DEV=value');
      fs.writeFileSync(path.join(sourceDir, '.envrc'), 'export FOO=bar');

      const result = await service.preserveFilesToWorktree(sourceDir, destDir);

      expect(result.copied).toContain('.env');
      expect(result.copied).toContain('.env.local');
      expect(result.copied).toContain('.envrc');
      expect(fs.existsSync(path.join(destDir, '.env'))).toBe(true);
      expect(fs.existsSync(path.join(destDir, '.env.local'))).toBe(true);
      expect(fs.existsSync(path.join(destDir, '.envrc'))).toBe(true);
    });

    it('should skip files that already exist in destination', async () => {
      // Create .env in both source and dest
      fs.writeFileSync(path.join(sourceDir, '.env'), 'SOURCE_VALUE=new');
      fs.writeFileSync(path.join(destDir, '.env'), 'DEST_VALUE=existing');

      const result = await service.preserveFilesToWorktree(sourceDir, destDir);

      expect(result.skipped).toContain('.env');
      expect(result.copied).not.toContain('.env');
      // Destination file should remain unchanged
      expect(fs.readFileSync(path.join(destDir, '.env'), 'utf8')).toBe('DEST_VALUE=existing');
    });

    it('should not copy files in excluded directories', async () => {
      // Create node_modules with an .env file (should be excluded)
      const nodeModulesDir = path.join(sourceDir, 'node_modules', 'some-package');
      fs.mkdirSync(nodeModulesDir, { recursive: true });
      fs.writeFileSync(path.join(nodeModulesDir, '.env'), 'SHOULD_NOT_COPY=true');

      // Also create a regular .env that should be copied
      fs.writeFileSync(path.join(sourceDir, '.env'), 'SHOULD_COPY=true');

      // Update .gitignore to include node_modules pattern
      fs.writeFileSync(
        path.join(sourceDir, '.gitignore'),
        '.env\n.env.*\nnode_modules/\nnode_modules/**\n'
      );

      const result = await service.preserveFilesToWorktree(sourceDir, destDir);

      expect(result.copied).toContain('.env');
      expect(result.copied).not.toContain('node_modules/some-package/.env');
      expect(fs.existsSync(path.join(destDir, '.env'))).toBe(true);
      expect(fs.existsSync(path.join(destDir, 'node_modules', 'some-package', '.env'))).toBe(false);
    });

    it('should preserve file permissions', async () => {
      // Create .env with specific permissions
      fs.writeFileSync(path.join(sourceDir, '.env'), 'SECRET=value');
      fs.chmodSync(path.join(sourceDir, '.env'), 0o600);

      await service.preserveFilesToWorktree(sourceDir, destDir);

      const destStat = fs.statSync(path.join(destDir, '.env'));
      // POSIX-only: Windows doesn't reliably preserve/represent these permission bits.
      if (process.platform !== 'win32') {
        // Check that permissions are preserved (at least the readable/writable bits)
        expect(destStat.mode & 0o777).toBe(0o600);
      }
    });

    it('should return empty result when no patterns match', async () => {
      // Create a file that doesn't match any pattern
      fs.writeFileSync(path.join(sourceDir, 'random.txt'), 'content');
      fs.writeFileSync(path.join(sourceDir, '.gitignore'), 'random.txt\n');
      execSync('git add .gitignore', { cwd: sourceDir, stdio: 'pipe' });
      execSync('git commit -m "update gitignore"', { cwd: sourceDir, stdio: 'pipe' });

      const result = await service.preserveFilesToWorktree(sourceDir, destDir);

      expect(result.copied).toHaveLength(0);
      expect(result.skipped).toHaveLength(0);
    });

    it('should handle nested env files in subdirectories', async () => {
      // Create nested directory with .env
      const nestedDir = path.join(sourceDir, 'config');
      fs.mkdirSync(nestedDir);
      fs.writeFileSync(path.join(nestedDir, '.env'), 'NESTED=true');
      fs.writeFileSync(path.join(sourceDir, '.gitignore'), '.env\nconfig/.env\n');
      execSync('git add .gitignore', { cwd: sourceDir, stdio: 'pipe' });
      execSync('git commit -m "update gitignore"', { cwd: sourceDir, stdio: 'pipe' });

      const result = await service.preserveFilesToWorktree(sourceDir, destDir);

      expect(result.copied).toContain('config/.env');
      expect(fs.existsSync(path.join(destDir, 'config', '.env'))).toBe(true);
    });

    it('should use custom patterns when provided', async () => {
      // Create custom config file
      fs.writeFileSync(path.join(sourceDir, 'local.config.json'), '{"key": "value"}');
      fs.writeFileSync(path.join(sourceDir, '.gitignore'), 'local.config.json\n');
      execSync('git add .gitignore', { cwd: sourceDir, stdio: 'pipe' });
      execSync('git commit -m "update gitignore"', { cwd: sourceDir, stdio: 'pipe' });

      const result = await service.preserveFilesToWorktree(
        sourceDir,
        destDir,
        ['local.config.json'], // Custom pattern
        [] // No exclusions
      );

      expect(result.copied).toContain('local.config.json');
      expect(fs.existsSync(path.join(destDir, 'local.config.json'))).toBe(true);
    });

    it('should copy untracked files that match preserve patterns', async () => {
      fs.writeFileSync(path.join(sourceDir, 'AGENTS.md'), '# local agent notes\n');

      const result = await service.preserveFilesToWorktree(sourceDir, destDir, ['AGENTS.md'], []);

      expect(result.copied).toContain('AGENTS.md');
      expect(fs.existsSync(path.join(destDir, 'AGENTS.md'))).toBe(true);
      expect(fs.readFileSync(path.join(destDir, 'AGENTS.md'), 'utf8')).toBe(
        '# local agent notes\n'
      );
    });

    it('should copy nested files for basename-only custom patterns', async () => {
      const nestedDir = path.join(sourceDir, 'secrets');
      fs.mkdirSync(nestedDir, { recursive: true });
      fs.writeFileSync(path.join(nestedDir, 'custom.secret'), 'nested-secret');
      fs.writeFileSync(path.join(sourceDir, '.gitignore'), 'custom.secret\n');
      execSync('git add .gitignore', { cwd: sourceDir, stdio: 'pipe' });
      execSync('git commit -m "ignore custom secret"', { cwd: sourceDir, stdio: 'pipe' });

      const result = await service.preserveFilesToWorktree(
        sourceDir,
        destDir,
        ['custom.secret'],
        []
      );

      expect(result.copied).toContain('secrets/custom.secret');
      expect(fs.existsSync(path.join(destDir, 'secrets', 'custom.secret'))).toBe(true);
    });

    it('should generate scoped pathspecs for preserve patterns', async () => {
      const pathspecs = (service as any).buildIgnoredPathspecs([
        '.env.keys',
        '.claude/**',
        './config/local.yml',
      ]) as string[];

      expect(pathspecs).toEqual(
        expect.arrayContaining([
          '.env.keys',
          '**/.env.keys',
          '.claude/**',
          '**/.claude/**',
          'config/local.yml',
          '**/config/local.yml',
        ])
      );
    });

    it('should read patterns from .emdash.json if present', async () => {
      // Create .emdash.json with custom patterns
      fs.writeFileSync(
        path.join(sourceDir, '.emdash.json'),
        JSON.stringify({ preservePatterns: ['custom.secret'] })
      );

      // Create the custom file
      fs.writeFileSync(path.join(sourceDir, 'custom.secret'), 'my-secret-value');
      fs.writeFileSync(path.join(sourceDir, '.gitignore'), 'custom.secret\n.emdash.json\n');
      execSync('git add .gitignore', { cwd: sourceDir, stdio: 'pipe' });
      execSync('git commit -m "update gitignore"', { cwd: sourceDir, stdio: 'pipe' });

      // Access the private method via the service instance
      const patterns = (service as any).getPreservePatterns(sourceDir);
      expect(patterns).toEqual(['custom.secret']);

      const result = await service.preserveFilesToWorktree(sourceDir, destDir, patterns);
      expect(result.copied).toContain('custom.secret');
    });

    it('should fall back to defaults when .emdash.json is missing', async () => {
      const patterns = (service as any).getPreservePatterns(sourceDir);
      expect(patterns).toContain('.env');
      expect(patterns).toContain('.envrc');
    });

    it('should preserve ignored files from configured directory glob patterns', async () => {
      fs.mkdirSync(path.join(sourceDir, '.claude'), { recursive: true });
      fs.writeFileSync(
        path.join(sourceDir, '.claude', 'settings.local.json'),
        '{"sandbox":"workspace-write"}'
      );
      fs.writeFileSync(
        path.join(sourceDir, '.emdash.json'),
        JSON.stringify({ preservePatterns: ['.claude/**'] })
      );
      fs.writeFileSync(path.join(sourceDir, '.gitignore'), '.claude/\n.emdash.json\n');
      execSync('git add .gitignore', { cwd: sourceDir, stdio: 'pipe' });
      execSync('git commit -m "update gitignore for claude"', { cwd: sourceDir, stdio: 'pipe' });

      const result = await service.preserveProjectFilesToWorktree(sourceDir, destDir);

      expect(result.copied).toContain('.claude/settings.local.json');
      expect(fs.existsSync(path.join(destDir, '.claude', 'settings.local.json'))).toBe(true);
    });
  });

  describe('createWorktree', () => {
    let tempDir: string;
    let mainRepo: string;

    beforeEach(async () => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-tracking-test-'));
      mainRepo = path.join(tempDir, 'main-repo');

      fs.mkdirSync(mainRepo);

      // Initialize git repo with explicit main branch
      execSync('git init -b main', { cwd: mainRepo, stdio: 'pipe' });
      execSync('git config user.email "test@test.com"', { cwd: mainRepo, stdio: 'pipe' });
      execSync('git config user.name "Test"', { cwd: mainRepo, stdio: 'pipe' });

      // Create initial commit
      fs.writeFileSync(path.join(mainRepo, 'README.md'), '# Test');
      execSync('git add README.md', { cwd: mainRepo, stdio: 'pipe' });
      execSync('git commit -m "init"', { cwd: mainRepo, stdio: 'pipe' });

      // Create a fake origin remote (local path as remote)
      const originPath = path.join(tempDir, 'origin');
      fs.mkdirSync(originPath);
      execSync('git init --bare', { cwd: originPath, stdio: 'pipe' });
      execFileSync('git', ['remote', 'add', 'origin', originPath], {
        cwd: mainRepo,
        stdio: 'pipe',
      });
      execSync('git push -u origin main', { cwd: mainRepo, stdio: 'pipe' });
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it('should create worktree branch without tracking the base ref', async () => {
      const worktreePath = path.join(tempDir, 'test-worktree');
      const branchName = 'test-branch';

      // Create worktree using git command with --no-track (simulating what service does)
      execFileSync(
        'git',
        ['worktree', 'add', '--no-track', '-b', branchName, worktreePath, 'origin/main'],
        { cwd: mainRepo, stdio: 'pipe' }
      );

      // Verify branch has no upstream tracking
      // Use try/catch instead of shell redirection for Windows compatibility
      let result = '';
      try {
        result = execFileSync('git', ['rev-parse', '--abbrev-ref', '@{upstream}'], {
          cwd: worktreePath,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err: any) {
        result = String(err.stderr || err.stdout || err.message);
      }

      // Should fail with "no upstream configured" or similar error
      expect(result).toMatch(/fatal|no upstream/);
    });

    it('should have tracking set to origin/<branch> after push --set-upstream', async () => {
      const worktreePath = path.join(tempDir, 'push-test-worktree');
      const branchName = 'push-test-branch';

      // Create worktree with --no-track
      execFileSync(
        'git',
        ['worktree', 'add', '--no-track', '-b', branchName, worktreePath, 'origin/main'],
        { cwd: mainRepo, stdio: 'pipe' }
      );

      // Make a commit and push with --set-upstream
      fs.writeFileSync(path.join(worktreePath, 'test.txt'), 'content');
      execSync('git add test.txt', { cwd: worktreePath, stdio: 'pipe' });
      execSync('git commit -m "test commit"', { cwd: worktreePath, stdio: 'pipe' });
      execFileSync('git', ['push', '--set-upstream', 'origin', branchName], {
        cwd: worktreePath,
        stdio: 'pipe',
      });

      // Now verify tracking is set to origin/<branch>
      const upstream = execFileSync('git', ['rev-parse', '--abbrev-ref', '@{upstream}'], {
        cwd: worktreePath,
        encoding: 'utf8',
      }).trim();

      expect(upstream).toBe(`origin/${branchName}`);
    });

    it('initializes empty repos on the resolved base branch without pushing to origin', async () => {
      const emptyRepo = path.join(tempDir, 'empty-repo');
      const emptyOrigin = path.join(tempDir, 'empty-origin.git');
      fs.mkdirSync(emptyRepo);
      fs.mkdirSync(emptyOrigin);

      execSync('git init', { cwd: emptyRepo, stdio: 'pipe' });
      execSync('git config user.email "test@test.com"', { cwd: emptyRepo, stdio: 'pipe' });
      execSync('git config user.name "Test"', { cwd: emptyRepo, stdio: 'pipe' });
      execSync('git init --bare', { cwd: emptyOrigin, stdio: 'pipe' });
      execFileSync('git', ['remote', 'add', 'origin', emptyOrigin], {
        cwd: emptyRepo,
        stdio: 'pipe',
      });

      const { projectSettingsService } = await import('../../main/services/ProjectSettingsService');
      vi.mocked(projectSettingsService.getProjectSettings).mockResolvedValue({
        projectId: 'proj-1',
        name: 'empty-repo',
        path: emptyRepo,
        baseRef: 'origin/main',
        gitBranch: 'main',
      });

      const { worktreeService } = await import('../../main/services/WorktreeService');
      const worktree = await worktreeService.createWorktree(emptyRepo, 'Empty Repo Task', 'proj-1');

      expect(worktree.branch).toMatch(/^emdash\/empty-repo-task-/);
      expect(fs.existsSync(worktree.path)).toBe(true);

      const currentBranch = execFileSync('git', ['branch', '--show-current'], {
        cwd: emptyRepo,
        encoding: 'utf8',
      }).trim();
      expect(currentBranch).toBe('main');

      expect(() =>
        execFileSync('git', ['rev-parse', '--verify', 'refs/heads/main'], {
          cwd: emptyRepo,
          stdio: 'pipe',
        })
      ).not.toThrow();

      const remoteHeads = execFileSync(
        'git',
        ['for-each-ref', '--format=%(refname)', 'refs/heads'],
        {
          cwd: emptyOrigin,
          encoding: 'utf8',
        }
      ).trim();
      expect(remoteHeads).toBe('');
    });
  });
});
