import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { spawnLocalPty } from '@main/core/pty/local-pty';
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

const ENV_CAPTURE_TIMEOUT_MS = 5_000;

function parseEnvOutput(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.replace(/\r/g, '').split('\n')) {
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

function buildCaptureEnv(shell: string): Record<string, string> {
  return {
    ...process.env,
    SHELL: shell,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'emdash',
    DISABLE_AUTO_UPDATE: 'true',
    ZSH_TMUX_AUTOSTART: 'false',
    ZSH_TMUX_AUTOSTARTED: 'true',
  };
}

function extractBetweenMarkers(raw: string, startMarker: string, endMarker: string): string {
  const normalized = raw.replace(/\r/g, '');
  const startIndex = normalized.indexOf(startMarker);
  if (startIndex === -1) throw new Error('env capture start marker not found');

  const endIndex = normalized.indexOf(endMarker, startIndex + startMarker.length);
  if (endIndex === -1) throw new Error('env capture end marker not found');

  return normalized.slice(startIndex + startMarker.length, endIndex).replace(/^\n+|\n+$/g, '');
}

async function captureShellEnvViaPty(shell: string): Promise<string> {
  const startMarker = `__EMDASH_ENV_BEGIN_${randomUUID()}__`;
  const endMarker = `__EMDASH_ENV_END_${randomUUID()}__`;
  const command = `printf '%s\\n' '${startMarker}'; env; printf '%s\\n' '${endMarker}'`;

  return new Promise((resolve, reject) => {
    let output = '';
    let done = false;

    const pty = spawnLocalPty({
      id: `user-env:${randomUUID()}`,
      command: shell,
      args: ['-ilc', command],
      cwd: os.homedir(),
      env: buildCaptureEnv(shell),
      cols: 80,
      rows: 24,
    });

    const finish = (fn: () => void): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      try {
        pty.kill();
      } catch {}
      finish(() => reject(new Error(`Timed out after ${ENV_CAPTURE_TIMEOUT_MS}ms`)));
    }, ENV_CAPTURE_TIMEOUT_MS);

    pty.onData((chunk) => {
      output += chunk;
    });

    pty.onExit(({ exitCode, signal }) => {
      finish(() => {
        if (exitCode !== undefined && exitCode !== 0) {
          reject(new Error(`PTY env capture exited with code ${exitCode}`));
          return;
        }
        if (signal !== undefined && signal !== 0) {
          reject(new Error(`PTY env capture exited with signal ${String(signal)}`));
          return;
        }
        try {
          resolve(extractBetweenMarkers(output, startMarker, endMarker));
        } catch (error) {
          reject(error);
        }
      });
    });
  });
}

function captureShellEnvViaExec(shell: string): string {
  return execFileSync(shell, ['-lc', 'env'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: ENV_CAPTURE_TIMEOUT_MS,
    env: buildCaptureEnv(shell),
  });
}

/**
 * Resolves the user's full login-shell environment once at startup and merges
 * it into `process.env`.
 *
 * Captures `$SHELL -ilc env` inside an isolated PTY so interactive shell env
 * startup files are honored without touching the outer terminal's job control.
 * If PTY capture fails, it falls back to `$SHELL -lc env`.
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
    const raw =
      process.env.EMDASH_DISABLE_PTY === '1'
        ? captureShellEnvViaExec(shell)
        : await captureShellEnvViaPty(shell).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            log.warn(
              '[userEnv] PTY env capture failed, falling back to non-interactive shell capture',
              {
                shell,
                error: message,
              }
            );
            return captureShellEnvViaExec(shell);
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
