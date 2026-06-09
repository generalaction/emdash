import { execSync, type ExecSyncOptions } from 'node:child_process';

export interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Print the command before running it */
  echo?: boolean;
}

export function exec(cmd: string, opts?: ExecOptions): string {
  if (opts?.echo) {
    console.log(`$ ${cmd}`);
  }
  const execOpts: ExecSyncOptions = {
    encoding: 'utf-8',
    stdio: ['inherit', 'pipe', 'pipe'],
    ...(opts?.cwd && { cwd: opts.cwd }),
    ...(opts?.env && { env: { ...process.env, ...opts.env } }),
  };
  try {
    return (execSync(cmd, execOpts) as string).trim();
  } catch (error: unknown) {
    const e = error as { stderr?: string; status?: number };
    const stderr = typeof e.stderr === 'string' ? e.stderr.trim() : '';
    throw new Error(`Command failed (exit ${e.status ?? '?'}): ${cmd}\n${stderr}`);
  }
}

export function execOrNull(cmd: string, opts?: ExecOptions): string | null {
  try {
    return exec(cmd, opts);
  } catch {
    return null;
  }
}
