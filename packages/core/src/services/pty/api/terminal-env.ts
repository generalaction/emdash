import os from 'node:os';
import {
  applyGitCredentialsToEnv,
  type GitCredentialsSessionSpec,
} from '#primitives/git-credentials/api';
import type { ResolvedPtyShellProfile } from './local-spawn';

/**
 * Defaults for PTYs that agent renders in xterm (interactive terminals and TUI
 * agents). FORCE_HYPERLINK makes TUIs emit OSC 8 links, which stay clickable
 * when a TUI hard-wraps a URL; hyperlink detection doesn't recognize
 * TERM_PROGRAM=agent. Callers apply these under the host and provider env so
 * an explicit value wins. Not for ACP tool terminals or scripts, whose output
 * isn't rendered by xterm.
 */
export const XTERM_PTY_DEFAULT_ENV: Readonly<Record<string, string>> = {
  FORCE_HYPERLINK: '1',
};

export function buildTerminalEnv(options: {
  shellProfile?: ResolvedPtyShellProfile;
  baseEnv: NodeJS.ProcessEnv | Record<string, string | undefined>;
  overrides?: Record<string, string | undefined>;
  /**
   * Per-session git credential behavior (spec: github-git-settings §4).
   * Applied last so scrubbing ("none") wins over base env and overrides;
   * absent means native/system behavior.
   */
  gitCredentials?: GitCredentialsSessionSpec;
}): Record<string, string> {
  const source = options.baseEnv;
  const env: Record<string, string> = {};
  for (const [key, val] of Object.entries(source)) {
    if (val !== undefined) env[key] = val;
  }

  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  env.TERM_PROGRAM = 'agent';

  if (process.platform !== 'win32') {
    env.SHELL =
      options.shellProfile?.family === 'posix' || options.shellProfile?.family === 'csh'
        ? options.shellProfile.executable
        : (env.SHELL ?? (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'));
  } else if (source.SHELL) {
    env.SHELL = source.SHELL;
  }

  env.HOME ??= os.homedir();

  for (const [key, val] of Object.entries(options.overrides ?? {})) {
    if (val === undefined) delete env[key];
    else env[key] = val;
  }

  return applyGitCredentialsToEnv(env, options.gitCredentials);
}
