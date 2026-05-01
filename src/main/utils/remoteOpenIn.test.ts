import { describe, expect, it } from 'vitest';
import {
  buildRemoteEditorUrl,
  buildRemoteSshAuthority,
  buildRemoteTerminalExecArgs,
} from './remoteOpenIn';

describe('remoteOpenIn', () => {
  describe('buildRemoteEditorUrl', () => {
    it('builds VSCodium remote SSH URLs', () => {
      expect(buildRemoteEditorUrl('vscodium', 'example.com', 'alice', '/repo')).toBe(
        'vscodium://vscode-remote/ssh-remote+alice%40example.com/repo'
      );
    });
  });

  describe('buildRemoteTerminalExecArgs', () => {
    it('builds argv tokens for terminal app SSH launchers', () => {
      const args = buildRemoteTerminalExecArgs({
        host: 'example.com',
        username: 'arne',
        port: 2222,
        targetPath: "/tmp/with 'quote'",
      });

      expect(args).toEqual([
        'ssh',
        'arne@example.com',
        '-o',
        'ControlMaster=no',
        '-o',
        'ControlPath=none',
        '-p',
        '2222',
        '-t',
        "cd '/tmp/with '\\''quote'\\''' && (if command -v infocmp >/dev/null 2>&1 && [ -n \"${TERM:-}\" ] && infocmp \"${TERM}\" >/dev/null 2>&1; then :; else export TERM=xterm-256color; fi) && (exec \"${SHELL:-/bin/bash}\" || exec /bin/bash || exec /bin/sh)",
      ]);
    });
  });

  describe('buildRemoteSshAuthority', () => {
    it('does not prepend the username when the host already includes one', () => {
      expect(buildRemoteSshAuthority('git@example.com', 'arne')).toBe('git@example.com');
    });
  });
});
