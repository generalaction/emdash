import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { ProbeResult } from './types';

const execFileAsync = promisify(execFile);

const WHICH_TIMEOUT_MS = 5_000;
const VERSION_PROBE_TIMEOUT_MS = 10_000;

/**
 * Resolves the absolute path of a command binary using `which` (Unix) or `where` (Windows).
 * Returns `null` if the command is not found or the resolution fails.
 */
export async function resolveCommandPath(command: string): Promise<string | null> {
  const resolver = process.platform === 'win32' ? 'where' : 'which';
  try {
    const { stdout } = await execFileAsync(resolver, [command], {
      timeout: WHICH_TIMEOUT_MS,
      encoding: 'utf8',
    });
    const firstLine = stdout.trim().split('\n')[0]?.trim();
    return firstLine ?? null;
  } catch {
    return null;
  }
}

/**
 * Spawns `command args` and collects stdout/stderr up to a timeout.
 * Never throws — all failures are captured in the returned `ProbeResult`.
 */
export async function runVersionProbe(
  command: string,
  resolvedPath: string | null,
  args: string[],
  timeoutMs: number = VERSION_PROBE_TIMEOUT_MS
): Promise<ProbeResult> {
  const bin = resolvedPath ?? command;

  return new Promise<ProbeResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const proc = spawn(bin, args, { timeout: timeoutMs, windowsHide: true });

    const finish = (exitCode: number | null, timedOut: boolean) => {
      if (settled) return;
      settled = true;
      resolve({ command, path: resolvedPath, stdout, stderr, exitCode, timedOut });
    };

    proc.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('close', (code) => finish(code, false));
    proc.on('error', () => finish(null, false));

    const timer = setTimeout(() => {
      if (!settled) {
        proc.kill();
        finish(null, true);
      }
    }, timeoutMs);

    proc.on('close', () => clearTimeout(timer));
    proc.on('error', () => clearTimeout(timer));
  });
}
