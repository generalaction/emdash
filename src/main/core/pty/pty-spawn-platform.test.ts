import { describe, expect, it } from 'vitest';
import type { ResolvedShellProfile } from '@main/core/terminal-shell/types';
import { resolveLocalPtySpawn } from './pty-spawn-platform';

const winEnv = {
  ComSpec: 'C:\\Windows\\System32\\cmd.exe',
  PATHEXT: '.COM;.EXE;.BAT;.CMD;.PS1',
} satisfies NodeJS.ProcessEnv;

const posixEnv = {
  SHELL: '/bin/bash',
} satisfies NodeJS.ProcessEnv;

const pwshProfile = {
  id: 'pwsh',
  resolvedShellId: 'pwsh',
  resolvedFromSystem: false,
  executable: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
  available: true,
  family: 'powershell',
  interactiveArgs: [],
  commandArgs: ['-NoProfile', '-Command'],
} satisfies ResolvedShellProfile;

function posixShellProfile({
  shell,
  family = 'posix',
  interactiveArgs,
  commandArgs,
}: {
  shell: 'bash' | 'dash' | 'sh' | 'tcsh';
  family?: 'posix' | 'csh';
  interactiveArgs: string[];
  commandArgs: string[];
}): ResolvedShellProfile {
  return {
    id: shell,
    resolvedShellId: shell,
    resolvedFromSystem: false,
    executable: shell,
    available: true,
    family,
    interactiveArgs,
    commandArgs,
  };
}

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

  it('double-wraps cmd shim paths containing spaces so /S /C does not eat the outer quotes', () => {
    const result = resolveLocalPtySpawn({
      platform: 'win32',
      env: windowsPathEnv,
      fileExists: (candidate) => candidate === 'C:\\Program Files\\nodejs\\claude.CMD',
      intent: {
        kind: 'run-command',
        cwd: 'C:\\repo',
        command: { kind: 'argv', command: 'claude', args: [] },
      },
    });

    expect(result).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', '""C:\\Program Files\\nodejs\\claude.CMD""'],
      cwd: 'C:\\repo',
      warnings: [],
    });
  });

  it('double-wraps spaced-path cmd shims even when arguments are present', () => {
    const result = resolveLocalPtySpawn({
      platform: 'win32',
      env: windowsPathEnv,
      fileExists: (candidate) => candidate === 'C:\\Program Files\\nodejs\\claude.CMD',
      intent: {
        kind: 'run-command',
        cwd: 'C:\\repo',
        command: { kind: 'argv', command: 'claude', args: ['--version'] },
      },
    });

    expect(result).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', '""C:\\Program Files\\nodejs\\claude.CMD" --version"'],
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

  it('wraps cmd and bat argv commands through cmd.exe when PowerShell is selected', () => {
    const result = resolveLocalPtySpawn({
      platform: 'win32',
      env: winEnv,
      intent: {
        kind: 'run-command',
        cwd: 'C:\\repo',
        shellProfile: pwshProfile,
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

  it('runs shell-line commands through selected PowerShell', () => {
    const result = resolveLocalPtySpawn({
      platform: 'win32',
      env: winEnv,
      intent: {
        kind: 'run-command',
        cwd: 'C:\\repo',
        shellProfile: pwshProfile,
        command: { kind: 'shell-line', commandLine: 'pnpm run dev' },
      },
    });

    expect(result).toEqual({
      command: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      args: ['-NoProfile', '-Command', 'pnpm run dev'],
      cwd: 'C:\\repo',
      warnings: [],
    });
  });

  it('runs unresolved extensionless commands through selected PowerShell', () => {
    const result = resolveLocalPtySpawn({
      platform: 'win32',
      env: windowsPathEnv,
      fileExists: () => false,
      intent: {
        kind: 'run-command',
        cwd: 'C:\\repo',
        shellProfile: pwshProfile,
        command: { kind: 'argv', command: 'codex', args: ['hello world', "it's ok"] },
      },
    });

    expect(result).toEqual({
      command: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      args: ['-NoProfile', '-Command', "& codex 'hello world' 'it''s ok'"],
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
  const bashProfile = posixShellProfile({
    shell: 'bash',
    interactiveArgs: ['-il'],
    commandArgs: ['-lc'],
  });
  const dashProfile = posixShellProfile({
    shell: 'dash',
    interactiveArgs: ['-i'],
    commandArgs: ['-c'],
  });
  const shProfile = posixShellProfile({
    shell: 'sh',
    interactiveArgs: ['-i'],
    commandArgs: ['-c'],
  });
  const tcshProfile = posixShellProfile({
    shell: 'tcsh',
    family: 'csh',
    interactiveArgs: ['-i'],
    commandArgs: ['-c'],
  });
  const posixPwshProfile: ResolvedShellProfile = {
    id: 'pwsh',
    resolvedShellId: 'pwsh',
    resolvedFromSystem: false,
    executable: 'pwsh',
    available: true,
    family: 'powershell',
    interactiveArgs: [],
    commandArgs: ['-NoProfile', '-Command'],
  };

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

  it('uses the selected terminal shell profile for interactive shells', () => {
    const result = resolveLocalPtySpawn({
      platform: 'darwin',
      env: posixEnv,
      intent: { kind: 'interactive-shell', cwd: '/repo', shellProfile: bashProfile },
    });

    expect(result).toEqual({
      command: 'bash',
      args: ['-il'],
      cwd: '/repo',
      warnings: [],
    });
  });

  it('uses a non-login setup wrapper before execing selected login shells', () => {
    const result = resolveLocalPtySpawn({
      platform: 'darwin',
      env: posixEnv,
      intent: {
        kind: 'interactive-shell',
        cwd: '/repo',
        shellProfile: bashProfile,
        shellSetup: 'export FOO=bar',
      },
    });

    expect(result).toEqual({
      command: 'bash',
      args: ['-c', 'export FOO=bar && exec bash -il'],
      cwd: '/repo',
      warnings: [],
    });
  });

  it('does not pass login flags to basic POSIX interactive shells', () => {
    const result = resolveLocalPtySpawn({
      platform: 'darwin',
      env: posixEnv,
      intent: { kind: 'interactive-shell', cwd: '/repo', shellProfile: dashProfile },
    });

    expect(result).toEqual({
      command: 'dash',
      args: ['-i'],
      cwd: '/repo',
      warnings: [],
    });
  });

  it('does not pass login flags to csh-family interactive shells', () => {
    const result = resolveLocalPtySpawn({
      platform: 'darwin',
      env: posixEnv,
      intent: { kind: 'interactive-shell', cwd: '/repo', shellProfile: tcshProfile },
    });

    expect(result).toEqual({
      command: 'tcsh',
      args: ['-i'],
      cwd: '/repo',
      warnings: [],
    });
  });

  it('does not pass login flags to basic POSIX interactive shells after setup', () => {
    const result = resolveLocalPtySpawn({
      platform: 'darwin',
      env: posixEnv,
      intent: {
        kind: 'interactive-shell',
        cwd: '/repo',
        shellProfile: shProfile,
        shellSetup: 'export FOO=bar',
      },
    });

    expect(result).toEqual({
      command: 'sh',
      args: ['-c', 'export FOO=bar && exec sh -i'],
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

  it('uses the selected terminal shell profile for shell-wrapped commands', () => {
    const result = resolveLocalPtySpawn({
      platform: 'linux',
      env: posixEnv,
      intent: {
        kind: 'run-command',
        cwd: '/repo',
        shellProfile: shProfile,
        command: { kind: 'argv', command: 'node', args: ['--version'] },
      },
    });

    expect(result).toEqual({
      command: 'sh',
      args: ['-c', 'node --version'],
      cwd: '/repo',
      warnings: [],
    });
  });

  it('rejects POSIX run-command wrapping through PowerShell shells', () => {
    expect(() =>
      resolveLocalPtySpawn({
        platform: 'linux',
        env: posixEnv,
        intent: {
          kind: 'run-command',
          cwd: '/repo',
          shellProfile: posixPwshProfile,
          command: { kind: 'argv', command: 'node', args: ['script name.js'] },
        },
      })
    ).toThrow('Cannot run POSIX shell-wrapped commands through pwsh');
  });

  it('escapes history expansion for csh-family argv commands', () => {
    const result = resolveLocalPtySpawn({
      platform: 'linux',
      env: posixEnv,
      intent: {
        kind: 'run-command',
        cwd: '/repo',
        shellProfile: tcshProfile,
        command: { kind: 'argv', command: 'printf', args: ['hello!'] },
      },
    });

    expect(result).toEqual({
      command: 'tcsh',
      args: ['-c', "'printf' 'hello\\!'"],
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
