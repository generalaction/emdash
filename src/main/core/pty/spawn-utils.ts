import {
  buildRemoteShellCommand,
  buildRemoteShellCommandWithPathLookup,
  FALLBACK_REMOTE_SHELL_PROFILE,
  type RemoteShellProfile,
} from '@main/core/ssh/lifecycle/remote-shell-profile';
import { quoteShellArg } from '@main/utils/shellEscape';
import type { AgentSessionConfig } from '@shared/agent-session';
import type { GeneralSessionConfig } from '@shared/general-session';
import { isCshShell, terminalInteractiveShellArgs } from '@shared/terminal-settings';
import { buildTmuxShellLine } from './tmux-session-name';

export type SessionType = 'agent' | 'general';
export type SessionConfig = AgentSessionConfig | GeneralSessionConfig;

function posixShellLineForSsh(
  type: SessionType,
  config: SessionConfig,
  shell: string
): { cwd: string; line: string } {
  const quoteArg = shellArgQuoter(shell);

  switch (type) {
    case 'agent': {
      const cfg = config as AgentSessionConfig;
      const baseCmd = [cfg.command, ...cfg.args].map(quoteArg).join(' ');
      const line = cfg.shellSetup ? `${cfg.shellSetup} && ${baseCmd}` : baseCmd;
      return {
        cwd: cfg.cwd,
        line: cfg.tmuxSessionName ? buildTmuxShellLine(cfg.tmuxSessionName, line) : line,
      };
    }
    case 'general': {
      const cfg = config as GeneralSessionConfig;
      const baseCmd = cfg.command
        ? [cfg.command, ...(cfg.args ?? [])].join(' ')
        : `exec ${shell} ${terminalInteractiveShellArgs(shell).join(' ')}`;
      const line = cfg.shellSetup ? `${cfg.shellSetup} && ${baseCmd}` : baseCmd;
      return {
        cwd: cfg.cwd,
        line: cfg.tmuxSessionName ? buildTmuxShellLine(cfg.tmuxSessionName, line) : line,
      };
    }
    default:
      throw new Error(`Unsupported session type: ${type}`);
  }
}

function resolveRemoteShellPreference(shell: string, preference: SessionConfig['shell']): string {
  if (!preference || preference === 'auto') return shell;
  return preference;
}

function shellArgQuoter(shell: string): (arg: string) => string {
  return isCshShell(shell) ? quoteCshArg : quoteShellArg;
}

function quoteCshArg(arg: string): string {
  return quoteShellArg(arg).replace(/!/g, '\\!');
}

/**
 * Build a single command string for SSH remote execution.
 */
export function resolveSshCommand(
  type: SessionType,
  config: SessionConfig,
  envVars?: Record<string, string>,
  profile?: RemoteShellProfile
): string {
  const effectiveProfile = profile ?? FALLBACK_REMOTE_SHELL_PROFILE;
  const shell = resolveRemoteShellPreference(effectiveProfile.shell, config.shell);
  const { cwd, line } = posixShellLineForSsh(type, config, shell);
  const commandString = `cd ${JSON.stringify(cwd)} && ${line}`;
  if (config.shell && config.shell !== 'auto') {
    return buildRemoteShellCommandWithPathLookup(
      effectiveProfile,
      config.shell,
      commandString,
      envVars
    );
  }
  return buildRemoteShellCommand({ ...effectiveProfile, shell }, commandString, envVars);
}
