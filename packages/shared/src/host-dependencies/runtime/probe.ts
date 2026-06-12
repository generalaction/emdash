import type { IExecutionContext } from '../../exec/execution-context';
import type { Platform } from '../capability';
import { toPlatform } from './install-options';
import type { ProbeResult } from './types';

const WHICH_TIMEOUT_MS = 5_000;
const VERSION_PROBE_TIMEOUT_MS = 10_000;
const REALPATH_TIMEOUT_MS = 5_000;

function targetPlatform(platform?: Platform): Platform {
  return platform ?? toPlatform(process.platform);
}

/**
 * Resolves the absolute path of a command binary.
 * Uses `where` on Windows and `which` on macOS/Linux.
 * Returns `null` if the command is not found or the resolution fails.
 */
export async function resolveCommandPath(
  command: string,
  ctx: IExecutionContext,
  platform?: Platform
): Promise<string | null> {
  const resolveCmd = targetPlatform(platform) === 'windows' ? 'where' : 'which';
  try {
    const { stdout } = await ctx.exec(resolveCmd, [command], { timeout: WHICH_TIMEOUT_MS });
    const firstLine = stdout.trim().split('\n')[0]?.trim();
    return firstLine ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolves the canonical realpath of a binary by following symlinks.
 * Runs `realpath` on Unix or falls back to the given path on failure/Windows.
 * Used to determine the true install location for method inference.
 */
export async function resolveRealpath(
  resolvedPath: string,
  ctx: IExecutionContext,
  platform?: Platform
): Promise<string> {
  if (targetPlatform(platform) === 'windows') return resolvedPath;
  try {
    const { stdout } = await ctx.exec('realpath', [resolvedPath], {
      timeout: REALPATH_TIMEOUT_MS,
    });
    const real = stdout.trim();
    return real || resolvedPath;
  } catch {
    return resolvedPath;
  }
}

/**
 * Runs `command args` and collects stdout/stderr up to a timeout.
 * Never throws — all failures are captured in the returned `ProbeResult`.
 */
export async function runVersionProbe(
  command: string,
  resolvedPath: string | null,
  args: string[],
  ctx: IExecutionContext,
  timeoutMs: number = VERSION_PROBE_TIMEOUT_MS
): Promise<ProbeResult> {
  const bin = resolvedPath ?? command;
  try {
    const { stdout, stderr } = await ctx.exec(bin, args, { timeout: timeoutMs });
    return { command, path: resolvedPath, stdout, stderr, exitCode: 0, timedOut: false };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number; killed?: boolean };
    return {
      command,
      path: resolvedPath,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      exitCode: e.code ?? null,
      timedOut: !!e.killed,
    };
  }
}
