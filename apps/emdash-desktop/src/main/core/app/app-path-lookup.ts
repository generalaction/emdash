import { execFile } from 'node:child_process';
import path from 'node:path';
import type { PlatformConfig, PlatformKey } from '@core/primitives/open-in-apps/api/open-in-apps';
import { log } from '@main/lib/logger';

const COMMAND_TIMEOUT_MS = 5_000;
// Detection and launch must allow the same time to resolve an installed app.
// Keep the existing Visual Studio launch budget and also bound Spotlight.
const APP_PATH_LOOKUP_TIMEOUT_MS = 30_000;

type CommandResult = { ok: true; stdout: string } | { ok: false; code?: string | number };

export type RunCommand = (
  file: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
  timeout?: number
) => Promise<CommandResult>;

export const runCommand: RunCommand = (file, args, env, signal, timeout = COMMAND_TIMEOUT_MS) =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        env,
        encoding: 'utf8',
        maxBuffer: 128 * 1024,
        timeout,
        signal,
        killSignal: 'SIGKILL',
        windowsHide: true,
      },
      (error, stdout) => {
        resolve(error ? { ok: false, code: error.code ?? undefined } : { ok: true, stdout });
      }
    );
  });

export function envValue(env: NodeJS.ProcessEnv, key: string, platform: PlatformKey) {
  if (platform !== 'win32') return env[key];
  const match = Object.keys(env).find((name) => name.toUpperCase() === key.toUpperCase());
  return match ? env[match] : undefined;
}

type AppPathLookupResult =
  | { status: 'detected'; path: string }
  | { status: 'not-detected' | 'unknown' };

/** Resolve the same first app path for detection and launch, without a shell. */
export async function lookupAppPath(
  config: PlatformConfig,
  platform: PlatformKey,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
  run: RunCommand = runCommand
): Promise<AppPathLookupResult> {
  let file: string;
  let args: string[];
  let missingCode: string | undefined;
  if (platform === 'win32' && config.winVswhere) {
    file = path.win32.join(
      envValue(env, 'ProgramFiles(x86)', platform) || 'C:\\Program Files (x86)',
      'Microsoft Visual Studio',
      'Installer',
      'vswhere.exe'
    );
    args = ['-latest', '-property', 'productPath'];
    missingCode = 'ENOENT';
  } else if (platform === 'darwin' && config.mdfindQuery) {
    file = '/usr/bin/mdfind';
    args = [config.mdfindQuery];
  } else {
    return { status: 'not-detected' };
  }

  const result = await run(file, args, env, signal, APP_PATH_LOOKUP_TIMEOUT_MS);
  if (result.ok) {
    const appPath = result.stdout.split(/\r?\n/)[0]?.trim();
    return appPath ? { status: 'detected', path: appPath } : { status: 'not-detected' };
  }
  if (missingCode !== undefined && result.code === missingCode) return { status: 'not-detected' };
  log.warn('[open-in] App path lookup failed', { file, code: result.code });
  return { status: 'unknown' };
}
