import type { LoopExecutionTarget } from './loop-execution-target';

export const OUTPUT_TAIL_MAX = 8_000;
export const DEFAULT_LOOP_COMMAND_TIMEOUT_MS = 120_000;
export const DEFAULT_LOOP_COMMAND_MAX_BUFFER = 4 * 1024 * 1024;

export type LoopCommandOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
  env?: Readonly<Record<string, string | undefined>>;
  maxBuffer?: number;
};

export type LoopCommandResult = {
  file: string;
  args: string[];
  command: string;
  cwd: string;
  durationMs: number;
  stdout: string;
  stderr: string;
  stdoutTail: string;
  stderrTail: string;
  exitCode: number;
};

export type LoopCommandFailure = {
  file: string;
  args: string[];
  command: string;
  cwd: string;
  durationMs: number;
  stdoutTail: string;
  stderrTail: string;
  exitCode: number | null;
  timedOut: boolean;
  aborted: boolean;
  executionError: boolean;
  message: string;
};

function commandDisplay(file: string, args: string[]): string {
  return [file, ...args].join(' ');
}

export function tail(value: string | Buffer | undefined | null, max = OUTPUT_TAIL_MAX): string {
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : (value ?? '');
  return text.length > max ? text.slice(text.length - max) : text;
}

function errorProperty(error: unknown, property: string): unknown {
  return typeof error === 'object' && error !== null
    ? (error as Record<string, unknown>)[property]
    : undefined;
}

function errorOutput(error: unknown, property: 'stdout' | 'stderr'): string {
  const value = errorProperty(error, property);
  return typeof value === 'string' || Buffer.isBuffer(value) ? tail(value) : '';
}

function numericExitCode(error: unknown): number | null {
  const exitCode = errorProperty(error, 'exitCode');
  if (typeof exitCode === 'number') return exitCode;
  const code = errorProperty(error, 'code');
  return typeof code === 'number' ? code : null;
}

function normalizeFailure(
  error: unknown,
  input: {
    file: string;
    args: string[];
    command: string;
    cwd: string;
    durationMs: number;
    signal?: AbortSignal;
  }
): LoopCommandFailure {
  const name = error instanceof Error ? error.name : '';
  const code = errorProperty(error, 'code');
  const timedOut =
    name === 'TimeoutError' ||
    code === 'ETIMEDOUT' ||
    (errorProperty(error, 'killed') === true && errorProperty(error, 'signal') === 'SIGTERM');
  const aborted = name === 'AbortError' || input.signal?.aborted === true;
  const exitCode = aborted || timedOut ? null : numericExitCode(error);

  return {
    ...input,
    stdoutTail: errorOutput(error, 'stdout'),
    stderrTail: errorOutput(error, 'stderr'),
    exitCode,
    timedOut,
    aborted,
    executionError: !timedOut && !aborted && exitCode === null,
    message: error instanceof Error ? error.message : String(error),
  };
}

export async function runLoopCommand(
  target: LoopExecutionTarget,
  file: string,
  args: string[],
  options: LoopCommandOptions = {}
): Promise<LoopCommandResult> {
  const startedAt = Date.now();
  const command = commandDisplay(file, args);
  const env = { ...options.env, ...target.taskEnv };

  try {
    const result = await target.executionContext.exec(file, args, {
      timeout: options.timeoutMs ?? DEFAULT_LOOP_COMMAND_TIMEOUT_MS,
      maxBuffer: options.maxBuffer ?? DEFAULT_LOOP_COMMAND_MAX_BUFFER,
      signal: options.signal,
      env,
    });
    return {
      file,
      args,
      command,
      cwd: target.path,
      durationMs: Date.now() - startedAt,
      stdout: result.stdout,
      stderr: result.stderr,
      stdoutTail: tail(result.stdout),
      stderrTail: tail(result.stderr),
      exitCode: 0,
    };
  } catch (error) {
    throw normalizeFailure(error, {
      file,
      args,
      command,
      cwd: target.path,
      durationMs: Date.now() - startedAt,
      signal: options.signal,
    });
  }
}

export async function runLoopGitDiff(target: LoopExecutionTarget): Promise<string> {
  const [stat, diff] = await Promise.allSettled([
    runLoopCommand(target, 'git', ['diff', '--stat'], { timeoutMs: 60_000 }),
    runLoopCommand(target, 'git', ['diff', '--no-ext-diff'], {
      timeoutMs: 60_000,
      maxBuffer: 8 * 1024 * 1024,
    }),
  ]);
  const statText = stat.status === 'fulfilled' ? stat.value.stdoutTail : '';
  const diffText =
    diff.status === 'fulfilled'
      ? diff.value.stdoutTail
      : `git diff failed: ${(diff.reason as LoopCommandFailure).message}`;
  return [statText, diffText].filter(Boolean).join('\n\n');
}
