import { describe, expect, it } from 'vitest';
import { resolveLocalPtySpawn } from './pty-spawn-platform';

const winEnv = {
  ComSpec: 'C:\\Windows\\System32\\cmd.exe',
  PATHEXT: '.COM;.EXE;.BAT;.CMD;.PS1',
} satisfies NodeJS.ProcessEnv;

const posixEnv = {
  SHELL: '/bin/bash',
} satisfies NodeJS.ProcessEnv;

describe('resolveLocalPtySpawn - Windows', () => {
  const windowsPathEnv = {
    ...winEnv,
    Path: 'C:\\Users\\me\\AppData\\Roaming\\npm;C:\\Program Files\\nodejs',
  } satisfies NodeJS.ProcessEnv;

  it('uses ComSpec for interactive shells without POSIX flags', () => {
    const result = resolveLocalPtySpawn({
      platform: 'win32',
      env: winEnv,
      intent: { kind: 'interactive-shell', cwd: 'C:\\repo' },
    });

    expect(result).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: [],
      cwd: 'C:\\repo',
      warnings: [],
    });
  });

  it('direct-spawns argv commands when no Windows-unsupported shell features are present', () => {
    const result = resolveLocalPtySpawn({
      platform: 'win32',
      env: winEnv,
      intent: {
        kind: 'run-command',
        cwd: 'C:\\repo',
        command: { kind: 'argv', command: 'node.exe', args: ['--version'] },
      },
    });

    expect(result).toEqual({
      command: 'node.exe',
      args: ['--version'],
      cwd: 'C:\\repo',
      warnings: [],
    });
  });

  it('resolves extensionless commands through PATH and PATHEXT before wrapping cmd shims', () => {
    const result = resolveLocalPtySpawn({
      platform: 'win32',
      env: windowsPathEnv,
      fileExists: (candidate) => candidate === 'C:\\Users\\me\\AppData\\Roaming\\npm\\codex.CMD',
      intent: {
        kind: 'run-command',
        cwd: 'C:\\repo',
        command: { kind: 'argv', command: 'codex', args: ['hello world'] },
      },
    });

    expect(result).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'C:\\Users\\me\\AppData\\Roaming\\npm\\codex.CMD "hello world"'],
      cwd: 'C:\\repo',
      warnings: [],
    });
  });

  it('direct-spawns extensionless commands that resolve to exe files', () => {
    const result = resolveLocalPtySpawn({
      platform: 'win32',
      env: windowsPathEnv,
      fileExists: (candidate) => candidate === 'C:\\Program Files\\nodejs\\node.EXE',
      intent: {
        kind: 'run-command',
        cwd: 'C:\\repo',
        command: { kind: 'argv', command: 'node', args: ['--version'] },
      },
    });

    expect(result).toEqual({
      command: 'C:\\Program Files\\nodejs\\node.EXE',
      args: ['--version'],
      cwd: 'C:\\repo',
      warnings: [],
    });
  });

  it('falls back to cmd.exe for unresolved extensionless commands', () => {
    const result = resolveLocalPtySpawn({
      platform: 'win32',
      env: windowsPathEnv,
      fileExists: () => false,
      intent: {
        kind: 'run-command',
        cwd: 'C:\\repo',
        command: { kind: 'argv', command: 'codex', args: ['A&B', '100%'] },
      },
    });

    expect(result).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'codex "A^&B" "100%%"'],
      cwd: 'C:\\repo',
      warnings: [],
    });
  });

  it('wraps cmd and bat argv commands through cmd.exe', () => {
    const result = resolveLocalPtySpawn({
      platform: 'win32',
      env: winEnv,
      intent: {
        kind: 'run-command',
        cwd: 'C:\\repo',
        command: { kind: 'argv', command: 'pnpm.cmd', args: ['run', 'dev'] },
      },
    });

    expect(result).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'pnpm.cmd run dev'],
      cwd: 'C:\\repo',
      warnings: [],
    });
  });

  it('quotes cmd wrapper arguments that contain Windows metacharacters', () => {
    const result = resolveLocalPtySpawn({
      platform: 'win32',
      env: winEnv,
      intent: {
        kind: 'run-command',
        cwd: 'C:\\repo',
        command: { kind: 'argv', command: 'tool.cmd', args: ['hello world', 'A&B'] },
      },
    });

    expect(result.args).toEqual(['/d', '/s', '/c', 'tool.cmd "hello world" "A^&B"']);
  });

  it('wraps PowerShell scripts through powershell.exe -File', () => {
    const result = resolveLocalPtySpawn({
      platform: 'win32',
      env: winEnv,
      intent: {
        kind: 'run-command',
        cwd: 'C:\\repo',
        command: { kind: 'argv', command: 'scripts\\setup.ps1', args: ['-Verbose'] },
      },
    });

    expect(result).toEqual({
      command: 'powershell.exe',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts\\setup.ps1', '-Verbose'],
      cwd: 'C:\\repo',
      warnings: [],
    });
  });

  it('runs shell-line commands through cmd.exe /d /s /c', () => {
    const result = resolveLocalPtySpawn({
      platform: 'win32',
      env: winEnv,
      intent: {
        kind: 'run-command',
        cwd: 'C:\\repo',
        command: { kind: 'shell-line', commandLine: 'pnpm run dev' },
      },
    });

    expect(result).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'pnpm run dev'],
      cwd: 'C:\\repo',
      warnings: [],
    });
  });

  it('returns warnings for ignored shellSetup and tmux on Windows', () => {
    const result = resolveLocalPtySpawn({
      platform: 'win32',
      env: winEnv,
      intent: {
        kind: 'interactive-shell',
        cwd: 'C:\\repo',
        shellSetup: 'source ~/.nvm/nvm.sh',
        tmuxSessionName: 'session-1',
      },
    });

    expect(result.warnings).toEqual([
      'shell_setup_ignored_on_windows',
      'tmux_unsupported_on_windows',
    ]);
  });
});

describe('resolveLocalPtySpawn - POSIX', () => {
  it('uses SHELL -il for interactive shells', () => {
    const result = resolveLocalPtySpawn({
      platform: 'darwin',
      env: posixEnv,
      intent: { kind: 'interactive-shell', cwd: '/repo' },
    });

    expect(result).toEqual({
      command: '/bin/bash',
      args: ['-il'],
      cwd: '/repo',
      warnings: [],
    });
  });

  it('quotes argv commands before shell wrapping', () => {
    const result = resolveLocalPtySpawn({
      platform: 'linux',
      env: posixEnv,
      intent: {
        kind: 'run-command',
        cwd: '/repo',
        command: { kind: 'argv', command: 'node', args: ['script name.js', "it's ok"] },
      },
    });

    expect(result).toEqual({
      command: '/bin/bash',
      args: ['-c', "node 'script name.js' 'it'\\''s ok'"],
      cwd: '/repo',
      warnings: [],
    });
  });

  it('prepends shellSetup to shell-line commands', () => {
    const result = resolveLocalPtySpawn({
      platform: 'linux',
      env: posixEnv,
      intent: {
        kind: 'run-command',
        cwd: '/repo',
        shellSetup: 'source ~/.nvm/nvm.sh',
        command: { kind: 'shell-line', commandLine: 'pnpm run dev' },
      },
    });

    expect(result).toEqual({
      command: '/bin/bash',
      args: ['-c', 'source ~/.nvm/nvm.sh && pnpm run dev'],
      cwd: '/repo',
      warnings: [],
    });
  });
});
