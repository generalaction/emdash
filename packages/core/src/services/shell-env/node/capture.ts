import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { err, ok, type Result } from '@emdash/shared/result';
import { SHELL_ENV_CAPTURE_GUARD, type ShellEnvCapture, type ShellEnvCaptureError } from './types';

export type CaptureShellEnvOptions = {
  readonly baseEnv?: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
  readonly now?: () => number;
};

export function parseEnvOutput(raw: string): Record<string, string> {
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

export async function captureShellEnv(
  options: CaptureShellEnvOptions = {}
): Promise<Result<ShellEnvCapture, ShellEnvCaptureError>> {
  const baseEnv = options.baseEnv ?? process.env;
  const now = options.now ?? Date.now;

  if (process.platform === 'win32') {
    return ok({
      env: stringEnv(baseEnv),
      source: 'windows',
      capturedAt: now(),
    });
  }

  const shell = resolveLoginShell(baseEnv);
  const shellEnvProbeOptions = {
    encoding: 'utf8' as const,
    timeout: options.timeoutMs ?? 5_000,
    maxBuffer: 1024 * 1024,
    env: {
      ...baseEnv,
      ...SHELL_ENV_CAPTURE_GUARD,
    },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'],
  };
  const result = spawnSync(shell, ['-ilc', 'env'], shellEnvProbeOptions);

  if (result.error) {
    return err({
      type: 'capture-failed',
      shell,
      message: result.error.message,
    });
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    return err({
      type: 'capture-failed',
      shell,
      message: result.stderr.trim() || `shell env capture exited with status ${result.status}`,
    });
  }

  return ok({
    env: parseEnvOutput(result.stdout),
    source: 'login-shell',
    capturedAt: now(),
  });
}

export function resolveLoginShell(env: NodeJS.ProcessEnv = process.env): string {
  return candidateShells(env).find((candidate) => existsSync(candidate)) ?? '/bin/sh';
}

function candidateShells(env: NodeJS.ProcessEnv): string[] {
  const candidates = [env.SHELL, userShell(), '/bin/bash', '/bin/sh'].filter(
    (candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0
  );
  return [...new Set(candidates)];
}

function userShell(): string | undefined {
  try {
    return os.userInfo().shell ?? undefined;
  } catch {
    return undefined;
  }
}

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') result[key] = value;
  }
  return result;
}
