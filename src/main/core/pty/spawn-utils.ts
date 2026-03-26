import type { AgentSessionConfig } from '@shared/agent-session';
import type { GeneralSessionConfig } from '@shared/general-session';

export type SessionType = 'agent' | 'general' | 'lifecycle';
export type SessionConfig = AgentSessionConfig | GeneralSessionConfig;

export interface SpawnParams {
  command: string;
  args: string[];
  cwd: string;
}

/**
 * Derive the executable, arguments, and working directory from a session config.
 * Applies shellSetup and tmux wrapping where relevant.
 */
export function resolveSpawnParams(type: SessionType, config: SessionConfig): SpawnParams {
  const shell = process.env.SHELL ?? '/bin/sh';

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
        args: ['-c', fullCmd],
        cwd: cfg.cwd,
      };
    }

    case 'general': {
      const cfg = config as GeneralSessionConfig;
      const baseCmd = cfg.command ? [cfg.command, ...(cfg.args ?? [])].join(' ') : null;
      const fullCmd = baseCmd
        ? cfg.shellSetup
          ? `${cfg.shellSetup} && ${baseCmd}`
          : baseCmd
        : cfg.shellSetup
          ? `${cfg.shellSetup} && exec ${shell} -il`
          : `exec ${shell} -il`;

      if (cfg.tmuxSessionName) {
        return buildTmuxParams(shell, cfg.tmuxSessionName, fullCmd, cfg.cwd);
      }

      if (cfg.command || cfg.shellSetup) {
        return { command: shell, args: ['-c', fullCmd], cwd: cfg.cwd };
      }

      return { command: shell, args: ['-il'], cwd: cfg.cwd };
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
 * Build a single shell command string for use with `sshClient.exec()`.
 * Combines the binary + args and ensures the cwd is honoured remotely.
 */
export function buildSshCommandString(command: string, args: string[], cwd: string): string {
  const invocation = [command, ...args].join(' ');
  return `cd ${JSON.stringify(cwd)} && ${invocation}`;
}
