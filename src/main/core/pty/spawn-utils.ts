import type { AgentSessionConfig } from '@shared/agent-session';
import type { GeneralSessionConfig } from '@shared/general-session';
import { quoteShellArg } from '@main/utils/shellEscape';
import { buildTmuxShellLine } from './tmux-session-name';

export type SessionType = 'agent' | 'general';
export type SessionConfig = AgentSessionConfig | GeneralSessionConfig;

function posixShellLineForSsh(
  type: SessionType,
  config: SessionConfig
): { cwd: string; line: string } {
  const shell = process.env.SHELL ?? '/bin/sh';

  switch (type) {
    case 'agent': {
      const cfg = config as AgentSessionConfig;
      const baseCmd = [cfg.command, ...cfg.args].join(' ');
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
  envVars?: Record<string, string>
): string {
  const { cwd, line } = posixShellLineForSsh(type, config);
  const envPrefix = envVars ? buildSshEnvPrefix(envVars) : '';
  const commandString = `cd ${JSON.stringify(cwd)} && ${envPrefix}${line}`;

  return `bash -l -c ${quoteShellArg(commandString)}`;
}

export function buildSshEnvPrefix(vars: Record<string, string>): string {
  const entries = Object.entries(vars);
  if (entries.length === 0) return '';
  const exports = entries.map(([k, v]) => `export ${k}='${v.replace(/'/g, "'\\''")}'`).join('; ');
  return exports + '; ';
}
