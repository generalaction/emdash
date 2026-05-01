import { quoteShellArg } from './shellEscape';

type RemoteEditorScheme = 'vscode' | 'vscodium' | 'cursor';

export function buildRemoteSshAuthority(host: string, username: string): string {
  const normalizedHost = host.trim();
  if (!normalizedHost) return normalizedHost;

  // Keep host as-is when caller already included user info (for SSH aliases like user@host).
  if (normalizedHost.includes('@')) return normalizedHost;

  const normalizedUsername = username.trim();
  if (!normalizedUsername) return normalizedHost;

  return `${normalizedUsername}@${normalizedHost}`;
}

export function buildRemoteEditorUrl(
  scheme: RemoteEditorScheme,
  host: string,
  username: string,
  targetPath: string
): string {
  const authority = buildRemoteSshAuthority(host, username);
  const encodedAuthority = encodeURIComponent(authority);
  const normalizedTargetPath = targetPath.startsWith('/') ? targetPath : `/${targetPath}`;
  return `${scheme}://vscode-remote/ssh-remote+${encodedAuthority}${normalizedTargetPath}`;
}

type RemoteTerminalExecInput = {
  host: string;
  username: string;
  port: number | string;
  targetPath: string;
};

/**
 * Shell payload executed on the remote host after SSH connects.
 *
 * Goals:
 * - always start in the requested directory
 * - preserve current TERM only when host supports it (fallback for missing terminfo)
 * - keep session alive even when SHELL is unset/invalid by chaining shell fallbacks
 */
export function buildRemoteTerminalShellCommand(targetPath: string): string {
  return `cd ${quoteShellArg(targetPath)} && (if command -v infocmp >/dev/null 2>&1 && [ -n "\${TERM:-}" ] && infocmp "\${TERM}" >/dev/null 2>&1; then :; else export TERM=xterm-256color; fi) && (exec "\${SHELL:-/bin/bash}" || exec /bin/bash || exec /bin/sh)`;
}

/**
 * Builds a single SSH command string for terminals that accept shell command text
 * (Terminal.app, iTerm2 via AppleScript, Warp URL cmd parameter).
 *
 * Command text is shell-escaped because these launchers execute through a shell.
 */
export function buildRemoteSshCommand(input: RemoteTerminalExecInput): string {
  const sshAuthority = buildRemoteSshAuthority(input.host, input.username);
  const remoteCommand = buildRemoteTerminalShellCommand(input.targetPath);
  return `ssh ${quoteShellArg(sshAuthority)} -o ${quoteShellArg('ControlMaster=no')} -o ${quoteShellArg('ControlPath=none')} -p ${quoteShellArg(String(input.port))} -t ${quoteShellArg(remoteCommand)}`;
}

/**
 * Builds argv tokens for terminal remote SSH execution.
 *
 * We pass these tokens directly via child_process execFile/spawn (shell disabled), so host/port
 * are not shell-quoted here. The remote command itself is still shell-escaped because it is
 * parsed by the remote shell over SSH.
 */
export function buildRemoteTerminalExecArgs(input: RemoteTerminalExecInput): string[] {
  const sshAuthority = buildRemoteSshAuthority(input.host, input.username);
  const remoteCommand = buildRemoteTerminalShellCommand(input.targetPath);
  return [
    'ssh',
    sshAuthority,
    '-o',
    'ControlMaster=no',
    '-o',
    'ControlPath=none',
    '-p',
    String(input.port),
    '-t',
    remoteCommand,
  ];
}
