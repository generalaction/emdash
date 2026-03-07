import { describe, expect, it } from 'vitest';
import {
  buildGhosttyRemoteExecArgs,
  buildRemoteEditorUrl,
  buildRemoteSshCommand,
  buildRemoteSshAuthority,
  buildRemoteTerminalShellCommand,
} from '../remoteOpenIn';

describe('buildRemoteSshAuthority', () => {
  it('prepends username when host has no user component', () => {
    expect(buildRemoteSshAuthority('example.internal', 'azureuser')).toBe(
      'azureuser@example.internal'
    );
  });

  it('preserves host when username is already embedded', () => {
    expect(buildRemoteSshAuthority('existing@example.internal', 'azureuser')).toBe(
      'existing@example.internal'
    );
  });
});

describe('buildRemoteEditorUrl', () => {
  it('builds cursor remote URL with encoded user@host authority', () => {
    expect(
      buildRemoteEditorUrl('cursor', 'example.internal', 'azureuser', '/home/azureuser/src')
    ).toBe('cursor://vscode-remote/ssh-remote+azureuser%40example.internal/home/azureuser/src');
  });

  it('normalizes relative target paths with a leading slash', () => {
    expect(buildRemoteEditorUrl('vscode', 'example.internal', 'azureuser', 'workspace')).toBe(
      'vscode://vscode-remote/ssh-remote+azureuser%40example.internal/workspace'
    );
  });
});

describe('buildGhosttyRemoteExecArgs', () => {
  const expectedRemoteShellCommand =
    `cd '/home/azureuser/pro/smv/.emdash/worktrees/task one' && ` +
    '(if command -v infocmp >/dev/null 2>&1 && [ -n "${TERM:-}" ] && infocmp "${TERM}" >/dev/null 2>&1; then :; else export TERM=xterm-256color; fi) && ' +
    '(exec "${SHELL:-/bin/bash}" || exec /bin/bash || exec /bin/sh)';

  it('builds shared remote shell bootstrap command', () => {
    expect(
      buildRemoteTerminalShellCommand('/home/azureuser/pro/smv/.emdash/worktrees/task one')
    ).toBe(expectedRemoteShellCommand);
  });

  it('builds ssh argv tokens for Ghostty -e', () => {
    expect(
      buildGhosttyRemoteExecArgs({
        host: 'example.internal',
        username: 'azureuser',
        port: 22,
        targetPath: '/home/azureuser/pro/smv/.emdash/worktrees/task one',
      })
    ).toEqual([
      'ssh',
      'azureuser@example.internal',
      '-o',
      'ControlMaster=no',
      '-o',
      'ControlPath=none',
      '-p',
      '22',
      '-t',
      expectedRemoteShellCommand,
    ]);
  });

  it('preserves existing user@host authority', () => {
    expect(
      buildGhosttyRemoteExecArgs({
        host: 'ops@example.internal',
        username: 'ignored-user',
        port: '2202',
        targetPath: '/tmp/x',
      })
    ).toEqual([
      'ssh',
      'ops@example.internal',
      '-o',
      'ControlMaster=no',
      '-o',
      'ControlPath=none',
      '-p',
      '2202',
      '-t',
      `cd '/tmp/x' && (if command -v infocmp >/dev/null 2>&1 && [ -n "\${TERM:-}" ] && infocmp "\${TERM}" >/dev/null 2>&1; then :; else export TERM=xterm-256color; fi) && (exec "\${SHELL:-/bin/bash}" || exec /bin/bash || exec /bin/sh)`,
    ]);
  });

  it('builds quoted ssh command string for shell-based launchers', () => {
    expect(
      buildRemoteSshCommand({
        host: 'example.internal',
        username: 'azureuser',
        port: 22,
        targetPath: '/home/azureuser/pro/smv/.emdash/worktrees/task one',
      })
    ).toBe(
      `ssh 'azureuser@example.internal' -o 'ControlMaster=no' -o 'ControlPath=none' -p '22' -t '${expectedRemoteShellCommand.replace(/'/g, `'\\''`)}'`
    );
  });

  it('preserves existing user@host authority in shell command string', () => {
    expect(
      buildRemoteSshCommand({
        host: 'ops@example.internal',
        username: 'ignored-user',
        port: 22,
        targetPath: '/tmp/x',
      })
    ).toContain(`ssh 'ops@example.internal'`);
  });
});
