import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

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
      // Check that permissions are preserved (at least the readable/writable bits)
      expect(destStat.mode & 0o777).toBe(0o600);
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
  });
});
