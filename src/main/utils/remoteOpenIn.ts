import { quoteShellArg } from './shellEscape';

type RemoteEditorScheme = 'vscode' | 'vscodium' | 'cursor';

/**
 * Reject SSH host/username values that could be misinterpreted by `ssh` as an
 * option (`-oProxyCommand=...` → RCE) or by URL/shell layers as metacharacters.
 * Allows the conventional set for usernames and hostnames/IPs and refuses any
 * leading `-`, whitespace, or shell-meaningful characters.
 */
function assertSafeSshHost(host: string): void {
  if (!host || host.startsWith('-') || !/^[A-Za-z0-9._\-[\]:]+$/.test(host)) {
    throw new Error(`Refusing unsafe SSH host: ${JSON.stringify(host)}`);
  }
}

function assertSafeSshUsername(username: string): void {
  // Empty username is fine (falls back to system default), but if provided it
  // must look like a real account name and never look like an SSH option.
  if (username && (username.startsWith('-') || !/^[A-Za-z0-9._-]+$/.test(username))) {
    throw new Error(`Refusing unsafe SSH username: ${JSON.stringify(username)}`);
  }
}

export function buildRemoteSshAuthority(host: string, username: string): string {
  const normalizedHost = host.trim();
  if (!normalizedHost) return normalizedHost;

  // Keep host as-is when caller already included user info (for SSH aliases like user@host).
  if (normalizedHost.includes('@')) {
    const [userPart, ...hostParts] = normalizedHost.split('@');
    const hostPart = hostParts.join('@');
    assertSafeSshUsername(userPart);
    assertSafeSshHost(hostPart);
    return normalizedHost;
  }

  assertSafeSshHost(normalizedHost);

  const normalizedUsername = username.trim();
  if (!normalizedUsername) return normalizedHost;
  assertSafeSshUsername(normalizedUsername);

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
  // Percent-encode each path segment so `?`/`#`/metacharacters can't smuggle
  // query strings or fragments into the vscode-remote URL handler.
  const segments = targetPath.split('/').filter((s) => s.length > 0);
  const encodedPath = '/' + segments.map((s) => encodeURIComponent(s)).join('/');
  return `${scheme}://vscode-remote/ssh-remote+${encodedAuthority}${encodedPath}`;
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
