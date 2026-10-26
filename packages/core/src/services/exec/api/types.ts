import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { EnvSource } from '#primitives/exec/api';

export type ExecOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  maxBuffer?: number;
  onStderr?: (chunk: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type ExecSpawnOptions = Pick<ExecOptions, 'cwd' | 'env' | 'signal'>;

export type ExecResult = {
  stdout: string;
  stderr: string;
};

export type ExecBufferResult = {
  stdout: Buffer;
  stderr: string;
};

/** Bound on the diagnostic carried in the message; `stderr` keeps the full text. */
const MESSAGE_DIAGNOSTIC_MAX_CHARS = 2_000;

export class ExecError extends Error {
  constructor(
    readonly file: string,
    readonly args: readonly string[],
    readonly exitCode: number | null,
    readonly stdout: string,
    readonly stderr: string,
    options?: ErrorOptions
  ) {
    super(describeExecFailure(file, args, exitCode, stderr), options);
    this.name = 'ExecError';
  }
}

/**
 * Callers surface and pattern-match `error.message`, so it carries the process's own
 * diagnostic (git's "fatal: …" line lives on stderr) — a bare exit code hides the cause.
 * Long output keeps its tail: tools print the decisive line last.
 */
function describeExecFailure(
  file: string,
  args: readonly string[],
  exitCode: number | null,
  stderr: string
): string {
  const summary = `${file} ${args.join(' ')} failed (exit ${exitCode ?? 'unknown'})`;
  const diagnostic = stderr.trim();
  if (!diagnostic) return summary;
  return diagnostic.length > MESSAGE_DIAGNOSTIC_MAX_CHARS
    ? `${summary}: …${diagnostic.slice(-MESSAGE_DIAGNOSTIC_MAX_CHARS)}`
    : `${summary}: ${diagnostic}`;
}

export type BoundExec = {
  readonly file: string;
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv | EnvSource;
  exec(args: string[], options?: ExecOptions): Promise<ExecResult>;
  execStreaming(
    args: string[],
    onStdout: (chunk: string) => boolean | void,
    options?: ExecOptions
  ): Promise<void>;
  execBuffer(args: string[], options?: ExecOptions): Promise<ExecBufferResult>;
  spawn(
    args: string[],
    options?: ExecSpawnOptions
  ): ChildProcessWithoutNullStreams | Promise<ChildProcessWithoutNullStreams>;
  withCwd(cwd: string): BoundExec;
};
