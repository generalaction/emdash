import os from 'node:os';
import { detectSshAuthSock } from '@main/utils/shellEnv';

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
 * Build an environment for a user-facing interactive terminal session.
 *
 * Unlike buildAgentEnv, this inherits process.env wholesale so the terminal
 * feels identical to one opened in Ghostty or Terminal.app — the user's
 * EDITOR, MANPATH, JAVA_HOME, custom vars, etc. are all present.
 *
 * TERM, COLORTERM, TERM_PROGRAM, and SHELL are always set or overridden so
 * the shell and programs inside it report the correct terminal identity.
 * SSH_AUTH_SOCK is injected via the same cached detector used for agents,
 * since GUI-launched apps often don't inherit it from the user's login shell.
 */
export function buildTerminalEnv(): Record<string, string> {
  // Inherit the full process environment, stripping undefined values.
  const env: Record<string, string> = {};
  for (const [key, val] of Object.entries(process.env)) {
    if (val !== undefined) env[key] = val;
  }

  // Terminal identity — always override so xterm capabilities are correct.
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  env.TERM_PROGRAM = 'emdash';

  // Ensure SHELL reflects the user's configured shell (may be absent in GUI).
  env.SHELL = process.env.SHELL ?? (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');

  // SSH_AUTH_SOCK is normally set by resolveUserEnv() at startup. The
  // detectSshAuthSock() fallback covers cases where that failed (timeout,
  // AppImage, CI) by trying launchctl and common socket locations.
  if (!env.SSH_AUTH_SOCK) {
    const sshAuthSock = detectSshAuthSock();
    if (sshAuthSock) env.SSH_AUTH_SOCK = sshAuthSock;
  }

  return env;
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

  // process.env.PATH is enriched at startup by resolveUserEnv() so it already
  // contains the full login-shell PATH (Homebrew, nvm, npm globals, etc.).
  const resolvedPath = process.env.PATH ?? '';
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

  const sshAuthSock = process.env.SSH_AUTH_SOCK ?? detectSshAuthSock();
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
