import { spawn } from 'node:child_process';
import type { SpawnOptionsWithoutStdio } from 'node:child_process';
import {
  ExecError,
  type BoundExec,
  type ExecBufferResult,
  type ExecOptions,
  type ExecResult,
} from './types';

const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;
const TIMEOUT_KILL_GRACE_MS = 1_000;

export type CreateBoundExecOptions = {
  file: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
};

export function createBoundExec(options: CreateBoundExecOptions): BoundExec {
  return new ProcessBoundExec(options.file, options.cwd, options.env);
}

type StdoutSink =
  | { kind: 'text'; chunks: string[] }
  | { kind: 'buffer'; chunks: Buffer[] }
  | { kind: 'stream'; onStdout: (chunk: string) => boolean | void };

class ProcessBoundExec implements BoundExec {
  readonly file: string;
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;

  constructor(file: string, cwd: string, env?: NodeJS.ProcessEnv) {
    this.file = file;
    this.cwd = cwd;
    this.env = env;
  }

  async exec(args: string[], options: ExecOptions = {}): Promise<ExecResult> {
    const chunks: string[] = [];
    const { stderr } = await this.run(args, options, { kind: 'text', chunks });
    return { stdout: chunks.join(''), stderr };
  }

  async execStreaming(
    args: string[],
    onStdout: (chunk: string) => boolean | void,
    options: ExecOptions = {}
  ): Promise<void> {
    await this.run(args, options, { kind: 'stream', onStdout });
  }

  async execBuffer(args: string[], options: ExecOptions = {}): Promise<ExecBufferResult> {
    const chunks: Buffer[] = [];
    const { stderr } = await this.run(args, options, { kind: 'buffer', chunks });
    return { stdout: Buffer.concat(chunks), stderr };
  }

  withCwd(cwd: string): BoundExec {
    return new ProcessBoundExec(this.file, cwd, this.env);
  }

  private run(args: string[], options: ExecOptions, sink: StdoutSink): Promise<{ stderr: string }> {
    return new Promise((resolve, reject) => {
      const spawnOptions: SpawnOptionsWithoutStdio = {
        cwd: options.cwd ?? this.cwd,
        env: composeEnv(this.env, options.env),
        signal: options.signal,
      };
      const child = spawn(this.file, args, spawnOptions);
      const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
      let stderr = '';
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;
      let stopped = false;

      const stdoutText = (): string => {
        if (sink.kind === 'text') return sink.chunks.join('');
        if (sink.kind === 'buffer') return Buffer.concat(sink.chunks).toString('utf8');
        return '';
      };
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      const failExec = (exitCode: number | null, stderrOverride?: string): void => {
        fail(new ExecError(this.file, args, exitCode, stdoutText(), stderrOverride ?? stderr));
      };

      const timeout = createTimeout(child, options, () => {
        failExec(null, `Timed out after ${options.timeoutMs}ms`);
      });

      if (sink.kind !== 'buffer') child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');

      child.stdout?.on('data', (chunk: string | Buffer) => {
        if (sink.kind === 'stream') {
          const shouldContinue = sink.onStdout(chunk as string);
          if (shouldContinue === false && !stopped) {
            stopped = true;
            child.kill();
          }
          return;
        }
        stdoutBytes += sink.kind === 'buffer' ? (chunk as Buffer).length : Buffer.byteLength(chunk);
        if (stdoutBytes > maxBuffer) {
          child.kill();
          failExec(null, 'stdout exceeded maxBuffer');
          return;
        }
        if (sink.kind === 'buffer') sink.chunks.push(chunk as Buffer);
        else sink.chunks.push(chunk as string);
      });

      child.stderr?.on('data', (chunk: string) => {
        stderrBytes += Buffer.byteLength(chunk);
        if (stderrBytes > maxBuffer) {
          child.kill();
          failExec(null, 'stderr exceeded maxBuffer');
          return;
        }
        stderr += chunk;
      });

      child.on('error', (error) => {
        clearExecTimeout(timeout);
        if (error.name === 'AbortError') {
          fail(error);
          return;
        }
        failExec(null);
      });

      child.on('close', (code) => {
        clearExecTimeout(timeout);
        if (settled) return;
        settled = true;
        const exitCode = code ?? 0;
        if (exitCode === 0 || (sink.kind === 'stream' && stopped)) {
          resolve({ stderr });
          return;
        }
        reject(new ExecError(this.file, args, exitCode, stdoutText(), stderr));
      });
    });
  }
}

function composeEnv(
  base: NodeJS.ProcessEnv | undefined,
  overlay: NodeJS.ProcessEnv | undefined
): NodeJS.ProcessEnv | undefined {
  if (!base && !overlay) return undefined;
  if (!base) return { ...process.env, ...overlay };
  return overlay ? { ...base, ...overlay } : base;
}

type TimeoutHandle = {
  timeout: ReturnType<typeof setTimeout>;
  killTimeout?: ReturnType<typeof setTimeout>;
};

function createTimeout(
  child: ReturnType<typeof spawn>,
  options: ExecOptions,
  onTimeout: () => void
): TimeoutHandle | undefined {
  if (!options.timeoutMs) return undefined;
  const handle: TimeoutHandle = {
    timeout: setTimeout(() => {
      child.kill();
      handle.killTimeout = setTimeout(() => {
        child.kill('SIGKILL');
      }, TIMEOUT_KILL_GRACE_MS);
      onTimeout();
    }, options.timeoutMs),
  };
  return handle;
}

function clearExecTimeout(handle: TimeoutHandle | undefined): void {
  if (!handle) return;
  clearTimeout(handle.timeout);
  if (handle.killTimeout) clearTimeout(handle.killTimeout);
}
