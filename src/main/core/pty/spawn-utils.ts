import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { AgentSessionConfig } from '@shared/agent-session';
import type { GeneralSessionConfig } from '@shared/general-session';
import { quoteShellArg } from '@main/utils/shellEscape';

export type SessionType = 'agent' | 'general' | 'lifecycle';
export type SessionConfig = AgentSessionConfig | GeneralSessionConfig;

export interface SpawnParams {
  command: string;
  args: string[];
  cwd: string;
}

/**
 * Resolve the shell executable for the current platform.
 * On Unix: uses $SHELL or falls back to /bin/sh.
 * On Windows: uses $SHELL if set, otherwise searches for Git Bash's bash.exe,
 * or falls back to cmd.exe.
 */
function resolveShell(): string {
  if (process.env.SHELL) return process.env.SHELL;

  if (process.platform === 'win32') {
    // Try to find Git Bash on Windows
    const gitBashCandidates = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\usr\\bin\\bash.exe',
      path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Git', 'bin', 'bash.exe'),
      path.join(os.homedir(), 'scoop', 'apps', 'git', 'current', 'bin', 'bash.exe'),
    ];

    for (const candidate of gitBashCandidates) {
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch {}
    }

    // Fall back to cmd.exe
    return process.env.ComSpec || 'cmd.exe';
  }

  return '/bin/sh';
}

/**
 * Check if the resolved shell is cmd.exe on Windows.
 */
function isWindowsCmd(shell: string): boolean {
  if (process.platform !== 'win32') return false;
  const lower = shell.toLowerCase();
  return lower.endsWith('cmd.exe') || lower.endsWith('cmd');
}

/**
 * Derive the executable, arguments, and working directory from a session config.
 * Applies shellSetup and tmux wrapping where relevant.
 */
export function resolveSpawnParams(type: SessionType, config: SessionConfig): SpawnParams {
  const shell = resolveShell();
  const useCmd = isWindowsCmd(shell);
  const shellFlag = useCmd ? '/c' : '-c';

  switch (type) {
    case 'agent': {
      const cfg = config as AgentSessionConfig;
      const baseCmd = [cfg.command, ...cfg.args].join(' ');
      const fullCmd = cfg.shellSetup ? `${cfg.shellSetup} && ${baseCmd}` : baseCmd;

      if (cfg.tmuxSessionName) {
        return buildTmuxParams(shell, cfg.tmuxSessionName, fullCmd, cfg.cwd);
      }

      return {
        command: shell,
        args: [shellFlag, fullCmd],
        cwd: cfg.cwd,
      };
    }

    case 'general': {
      const cfg = config as GeneralSessionConfig;
      const baseCmd = cfg.command
        ? [cfg.command, ...(cfg.args ?? [])].join(' ')
        : useCmd
          ? shell
          : `exec ${shell} -il`;
      const fullCmd = cfg.shellSetup ? `${cfg.shellSetup} && ${baseCmd}` : baseCmd;

      if (cfg.tmuxSessionName) {
        return buildTmuxParams(shell, cfg.tmuxSessionName, fullCmd, cfg.cwd);
      }

      if (cfg.command || cfg.shellSetup) {
        return { command: shell, args: [shellFlag, fullCmd], cwd: cfg.cwd };
      }

      return { command: shell, args: useCmd ? [] : ['-il'], cwd: cfg.cwd };
    }

    default: {
      throw new Error(`Unsupported session type: ${type}`);
    }
  }
}

/**
 * Build spawn params that wrap a command in a tmux session for persistence.
 *
 * Behaviour:
 * - If a tmux session named `sessionName` already exists → attach to it.
 * - Otherwise → create a detached session running `cmd`, then attach.
 */
export function buildTmuxParams(
  shell: string,
  sessionName: string,
  cmd: string,
  cwd: string
): SpawnParams {
  const quotedName = JSON.stringify(sessionName);
  const quotedCmd = JSON.stringify(cmd);

  const checkExists = `tmux has-session -t ${quotedName} 2>/dev/null`;
  const newSession = `tmux new-session -d -s ${quotedName} ${quotedCmd}`;
  const attach = `tmux attach-session -t ${quotedName}`;

  const tmuxCmd = `(${checkExists} && ${attach}) || (${newSession} && ${attach})`;

  return {
    command: shell,
    args: ['-c', tmuxCmd],
    cwd,
  };
}

/**
 * Build a single command string for SSH remote execution.
 * SSH remotes are always Unix, so we use Unix shell semantics.
 */
export function resolveSshCommand(
  type: SessionType,
  config: SessionConfig,
  envVars?: Record<string, string>
): string {
  // For SSH, always use Unix shell semantics
  const { command, args, cwd } = resolveSpawnParams(type, config);
  const unixShell = '/bin/bash';

  // Check if the spawn params represent a shell command (shell -c "cmd")
  // args[0] could be '-c' (Unix) or '/c' (Windows cmd.exe)
  const isShellCommand =
    (args[0] === '-c' || args[0] === '/c') && args.length >= 2;

  const innerCmd = isShellCommand ? args[1] : [command, ...args].join(' ');
  const envPrefix = envVars ? buildSshEnvPrefix(envVars) : '';
  const commandString = `cd ${JSON.stringify(cwd)} && ${envPrefix}${innerCmd}`;

  return `bash -l -c ${quoteShellArg(commandString)}`;
}

export function buildSshEnvPrefix(vars: Record<string, string>): string {
  const entries = Object.entries(vars);
  if (entries.length === 0) return '';
  const exports = entries.map(([k, v]) => `export ${k}='${v.replace(/'/g, "'\\''")}'`).join('; ');
  return exports + '; ';
}
