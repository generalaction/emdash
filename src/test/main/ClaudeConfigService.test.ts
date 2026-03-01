import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies that pull in Electron
vi.mock('../../main/lib/logger', () => ({
  log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('../../main/settings', () => ({
  getAppSettings: vi.fn(() => ({ tasks: { autoTrustWorktrees: true } })),
}));

// We need to intercept `homedir` at the module level so the destructured
// import inside ClaudeConfigService picks up our override.
let mockHomeDir = '';
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => mockHomeDir };
});

describe('ClaudeConfigService', () => {
  let tempDir: string;
  let ensureClaudeTrust: typeof import('../../main/services/ClaudeConfigService').ensureClaudeTrust;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-config-test-'));
    mockHomeDir = tempDir;
    vi.resetModules();
    ({ ensureClaudeTrust } = await import('../../main/services/ClaudeConfigService'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates ~/.claude.json when it does not exist', () => {
    const worktreePath = '/Users/test/worktrees/my-task-abc';
    ensureClaudeTrust(worktreePath);

    const configPath = path.join(tempDir, '.claude.json');
    expect(fs.existsSync(configPath)).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.projects[worktreePath]).toEqual({
      hasTrustDialogAccepted: true,
      hasCompletedProjectOnboarding: true,
    });
  });

  it('adds entry to existing config preserving other fields', () => {
    const configPath = path.join(tempDir, '.claude.json');
    const existing = {
      someOtherField: 'preserved',
      projects: {
        '/existing/path': { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true },
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(existing), 'utf8');

    const worktreePath = '/Users/test/worktrees/new-task-def';
    ensureClaudeTrust(worktreePath);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.someOtherField).toBe('preserved');
    expect(config.projects['/existing/path']).toEqual({
      hasTrustDialogAccepted: true,
      hasCompletedProjectOnboarding: true,
    });
    expect(config.projects[worktreePath]).toEqual({
      hasTrustDialogAccepted: true,
      hasCompletedProjectOnboarding: true,
    });
  });

  it('is idempotent — skips write when already trusted', () => {
    const configPath = path.join(tempDir, '.claude.json');
    const worktreePath = '/Users/test/worktrees/my-task-abc';
    const existing = {
      projects: {
        [worktreePath]: { hasTrustDialogAccepted: true, hasCompletedProjectOnboarding: true },
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(existing), 'utf8');
    const mtimeBefore = fs.statSync(configPath).mtimeMs;

    // Small delay to ensure mtime would differ if file was rewritten
    const start = Date.now();
    while (Date.now() - start < 10) {
      /* busy wait */
    }

    ensureClaudeTrust(worktreePath);

    const mtimeAfter = fs.statSync(configPath).mtimeMs;
    expect(mtimeAfter).toBe(mtimeBefore);
  });

  it('handles invalid JSON gracefully', () => {
    const configPath = path.join(tempDir, '.claude.json');
    fs.writeFileSync(configPath, 'not valid json {{{', 'utf8');

    const worktreePath = '/Users/test/worktrees/my-task-abc';
    // Should not throw
    expect(() => ensureClaudeTrust(worktreePath)).not.toThrow();
  });

  it('resolves relative paths to absolute', () => {
    const worktreePath = './relative/path';
    ensureClaudeTrust(worktreePath);

    const configPath = path.join(tempDir, '.claude.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    const resolvedPath = path.resolve(worktreePath);
    expect(config.projects[resolvedPath]).toEqual({
      hasTrustDialogAccepted: true,
      hasCompletedProjectOnboarding: true,
    });
    // The original relative path should not exist as a key
    expect(config.projects[worktreePath]).toBeUndefined();
  });

  it('preserves existing fields on the project entry when updating', () => {
    const configPath = path.join(tempDir, '.claude.json');
    const worktreePath = '/Users/test/worktrees/my-task-abc';
    const existing = {
      projects: {
        [worktreePath]: {
          hasTrustDialogAccepted: false,
          customField: 'keep-me',
        },
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(existing), 'utf8');

    ensureClaudeTrust(worktreePath);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.projects[worktreePath]).toEqual({
      hasTrustDialogAccepted: true,
      hasCompletedProjectOnboarding: true,
      customField: 'keep-me',
    });
  });
});
