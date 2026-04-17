/**
 * Utility functions for detecting shell environment variables
 * when the Electron app is launched from the GUI (not from terminal).
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { stripAnsi } from '@shared/text/stripAnsi';
import { LOCALE_ENV_VARS, DEFAULT_UTF8_LOCALE, isUtf8Locale } from './locale';

const SHELL_VALUE_START = '__EMDASH_SHELL_VALUE_START__';
const SHELL_VALUE_END = '__EMDASH_SHELL_VALUE_END__';

function getFallbackUtf8Locale(): string | undefined {
  if (process.platform === 'win32') return undefined;

  // On macOS, all locales use UTF-8 encoding. Use a bare ICU-compatible
  // locale identifier without a POSIX encoding suffix — suffixes like
  // `.UTF-8` are not understood by ICU's uloc_getTableStringWithFallback
  // on macOS 26+ and cause a null-pointer crash during AppKit menu init.
  if (process.platform === 'darwin') return 'en_US';

  return DEFAULT_UTF8_LOCALE;
}

/**
 * On macOS, strips POSIX encoding suffixes (e.g. ".UTF-8") from locale strings
 * so that ICU receives a clean locale identifier it can look up without crashing.
 * macOS always uses UTF-8, so the suffix carries no information and only causes
 * problems with newer ICU versions bundled in macOS 26+.
 */
function sanitizeLocaleForPlatform(locale: string): string {
  if (process.platform !== 'darwin') return locale;
  return locale.replace(/\.[A-Za-z0-9@_-]+$/, '');
}

/**
 * Gets an environment variable from the user's login shell.
 * This is useful when the app is launched from GUI and doesn't
 * inherit the shell's environment.
 *
 * @param varName - Name of the environment variable to retrieve
 * @returns The value of the environment variable, or undefined if not found
 */
export function getShellEnvVar(varName: string): string | undefined {
  try {
    if (!/^[A-Z0-9_]+$/.test(varName)) {
      return undefined;
    }
    const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');

    // -i = interactive, -l = login shell (sources .zshrc/.bash_profile)
    const result = execSync(
      `${shell} -ilc 'printf "${SHELL_VALUE_START}\\n"; printenv ${varName}; printf "${SHELL_VALUE_END}\\n"; exit 0'`,
      {
        encoding: 'utf8',
        timeout: 5000,
        env: {
          ...process.env,
          // Prevent oh-my-zsh plugins from breaking output
          DISABLE_AUTO_UPDATE: 'true',
          ZSH_TMUX_AUTOSTART: 'false',
          ZSH_TMUX_AUTOSTARTED: 'true',
        },
      }
    );

    const cleaned = stripAnsi(result, {
      stripOscBell: true,
      stripOscSt: true,
      stripOtherEscapes: true,
      stripCarriageReturn: true,
    });
    const start = cleaned.indexOf(SHELL_VALUE_START);
    const end = cleaned.indexOf(SHELL_VALUE_END, start + SHELL_VALUE_START.length);
    if (start === -1 || end === -1) {
      return undefined;
    }

    const value = cleaned.slice(start + SHELL_VALUE_START.length, end).trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

export function normalizeClaudeConfigDir(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  const expanded =
    trimmed === '~'
      ? os.homedir()
      : trimmed.startsWith('~/')
        ? path.join(os.homedir(), trimmed.slice(2))
        : trimmed;

  if (!path.isAbsolute(expanded)) {
    return undefined;
  }

  return path.normalize(expanded);
}

/**
 * Common SSH agent socket locations to check as fallback
 */
const COMMON_SSH_AGENT_LOCATIONS: ReadonlyArray<{ path: string; description: string }> = [
  // macOS launchd
  { path: '/private/tmp/com.apple.launchd.*/Listeners', description: 'macOS launchd' },
  // 1Password SSH agent (macOS)
  {
    path: path.join(os.homedir(), 'Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock'),
    description: '1Password SSH agent',
  },
  // Generic temp directory patterns
  { path: path.join(os.tmpdir(), 'ssh-??????????', 'agent.*'), description: 'OpenSSH temp' },
  // User's .ssh directory
  { path: path.join(os.homedir(), '.ssh', 'agent.*'), description: 'User SSH directory' },
  // Linux keyring
  { path: path.join(os.tmpdir(), 'keyring-*/ssh'), description: 'GNOME Keyring' },
  // GnuPG agent SSH support
  { path: path.join(os.homedir(), '.gnupg', 'S.gpg-agent.ssh'), description: 'GnuPG agent' },
];

/**
 * Checks if a path is a socket file
 */
function isSocketFile(filePath: string): boolean {
  try {
    const stats = fs.statSync(filePath);
    return stats.isSocket();
  } catch {
    return false;
  }
}

/**
 * Expands glob patterns to find matching paths
 */
function expandGlob(pattern: string): string[] {
  try {
    // Simple glob expansion for patterns like /tmp/ssh-*/agent.*
    const parts = pattern.split('/');
    let matches: string[] = [''];

    for (const part of parts) {
      if (!part) continue;

      if (part.includes('*') || part.includes('?')) {
        // This part has wildcards
        const regex = new RegExp(
          '^' + part.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
        );
        const newMatches: string[] = [];

        for (const currentPath of matches) {
          try {
            const dir = currentPath || '/';
            const entries = fs.readdirSync(dir);
            for (const entry of entries) {
              if (regex.test(entry)) {
                newMatches.push(path.join(currentPath, entry));
              }
            }
          } catch {}
        }

        matches = newMatches;
      } else {
        // Regular path component
        matches = matches.map((m) => path.join(m, part));
      }
    }

    return matches.filter((m) => m !== '');
  } catch {
    return [];
  }
}

/**
 * Detects the SSH_AUTH_SOCK environment variable.
 * First checks if it's already set, then tries to detect from shell,
 * and finally checks common socket locations.
 *
 * @returns The path to the SSH agent socket, or undefined if not found
 */
export function detectSshAuthSock(): string | undefined {
  // On macOS, check launchctl first — it reflects the user's explicit override
  // (e.g. `launchctl setenv SSH_AUTH_SOCK /path/to/1password/agent.sock`)
  // which may differ from the process.env value inherited from the default
  // Apple SSH agent when launched from Finder/Dock.
  if (process.platform === 'darwin') {
    try {
      const result = execSync('launchctl getenv SSH_AUTH_SOCK', {
        encoding: 'utf8',
        timeout: 1000,
      });
      const socket = result.trim();
      if (socket) {
        return socket;
      }
    } catch {
      // launchctl detection failed, continue
    }
  }

  // If already set in environment, use it
  if (process.env.SSH_AUTH_SOCK) {
    return process.env.SSH_AUTH_SOCK;
  }

  // Try to detect from user's login shell (sources .zshrc/.bash_profile)
  const shellValue = getShellEnvVar('SSH_AUTH_SOCK');
  if (shellValue) {
    return shellValue;
  }

  // Check common socket locations as fallback
  for (const location of COMMON_SSH_AGENT_LOCATIONS) {
    try {
      if (location.path.includes('*') || location.path.includes('?')) {
        const matches = expandGlob(location.path);
        for (const match of matches) {
          if (isSocketFile(match)) {
            return match;
          }
        }
      } else if (isSocketFile(location.path)) {
        return location.path;
      }
    } catch {
      // Continue to next location
    }
  }

  return undefined;
}

function getShellLocaleVars(): Partial<Record<string, string>> {
  try {
    const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
    const printCommands = LOCALE_ENV_VARS.map((v) => `printenv ${v} || echo`).join(
      '; echo "---"; '
    );
    const result = execSync(`${shell} -ilc '${printCommands}; exit 0'`, {
      encoding: 'utf8',
      timeout: 5000,
      env: {
        ...process.env,
        DISABLE_AUTO_UPDATE: 'true',
        ZSH_TMUX_AUTOSTART: 'false',
        ZSH_TMUX_AUTOSTARTED: 'true',
      },
    });
    const parts = result.split('---').map((s) => s.trim());
    const vars: Partial<Record<string, string>> = {};
    for (let i = 0; i < LOCALE_ENV_VARS.length; i++) {
      const value = parts[i]?.trim();
      if (value) vars[LOCALE_ENV_VARS[i]] = value;
    }
    return vars;
  } catch {
    return {};
  }
}

function initializeLocaleEnvironment(): void {
  // Check which vars need a shell lookup
  const needsLookup: string[] = [];
  for (const key of LOCALE_ENV_VARS) {
    const currentValue = process.env[key]?.trim();
    if (!currentValue || !isUtf8Locale(currentValue)) {
      needsLookup.push(key);
    }
  }

  // If all locale vars are already UTF-8, nothing to do
  if (needsLookup.length === 0) return;

  // Single batched shell call for all missing/non-UTF-8 locale vars
  const shellVars = needsLookup.length > 0 ? getShellLocaleVars() : {};
  const missingUtf8Keys: string[] = [];

  for (const key of LOCALE_ENV_VARS) {
    const currentValue = process.env[key]?.trim();
    if (currentValue && isUtf8Locale(currentValue)) {
      continue;
    }

    const shellValue = shellVars[key];
    if (shellValue && isUtf8Locale(shellValue)) {
      process.env[key] = shellValue;
      continue;
    }

    missingUtf8Keys.push(key);
  }

  if (process.env.LC_ALL && !isUtf8Locale(process.env.LC_ALL.trim())) {
    delete process.env.LC_ALL;
  }

  if (process.env.LC_CTYPE && !isUtf8Locale(process.env.LC_CTYPE.trim())) {
    delete process.env.LC_CTYPE;
  }

  const hasUtf8Lang = isUtf8Locale(process.env.LANG?.trim());
  const hasUtf8LcAll = isUtf8Locale(process.env.LC_ALL?.trim());
  const hasUtf8LcCtype = isUtf8Locale(process.env.LC_CTYPE?.trim());

  if (hasUtf8LcAll || hasUtf8Lang || hasUtf8LcCtype) return;

  if (missingUtf8Keys.length === 0) return;

  const fallbackLocale = getFallbackUtf8Locale();
  if (!fallbackLocale) return;

  process.env.LANG = fallbackLocale;
  process.env.LC_CTYPE = fallbackLocale;
}

/**
 * Initializes shell environment detection and sets process.env variables.
 * Should be called early in the main process before app is ready.
 */
export function initializeShellEnvironment(): void {
  const sshAuthSock = detectSshAuthSock();
  if (sshAuthSock) {
    process.env.SSH_AUTH_SOCK = sshAuthSock;
    console.log('[shellEnv] Detected SSH_AUTH_SOCK:', sshAuthSock);
  } else {
    console.log('[shellEnv] SSH_AUTH_SOCK not detected');
  }

  // Detect CLAUDE_CONFIG_DIR from login shell when not already in process.env.
  // Electron GUI apps on macOS don't inherit the user's shell profile, so the
  // var may be missing even if the user has it in ~/.zshrc / ~/.bash_profile.
  const existingClaudeConfigDir = normalizeClaudeConfigDir(process.env.CLAUDE_CONFIG_DIR);
  if (!existingClaudeConfigDir) {
    delete process.env.CLAUDE_CONFIG_DIR;
    const claudeConfigDir = normalizeClaudeConfigDir(getShellEnvVar('CLAUDE_CONFIG_DIR'));
    if (claudeConfigDir) {
      process.env.CLAUDE_CONFIG_DIR = claudeConfigDir;
      console.log('[shellEnv] Detected CLAUDE_CONFIG_DIR');
    }
  } else {
    process.env.CLAUDE_CONFIG_DIR = existingClaudeConfigDir;
  }

  initializeLocaleEnvironment();

  // Strip POSIX encoding suffixes (e.g. ".UTF-8") from all locale env vars on
  // macOS. ICU's uloc_getTableStringWithFallback on macOS 26+ crashes when it
  // receives locale strings with encoding suffixes — ICU uses its own tag format
  // (e.g. "en_US") without POSIX encoding markers. macOS always uses UTF-8, so
  // the suffix carries no useful information and only breaks ICU lookup.
  if (process.platform === 'darwin') {
    for (const key of LOCALE_ENV_VARS) {
      if (process.env[key]) {
        process.env[key] = sanitizeLocaleForPlatform(process.env[key]!);
      }
    }
  }
}
