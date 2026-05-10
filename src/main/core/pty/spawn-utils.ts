import type { AgentSessionConfig } from '@shared/agent-session';
import type { GeneralSessionConfig } from '@shared/general-session';
import {
  buildRemoteShellCommand,
  FALLBACK_REMOTE_SHELL_PROFILE,
  type RemoteShellProfile,
} from '@main/core/ssh/remote-shell-profile';
import { quoteShellArg } from '@main/utils/shellEscape';
import { buildTmuxShellLine } from './tmux-session-name';

export type SessionType = 'agent' | 'general';
export type SessionConfig = AgentSessionConfig | GeneralSessionConfig;

function posixShellLineForSsh(
  type: SessionType,
  config: SessionConfig,
  profile: RemoteShellProfile
): { cwd: string; line: string } {
  const shell = profile.shell;

  switch (type) {
    case 'agent': {
      const cfg = config as AgentSessionConfig;
      const baseCmd = [cfg.command, ...cfg.args].map(quoteShellArg).join(' ');
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
        : `exec ${shell} -il`;
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
  const { cwd, line } = posixShellLineForSsh(type, config, effectiveProfile);
  const commandString = `cd ${JSON.stringify(cwd)} && ${line}`;
  return buildRemoteShellCommand(effectiveProfile, commandString, envVars);
}
