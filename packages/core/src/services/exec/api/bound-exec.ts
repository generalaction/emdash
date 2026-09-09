import { spawn as spawnProcess } from 'node:child_process';
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process';
import { classifySpawnPurpose, recordSpawn } from '@emdash/shared/perf';
import type { EnvSource } from '#primitives/exec/api';
import {
  createChildProcessTreeTerminator,
  planExecutableLaunch,
  toChildProcessLaunch,
  type FileExists,
} from '#primitives/exec/node';
import {
  ExecError,
  type BoundExec,
  type ExecBufferResult,
  type ExecOptions,
  type ExecResult,
  type ExecSpawnOptions,
} from './types';

const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024;

export type CreateBoundExecOptions = {
  file: string;
  cwd: string;
  env?: NodeJS.ProcessEnv | EnvSource;
  platform?: NodeJS.Platform;
  fileExists?: FileExists;
};

export function createBoundExec(options: CreateBoundExecOptions): BoundExec {
  return new ProcessBoundExec(
    options.file,
    options.cwd,
    options.env,
    options.platform ?? process.platform,
    options.fileExists
  );
}

type StdoutSink =
  | { kind: 'text'; chunks: string[] }
  | { kind: 'buffer'; chunks: Buffer[] }
  | { kind: 'stream'; onStdout: (chunk: string) => boolean | void };

class ProcessBoundExec implements BoundExec {
  constructor(
    readonly file: string,
    readonly cwd: string,
    readonly env: NodeJS.ProcessEnv | EnvSource | undefined,
    private readonly platform: NodeJS.Platform,
    private readonly fileExists: FileExists | undefined
  ) {}

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

  async spawn(
    args: string[],
    options: ExecSpawnOptions = {}
  ): Promise<ChildProcessWithoutNullStreams> {
    const env = await resolveEnv(this.env);
    const composedEnv = composeEnv(env, options.env);
    const plan = planExecutableLaunch({
      platform: this.platform,
      command: this.file,
      args,
      cwd: options.cwd ?? this.cwd,
      env: composedEnv,
      fileExists: this.fileExists,
    });
    const launch = toChildProcessLaunch(plan.invocation);
    recordSpawn(classifySpawnPurpose(this.file, args), launch.executable);
    return spawnProcess(launch.executable, launch.args, {
      cwd: plan.cwd,
      env: composedEnv,
      signal: options.signal,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsVerbatimArguments: launch.windowsVerbatimArguments,
    });
  }

  withCwd(cwd: string): BoundExec {
    return new ProcessBoundExec(this.file, cwd, this.env, this.platform, this.fileExists);
  }

  private async run(
    args: string[],
    options: ExecOptions,
    sink: StdoutSink
  ): Promise<{ stderr: string }> {
    const env = await resolveEnv(this.env);
    return new Promise((resolve, reject) => {
      const composedEnv = composeEnv(env, options.env);
      const plan = planExecutableLaunch({
        platform: this.platform,
        command: this.file,
        args,
        cwd: options.cwd ?? this.cwd,
        env: composedEnv,
        fileExists: this.fileExists,
      });
      const launch = toChildProcessLaunch(plan.invocation);
      const spawnOptions: SpawnOptionsWithoutStdio = {
        cwd: plan.cwd,
        env: composedEnv,
        detached: this.platform !== 'win32',
        windowsVerbatimArguments: launch.windowsVerbatimArguments,
      };
      recordSpawn(classifySpawnPurpose(this.file, args), launch.executable);
      const child = spawnProcess(launch.executable, launch.args, spawnOptions);
      const terminator = createChildProcessTreeTerminator(child, {
        platform: this.platform,
        processGroup: this.platform !== 'win32',
      });
      const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
      let stderr = '';
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;
      let stopped = false;
      let terminationError: Error | undefined;
      let terminationPromise: Promise<void> | undefined;

      const stdoutText = (): string => {
        if (sink.kind === 'text') return sink.chunks.join('');
        if (sink.kind === 'buffer') return Buffer.concat(sink.chunks).toString('utf8');
        return '';
      };
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const startTermination = (error?: Error): void => {
        if (settled) return;
        terminationError ??= error;
        terminationPromise ??= terminator.terminate();
      };
      const timeout = options.timeoutMs
        ? setTimeout(() => {
            startTermination(
              new ExecError(
                this.file,
                args,
                null,
                stdoutText(),
                `Timed out after ${options.timeoutMs}ms`
              )
            );
          }, options.timeoutMs)
        : undefined;
      const abort = () => {
        startTermination(
          Object.assign(new Error('The operation was aborted'), {
            name: 'AbortError',
          })
        );
      };
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) abort();

      function cleanup(): void {
        if (timeout) clearTimeout(timeout);
        options.signal?.removeEventListener('abort', abort);
      }

      if (sink.kind !== 'buffer') child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');

      child.stdout?.on('data', (chunk: string | Buffer) => {
        if (sink.kind === 'stream') {
          const shouldContinue = sink.onStdout(chunk as string);
          if (shouldContinue === false && !stopped) {
            stopped = true;
            startTermination();
            cleanup();
          }
          return;
        }
        stdoutBytes += sink.kind === 'buffer' ? (chunk as Buffer).length : Buffer.byteLength(chunk);
        if (stdoutBytes > maxBuffer) {
          startTermination(
            new ExecError(this.file, args, null, stdoutText(), 'stdout exceeded maxBuffer')
          );
          return;
        }
        if (sink.kind === 'buffer') sink.chunks.push(chunk as Buffer);
        else sink.chunks.push(chunk as string);
      });

      child.stderr?.on('data', (chunk: string) => {
        options.onStderr?.(chunk);
        stderrBytes += Buffer.byteLength(chunk);
        if (stderrBytes > maxBuffer) {
          startTermination(
            new ExecError(this.file, args, null, stdoutText(), 'stderr exceeded maxBuffer')
          );
          return;
        }
        stderr += chunk;
      });

      child.on('error', (error) => {
        if (terminationError) return;
        if (error.name === 'AbortError') {
          fail(error);
          return;
        }
        fail(new ExecError(this.file, args, null, stdoutText(), error.message, { cause: error }));
      });

      child.on('close', async (code) => {
        cleanup();
        if (settled) return;
        await terminationPromise;
        if (terminationError) {
          settled = true;
          reject(terminationError);
          return;
        }
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

async function resolveEnv(
  env: NodeJS.ProcessEnv | EnvSource | undefined
): Promise<NodeJS.ProcessEnv | undefined> {
  return typeof env === 'function' ? await env() : env;
}

function composeEnv(
  base: NodeJS.ProcessEnv | undefined,
  overlay: NodeJS.ProcessEnv | undefined
): NodeJS.ProcessEnv | undefined {
  if (!base && !overlay) return undefined;
  if (!base) return { ...process.env, ...overlay };
  return overlay ? { ...base, ...overlay } : base;
}
