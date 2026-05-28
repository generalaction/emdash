import {
  buildRemoteShellCommand,
  buildRemoteShellCommandWithPathLookup,
  FALLBACK_REMOTE_SHELL_PROFILE,
  normalizeRemoteShell,
  type RemoteShellProfile,
} from '@main/core/ssh/lifecycle/remote-shell-profile';
import type { ResolvedShellProfile } from '@main/core/terminal-shell/types';
import { quoteShellArg } from '@main/utils/shellEscape';
import type { AgentSessionConfig } from '@shared/agent-session';
import type { GeneralSessionConfig } from '@shared/general-session';
import {
  isCshShell,
  terminalCommandArgs,
  terminalEnvCaptureArgs,
  terminalInteractiveShellArgs,
  terminalShellBasename,
} from '@shared/terminal-settings';
import { buildTmuxShellLine } from './tmux-session-name';

export type SessionType = 'agent' | 'general';
export type SessionConfig = AgentSessionConfig | GeneralSessionConfig;

function posixShellLineForSsh(
  type: SessionType,
  config: SessionConfig,
  profile: ResolvedShellProfile
): { cwd: string; line: string } {
  const shell = profile.executable;
  const quoteArg = isCshShell(shell) ? quoteCshArg : quoteShellArg;

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
        : `exec ${shell} ${profile.interactiveArgs.join(' ')}`;
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

function quoteCshArg(value: string): string {
  return quoteShellArg(value).replace(/!/g, '\\!');
}

/**
 * Build a single command string for SSH remote execution.
 */
export function resolveSshCommand(
  type: SessionType,
  config: SessionConfig,
  envVars?: Record<string, string>,
  profile?: ResolvedShellProfile | RemoteShellProfile
): string {
  const effectiveProfile = toResolvedShellProfile(profile);
  const { cwd, line } = posixShellLineForSsh(type, config, effectiveProfile);
  const commandString = `cd ${JSON.stringify(cwd)} && ${line}`;
  const remoteProfile = {
    shell: effectiveProfile.executable,
    env: effectiveProfile.capturedEnv ?? {},
  };
  if (effectiveProfile.remotePathLookup) {
    return buildRemoteShellCommandWithPathLookup(
      remoteProfile,
      effectiveProfile.executable,
      commandString,
      envVars
    );
  }
  return buildRemoteShellCommand(remoteProfile, commandString, envVars);
}

function toResolvedShellProfile(
  profile: ResolvedShellProfile | RemoteShellProfile | undefined
): ResolvedShellProfile {
  if (profile && 'executable' in profile) return profile;
  if (profile) {
    const executable = normalizeRemoteShell(profile.shell);
    const shellId = terminalShellBasename(executable) || 'sh';
    return {
      id: 'target-default',
      resolvedShellId:
        shellId === 'zsh' || shellId === 'bash' || shellId === 'ksh' ? shellId : 'sh',
      resolvedFromAuto: true,
      executable,
      displayName: `Auto - ${shellId}`,
      available: true,
      family: isCshShell(executable) ? 'csh' : 'posix',
      interactiveArgs: terminalInteractiveShellArgs(executable),
      commandArgs: terminalCommandArgs(executable),
      envCaptureArgs: terminalEnvCaptureArgs(executable),
      capturedEnv: profile.env,
    };
  }
  return {
    id: 'target-default',
    resolvedShellId: 'sh',
    resolvedFromAuto: true,
    executable: FALLBACK_REMOTE_SHELL_PROFILE.shell,
    displayName: 'Auto - sh',
    available: true,
    family: 'posix',
    interactiveArgs: ['-i'],
    commandArgs: ['-c'],
    envCaptureArgs: ['-ic'],
    capturedEnv: FALLBACK_REMOTE_SHELL_PROFILE.env,
  };
}
