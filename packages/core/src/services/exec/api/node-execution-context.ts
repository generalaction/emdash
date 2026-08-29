import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { classifySpawnPurpose, recordSpawn } from '@emdash/shared/perf';
import type { EnvSource } from '#primitives/exec/api';
import { planExecutableLaunch, type FileExists } from '#primitives/exec/node';
import type {
  ExecContextOptions,
  ExecStreamingResult,
  IExecutionContext,
} from './execution-context';
import type { ExecResult } from './types';

const execFileAsync = promisify(execFile);

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
    const plan = planExecutableLaunch({
      platform: this.platform,
      command,
      args,
      cwd: this.root || undefined,
      env,
      fileExists: this.fileExists,
    });
    recordSpawn(classifySpawnPurpose(command, args), plan.executable);
    return (await execFileAsync(plan.executable, plan.args, {
      cwd: plan.cwd,
      env,
      timeout: opts.timeout,
      maxBuffer: opts.maxBuffer,
      signal: this.signal(opts.signal),
      windowsVerbatimArguments: plan.windowsVerbatimArguments,
    })) as ExecResult;
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
        env,
        windowsVerbatimArguments: plan.windowsVerbatimArguments,
      });
      let settled = false;

      const onAbort = () => {
        if (settled) return;
        settled = true;
        child.kill('SIGTERM');
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        if (!settled && !onChunk(chunk)) child.kill('SIGTERM');
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        if (!settled) onChunk(chunk);
      });

      child.on('error', (error) => {
        signal.removeEventListener('abort', onAbort);
        if (settled) return;
        settled = true;
        reject(error);
      });
      child.on('close', (code) => {
        signal.removeEventListener('abort', onAbort);
        if (settled) return;
        settled = true;
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
