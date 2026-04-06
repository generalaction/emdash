import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execSyncMock = vi.fn();
const shellValue = (value: string) =>
  `__EMDASH_SHELL_VALUE_START__\n${value}\n__EMDASH_SHELL_VALUE_END__\n`;

vi.mock('child_process', () => ({
  execSync: (...args: any[]) => execSyncMock(...args),
}));

// Prevent socket-detection calls in detectSshAuthSock from touching real fs
vi.mock('fs', () => {
  const mock = {
    statSync: vi.fn().mockImplementation(() => {
      throw new Error('ENOENT');
    }),
    readdirSync: vi.fn().mockReturnValue([]),
  };
  return { ...mock, default: mock };
});

describe('getShellEnvVar', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('returns the trimmed value from the shell', async () => {
    execSyncMock.mockReturnValue(shellValue('/custom/claude/config'));
    const { getShellEnvVar } = await import('../../main/utils/shellEnv');
    expect(getShellEnvVar('CLAUDE_CONFIG_DIR')).toBe('/custom/claude/config');
  });

  it('returns undefined when the shell outputs nothing', async () => {
    execSyncMock.mockReturnValue(shellValue(''));
    const { getShellEnvVar } = await import('../../main/utils/shellEnv');
    expect(getShellEnvVar('CLAUDE_CONFIG_DIR')).toBeUndefined();
  });

  it('returns undefined without calling execSync for invalid var names', async () => {
    const { getShellEnvVar } = await import('../../main/utils/shellEnv');
    expect(getShellEnvVar('invalid-name')).toBeUndefined();
    expect(execSyncMock).not.toHaveBeenCalled();
  });

  it('returns undefined when execSync throws', async () => {
    execSyncMock.mockImplementation(() => {
      throw new Error('shell unavailable');
    });
    const { getShellEnvVar } = await import('../../main/utils/shellEnv');
    expect(getShellEnvVar('CLAUDE_CONFIG_DIR')).toBeUndefined();
  });

  it('ignores shell prompt escape noise around the value', async () => {
    execSyncMock.mockReturnValue(
      `\u001b]1337;RemoteHost=hai@MacBookPro\u0007${shellValue('/custom/claude/config')}\u001b]1337;CurrentDir=/tmp\u0007`
    );
    const { getShellEnvVar } = await import('../../main/utils/shellEnv');
    expect(getShellEnvVar('CLAUDE_CONFIG_DIR')).toBe('/custom/claude/config');
  });
});

describe('initializeShellEnvironment — CLAUDE_CONFIG_DIR', () => {
  let savedClaudeConfigDir: string | undefined;
  let savedLang: string | undefined;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    savedClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    savedLang = process.env.LANG;

    delete process.env.CLAUDE_CONFIG_DIR;
    delete process.env.SSH_AUTH_SOCK;

    // Set a UTF-8 locale so initializeLocaleEnvironment() exits early and
    // doesn't issue its own execSync calls, keeping the mock simple.
    process.env.LANG = 'en_US.UTF-8';

    // Default: execSync returns empty (no SSH_AUTH_SOCK from launchctl, no
    // CLAUDE_CONFIG_DIR from shell, no locale vars).
    execSyncMock.mockReturnValue('');
  });

  afterEach(() => {
    if (savedClaudeConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR;
    } else {
      process.env.CLAUDE_CONFIG_DIR = savedClaudeConfigDir;
    }

    if (savedLang === undefined) {
      delete process.env.LANG;
    } else {
      process.env.LANG = savedLang;
    }
  });

  it('sets CLAUDE_CONFIG_DIR from the login shell when absent from process.env', async () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('CLAUDE_CONFIG_DIR')) {
        return shellValue('/shell/custom/claude');
      }
      return '';
    });

    const { initializeShellEnvironment } = await import('../../main/utils/shellEnv');
    initializeShellEnvironment();

    expect(process.env.CLAUDE_CONFIG_DIR).toBe('/shell/custom/claude');
  });

  it('does not override CLAUDE_CONFIG_DIR already present in process.env', async () => {
    process.env.CLAUDE_CONFIG_DIR = '/existing/path';
    execSyncMock.mockReturnValue(shellValue('/shell/custom/claude'));

    const { initializeShellEnvironment } = await import('../../main/utils/shellEnv');
    initializeShellEnvironment();

    expect(process.env.CLAUDE_CONFIG_DIR).toBe('/existing/path');
  });

  it('treats whitespace-only CLAUDE_CONFIG_DIR as unset and falls back to shell', async () => {
    process.env.CLAUDE_CONFIG_DIR = '   ';
    execSyncMock.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('CLAUDE_CONFIG_DIR')) {
        return shellValue('/shell/custom/claude');
      }
      return '';
    });

    const { initializeShellEnvironment } = await import('../../main/utils/shellEnv');
    initializeShellEnvironment();

    expect(process.env.CLAUDE_CONFIG_DIR).toBe('/shell/custom/claude');
  });

  it('trims a padded CLAUDE_CONFIG_DIR already present in process.env', async () => {
    process.env.CLAUDE_CONFIG_DIR = '  /existing/path  ';
    execSyncMock.mockReturnValue(shellValue('/shell/custom/claude'));

    const { initializeShellEnvironment } = await import('../../main/utils/shellEnv');
    initializeShellEnvironment();

    expect(process.env.CLAUDE_CONFIG_DIR).toBe('/existing/path');
  });

  it('leaves CLAUDE_CONFIG_DIR unset when the shell returns nothing', async () => {
    execSyncMock.mockReturnValue(shellValue(''));

    const { initializeShellEnvironment } = await import('../../main/utils/shellEnv');
    initializeShellEnvironment();

    expect(process.env.CLAUDE_CONFIG_DIR).toBeUndefined();
  });

  it('drops a relative CLAUDE_CONFIG_DIR instead of forwarding it', async () => {
    process.env.CLAUDE_CONFIG_DIR = '.claude';
    execSyncMock.mockReturnValue(shellValue('.claude'));

    const { initializeShellEnvironment } = await import('../../main/utils/shellEnv');
    initializeShellEnvironment();

    expect(process.env.CLAUDE_CONFIG_DIR).toBeUndefined();
  });

  it('expands ~/ in CLAUDE_CONFIG_DIR from the shell', async () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('CLAUDE_CONFIG_DIR')) {
        return shellValue('~/.claude-custom');
      }
      return '';
    });

    const { initializeShellEnvironment } = await import('../../main/utils/shellEnv');
    initializeShellEnvironment();

    expect(process.env.CLAUDE_CONFIG_DIR).toBe(`${process.env.HOME}/.claude-custom`);
  });
});
