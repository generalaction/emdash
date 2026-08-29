import { spawn } from 'node:child_process';
import { classifySpawnPurpose, recordSpawn } from '@emdash/shared/perf';
import type { EnvSource } from '#primitives/exec/api';
import {
  createChildProcessTreeTerminator,
  planExecutableLaunch,
  type FileExists,
} from '#primitives/exec/node';
import { createBoundExec } from './bound-exec';
import type {
  ExecContextOptions,
  ExecStreamingResult,
  IExecutionContext,
} from './execution-context';
import type { ExecResult } from './types';

export type NodeExecutionContextOptions = {
  root?: string;
  env?: NodeJS.ProcessEnv | EnvSource;
  refreshShellEnv?: () => Promise<void>;
  platform?: NodeJS.Platform;
  fileExists?: FileExists;
};

export class NodeExecutionContext implements IExecutionContext {
  readonly supportsLocalSpawn = true;
  readonly root: string;

  private readonly lifetime = new AbortController();
  private readonly refreshShellEnvDelegate: (() => Promise<void>) | undefined;
  private readonly platform: NodeJS.Platform;
  private readonly fileExists: FileExists | undefined;

  constructor(options: NodeExecutionContextOptions = {}) {
    this.root = options.root ?? '';
    this.env = options.env;
    this.refreshShellEnvDelegate = options.refreshShellEnv;
    this.platform = options.platform ?? process.platform;
    this.fileExists = options.fileExists;
  }

  private readonly env: NodeJS.ProcessEnv | EnvSource | undefined;

  async exec(
    command: string,
    args: string[] = [],
    opts: ExecContextOptions = {}
  ): Promise<ExecResult> {
    const env = opts.env ?? (await this.resolveEnv());
    const signal = this.signal(opts.signal);
    if (signal.aborted) throw abortReason(signal);
    return createBoundExec({
      file: command,
      cwd: this.root || process.cwd(),
      env,
      platform: this.platform,
      fileExists: this.fileExists,
    }).exec(args, {
      maxBuffer: opts.maxBuffer,
      signal,
      timeoutMs: opts.timeout,
    });
  }

  async execStreaming(
    command: string,
    args: string[],
    onChunk: (chunk: string) => boolean,
    opts: { signal?: AbortSignal } = {}
  ): Promise<ExecStreamingResult> {
    const env = await this.resolveEnv();
    const plan = planExecutableLaunch({
      platform: this.platform,
      command,
      args,
      cwd: this.root || undefined,
      env,
      fileExists: this.fileExists,
    });
    return new Promise((resolve, reject) => {
      const signal = this.signal(opts.signal);
      if (signal.aborted) {
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        return;
      }

      recordSpawn(classifySpawnPurpose(command, args), plan.executable);
      const child = spawn(plan.executable, plan.args, {
        cwd: plan.cwd,
        detached: this.platform !== 'win32',
        env,
        windowsVerbatimArguments: plan.windowsVerbatimArguments,
      });
      const terminator = createChildProcessTreeTerminator(child, {
        platform: this.platform,
        processGroup: this.platform !== 'win32',
      });
      let settled = false;
      let stopped = false;
      let terminationPromise: Promise<void> | undefined;
      let terminationError: unknown;

      const startTermination = (error?: unknown): void => {
        if (settled) return;
        terminationError ??= error;
        terminationPromise ??= terminator.terminate();
      };

      const onAbort = () => {
        if (settled) return;
        startTermination(abortReason(signal));
      };
      signal.addEventListener('abort', onAbort, { once: true });

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        if (!settled && !stopped && !onChunk(chunk)) {
          stopped = true;
          startTermination();
          signal.removeEventListener('abort', onAbort);
        }
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        if (!settled && !stopped && !onChunk(chunk)) {
          stopped = true;
          startTermination();
          signal.removeEventListener('abort', onAbort);
        }
      });

      child.on('error', (error) => {
        signal.removeEventListener('abort', onAbort);
        if (settled) return;
        settled = true;
        reject(error);
      });
      child.on('close', async (code) => {
        signal.removeEventListener('abort', onAbort);
        if (settled) return;
        await terminationPromise;
        settled = true;
        if (terminationError) {
          reject(terminationError);
          return;
        }
        resolve({ exitCode: code });
      });
    });
  }

  dispose(): void {
    this.lifetime.abort();
  }

  async refreshShellEnv(): Promise<void> {
    await this.refreshShellEnvDelegate?.();
  }

  private signal(callerSignal?: AbortSignal): AbortSignal {
    return callerSignal
      ? AbortSignal.any([this.lifetime.signal, callerSignal])
      : this.lifetime.signal;
  }

  private async resolveEnv(): Promise<NodeJS.ProcessEnv | undefined> {
    return typeof this.env === 'function' ? await this.env() : this.env;
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Aborted', 'AbortError');
}
