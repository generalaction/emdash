import { execSync } from 'node:child_process';
import os from 'node:os';
import { join } from 'node:path';
import { detectSshAuthSock } from '../utils/shellEnv';

export const AGENT_ENV_VARS = [
  'AMP_API_KEY',
  'ANTHROPIC_API_KEY',
  'AUTOHAND_API_KEY',
  'AUGMENT_SESSION_AUTH',
  'AWS_ACCESS_KEY_ID',
  'AWS_DEFAULT_REGION',
  'AWS_PROFILE',
  'AWS_REGION',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AZURE_OPENAI_API_ENDPOINT',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_KEY',
  'CODEBUFF_API_KEY',
  'COPILOT_CLI_TOKEN',
  'CURSOR_API_KEY',
  'DASHSCOPE_API_KEY',
  'FACTORY_API_KEY',
  'GEMINI_API_KEY',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GOOGLE_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_LOCATION',
  'GOOGLE_CLOUD_PROJECT',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'KIMI_API_KEY',
  'MISTRAL_API_KEY',
  'MOONSHOT_API_KEY',
  'NO_PROXY',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
] as const;

const DISPLAY_ENV_VARS = [
  'DISPLAY', // X11 display server
  'XAUTHORITY', // X11 auth cookie (often non-standard path on Wayland+GNOME)
  'WAYLAND_DISPLAY', // Wayland compositor socket
  'XDG_RUNTIME_DIR', // Contains Wayland/D-Bus sockets (e.g. /run/user/1000)
  'XDG_CURRENT_DESKTOP', // Used by xdg-open for DE detection
  'XDG_SESSION_TYPE', // Used by browsers/toolkits to select X11 vs Wayland
  'DBUS_SESSION_BUS_ADDRESS', // Needed by gio open and desktop portals
] as const;

function getDisplayEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of DISPLAY_ENV_VARS) {
    const val = process.env[key];
    if (val) env[key] = val;
  }
  return env;
}

let _localPath: string | undefined;
let _sshAuthSock: string | null | undefined;

/**
 * Lazily compute and cache an enriched PATH for local PTY sessions.
 *
 * When the app is launched from a GUI (Finder, app launcher, etc.) it inherits
 * a minimal PATH that is missing Homebrew, nvm, npm-global, etc.  This
 * function replicates what the old top-level PATH blocks in main.ts did, but
 * runs exactly once on first use and is cached for all subsequent calls.
 */
function resolveLocalPath(): string {
  if (_localPath !== undefined) return _localPath;

  const sep = process.platform === 'win32' ? ';' : ':';
  const cur = process.env.PATH || process.env.Path || '';
  const parts = cur.split(sep).filter(Boolean);

  if (process.platform === 'darwin') {
    for (const p of [
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/opt/homebrew/sbin',
      '/usr/local/sbin',
    ]) {
      if (!parts.includes(p)) parts.unshift(p);
    }
    try {
      const shell = process.env.SHELL || '/bin/zsh';
      const raw = execSync(`${shell} -ilc 'echo -n $PATH'`, {
        encoding: 'utf8',
        timeout: 3000,
        env: {
          ...process.env,
          DISABLE_AUTO_UPDATE: 'true',
          ZSH_TMUX_AUTOSTART: 'false',
          ZSH_TMUX_AUTOSTARTED: 'true',
        },
      });
      if (raw) {
        const entries = (raw + sep + parts.join(sep)).split(/[:\n]/).filter(Boolean);
        _localPath = Array.from(new Set(entries.filter((p) => p.startsWith('/')))).join(sep);
        return _localPath;
      }
    } catch {}
  }

  if (process.platform === 'linux') {
    const home = os.homedir();
    for (const p of [
      join(home, '.nvm/versions/node', process.version, 'bin'),
      join(home, '.npm-global/bin'),
      join(home, '.local/bin'),
      '/usr/local/bin',
    ]) {
      if (!parts.includes(p)) parts.unshift(p);
    }
    try {
      const shell = process.env.SHELL || '/bin/bash';
      const raw = execSync(`${shell} -ilc 'echo -n $PATH'`, {
        encoding: 'utf8',
        timeout: 3000,
        env: {
          ...process.env,
          DISABLE_AUTO_UPDATE: 'true',
          ZSH_TMUX_AUTOSTART: 'false',
          ZSH_TMUX_AUTOSTARTED: 'true',
        },
      });
      if (raw) {
        const entries = (raw + sep + parts.join(sep)).split(/[:\n]/).filter(Boolean);
        _localPath = Array.from(new Set(entries.filter((p) => p.startsWith('/')))).join(sep);
        return _localPath;
      }
    } catch {}
  }

  if (process.platform === 'win32') {
    const npmPath = join(process.env.APPDATA || '', 'npm');
    if (npmPath && !parts.includes(npmPath)) parts.unshift(npmPath);
  }

  _localPath = parts.join(sep);
  return _localPath;
}

/**
 * Lazily detect and cache the SSH_AUTH_SOCK path.
 *
 * GUI-launched apps don't inherit the shell's SSH agent socket.  This
 * function runs the detection once and caches the result so subsequent
 * calls are free.
 */
function resolveSshAuthSock(): string | undefined {
  if (_sshAuthSock !== undefined) return _sshAuthSock ?? undefined;
  const sock = detectSshAuthSock();
  _sshAuthSock = sock ?? null;
  return sock;
}

function getWindowsEssentialEnv(resolvedPath: string): Record<string, string> {
  const home = os.homedir();
  return {
    PATH: resolvedPath,
    PATHEXT: process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC',
    SystemRoot: process.env.SystemRoot || 'C:\\Windows',
    ComSpec: process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe',
    TEMP: process.env.TEMP || process.env.TMP || '',
    TMP: process.env.TMP || process.env.TEMP || '',
    USERPROFILE: process.env.USERPROFILE || home,
    APPDATA: process.env.APPDATA || '',
    LOCALAPPDATA: process.env.LOCALAPPDATA || '',
    HOMEDRIVE: process.env.HOMEDRIVE || '',
    HOMEPATH: process.env.HOMEPATH || '',
    USERNAME: process.env.USERNAME || os.userInfo().username,
    ProgramFiles: process.env.ProgramFiles || 'C:\\Program Files',
    'ProgramFiles(x86)': process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    ProgramData: process.env.ProgramData || 'C:\\ProgramData',
    CommonProgramFiles: process.env.CommonProgramFiles || 'C:\\Program Files\\Common Files',
    'CommonProgramFiles(x86)':
      process.env['CommonProgramFiles(x86)'] || 'C:\\Program Files (x86)\\Common Files',
    ProgramW6432: process.env.ProgramW6432 || 'C:\\Program Files',
    CommonProgramW6432: process.env.CommonProgramW6432 || 'C:\\Program Files\\Common Files',
  };
}

export interface AgentEnvOptions {
  /**
   * Pass through AGENT_ENV_VARS from process.env.
   * Defaults to true — set false only for tests or sandboxed environments.
   */
  agentApiVars?: boolean;

  /**
   * Include SHELL in the env (needed for shell-wrapper spawns so the shell
   * can reconstruct login env via -il flags).
   */
  includeShellVar?: boolean;

  /**
   * Emdash hook server connection details.  When set, injects
   * EMDASH_HOOK_PORT, EMDASH_PTY_ID, and EMDASH_HOOK_TOKEN so agent CLIs
   * can call back on lifecycle events.
   */
  hook?: {
    port: number;
    ptyId: string;
    token: string;
  };

  /**
   * Per-provider custom env vars configured by the user.
   * Keys are validated against ^[A-Za-z_][A-Za-z0-9_]*$.
   */
  customVars?: Record<string, string>;
}

/**
 * Build a clean, minimal PTY environment from scratch.
 *
 * Does NOT inherit process.env wholesale — only well-known variables are
 * forwarded.  Login shells (-il) will rebuild PATH, NVM, etc. from the user's
 * shell config files.  Direct spawns (no shell) receive PATH so the CLI can
 * find its own dependencies.
 */
export function buildAgentEnv(options: AgentEnvOptions = {}): Record<string, string> {
  const { agentApiVars = true, includeShellVar = false, hook, customVars } = options;

  const resolvedPath = resolveLocalPath();
  const env: Record<string, string> = {
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'emdash',
    HOME: process.env.HOME || os.homedir(),
    USER: process.env.USER || os.userInfo().username,
    PATH: resolvedPath,
    ...(process.env.LANG && { LANG: process.env.LANG }),
    ...(process.env.TMPDIR && { TMPDIR: process.env.TMPDIR }),
    ...getDisplayEnv(),
    ...(process.platform === 'win32' ? getWindowsEssentialEnv(resolvedPath) : {}),
  };

  const sshAuthSock = resolveSshAuthSock();
  if (sshAuthSock) env.SSH_AUTH_SOCK = sshAuthSock;

  if (includeShellVar) {
    env.SHELL = process.env.SHELL || '/bin/bash';
  }

  if (agentApiVars) {
    for (const key of AGENT_ENV_VARS) {
      const val = process.env[key];
      if (val) env[key] = val;
    }
  }

  if (hook && hook.port > 0) {
    env.EMDASH_HOOK_PORT = String(hook.port);
    env.EMDASH_PTY_ID = hook.ptyId;
    env.EMDASH_HOOK_TOKEN = hook.token;
  }

  if (customVars) {
    for (const [key, val] of Object.entries(customVars)) {
      if (typeof val === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        env[key] = val;
      }
    }
  }

  return env;
}

/**
 * Build a PTY environment appropriate for the given session type.
 *
 * - 'agent'     → full env including all agent API keys
 * - 'general'   → minimal env without agent API keys (plain interactive shell)
 * - 'lifecycle' → minimal env without agent API keys (setup/run/teardown scripts)
 *
 * Additional vars can be merged by the caller after this function returns.
 */
export function buildSessionEnv(
  sessionType: 'agent' | 'general' | 'lifecycle'
): Record<string, string> {
  return buildAgentEnv({
    agentApiVars: sessionType === 'agent',
    includeShellVar: true,
  });
}
