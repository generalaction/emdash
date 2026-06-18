export type ExecOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  maxBuffer?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type ExecResult = {
  stdout: string;
  stderr: string;
};

export type ExecBufferResult = {
  stdout: Buffer;
  stderr: string;
};

export class ExecError extends Error {
  constructor(
    readonly file: string,
    readonly args: readonly string[],
    readonly exitCode: number | null,
    readonly stdout: string,
    readonly stderr: string
  ) {
    super(`${file} ${args.join(' ')} failed (exit ${exitCode ?? 'unknown'})`);
    this.name = 'ExecError';
  }
}

export type BoundExec = {
  readonly file: string;
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  exec(args: string[], options?: ExecOptions): Promise<ExecResult>;
  execStreaming(
    args: string[],
    onStdout: (chunk: string) => boolean | void,
    options?: ExecOptions
  ): Promise<void>;
  execBuffer(args: string[], options?: ExecOptions): Promise<ExecBufferResult>;
  withCwd(cwd: string): BoundExec;
};
