import { execSync } from 'node:child_process';
import { log } from '@main/lib/logger';

/**
 * Keys that must never be overwritten from the shell env capture.
 *
 * - AppImage runtime vars would corrupt child-process environments when
 *   running from a Linux AppImage bundle.
 * - Electron-specific vars must retain the values Electron set at boot.
 * - NODE_ENV is set by the build toolchain and must not be overridden.
 */
const PRESERVE_KEYS = new Set([
  // AppImage
  'APPDIR',
  'APPIMAGE',
  'ARGV0',
  'CHROME_DESKTOP',
  'GSETTINGS_SCHEMA_DIR',
  'OWD',
  // Electron
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ATTACH_CONSOLE',
  'ELECTRON_ENABLE_LOGGING',
  'ELECTRON_ENABLE_STACK_DUMPING',
  // Build toolchain
  'NODE_ENV',
]);

function parseEnvOutput(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1);
    if (key && /^[A-Za-z_]\w*$/.test(key)) {
      result[key] = value;
    }
  }
  return result;
}

function mergePath(shellPath: string, currentPath: string): string {
  const sep = process.platform === 'win32' ? ';' : ':';
  const shellEntries = shellPath.split(sep).filter(Boolean);
  const currentEntries = currentPath.split(sep).filter(Boolean);

  // Shell entries first (user's full PATH), then any Electron-only entries not in shell PATH
  const seen = new Set(shellEntries);
  const extra = currentEntries.filter((p) => !seen.has(p));
  return [...shellEntries, ...extra].join(sep);
}

/**
 * Spawns `$SHELL -ilc 'env'` with a 5 s timeout. On any error (timeout,
 * missing shell, restricted environment) the function logs a warning and
 * returns — the app continues with whatever `process.env` already contains.
 *
 * After this call returns, all subsequent consumers that inherit `process.env`
 * (execFile, PTY env builders, dependency prober, etc.) automatically see the
 * full PATH, SSH_AUTH_SOCK, and other variables the user's shell init sets.
 */
export async function resolveUserEnv(): Promise<void> {
  if (process.platform === 'win32') {
    // Windows PATH is managed differently; no login-shell capture needed.
    return;
  }

  const shell = process.env.SHELL ?? (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');

  try {
    const raw = execSync(`${shell} -ilc 'env'`, {
      encoding: 'utf8',
      timeout: 5_000,
      env: {
        ...process.env,
        // Prevent oh-my-zsh and tmux plugins from producing extra output or
        // blocking the env capture.
        DISABLE_AUTO_UPDATE: 'true',
        ZSH_TMUX_AUTOSTART: 'false',
        ZSH_TMUX_AUTOSTARTED: 'true',
      },
    });

    const shellEnv = parseEnvOutput(raw);

    for (const [key, value] of Object.entries(shellEnv)) {
      if (PRESERVE_KEYS.has(key)) continue;

      if (key === 'PATH') {
        const current = process.env.PATH ?? '';
        process.env.PATH = mergePath(value, current);
      } else {
        process.env[key] = value;
      }
    }

    log.info('[userEnv] Resolved login-shell env', {
      shell,
      pathEntries: process.env.PATH?.split(':').length ?? 0,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn('[userEnv] Failed to resolve login-shell env, falling back to process.env', {
      shell,
      error: message,
    });
  }
}

/**
 * Parses a remote `env` command output into a key→value map.
 * Exported for use by the SSH connection manager.
 */
export function parseRemoteEnvOutput(raw: string): Record<string, string> {
  return parseEnvOutput(raw);
}
