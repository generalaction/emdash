import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { ExecContextOptions, IExecutionContext } from './execution-context';
import type { ExecResult } from './types';

const execFileAsync = promisify(execFile);

export class NodeExecutionContext implements IExecutionContext {
  readonly supportsLocalSpawn = true;
  readonly root: string;

  private readonly lifetime = new AbortController();

  constructor(options: { root?: string; env?: NodeJS.ProcessEnv } = {}) {
    this.root = options.root ?? '';
    this.env = options.env;
  }

  private readonly env: NodeJS.ProcessEnv | undefined;

  exec(command: string, args: string[] = [], opts: ExecContextOptions = {}): Promise<ExecResult> {
    return execFileAsync(command, args, {
      cwd: this.root || undefined,
      env: this.env,
      timeout: opts.timeout,
      maxBuffer: opts.maxBuffer,
      signal: this.signal(opts.signal),
    }) as Promise<ExecResult>;
  }

  execStreaming(
    command: string,
    args: string[],
    onChunk: (chunk: string) => boolean,
    opts: { signal?: AbortSignal } = {}
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const signal = this.signal(opts.signal);
      if (signal.aborted) {
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        return;
      }

      const child = spawn(command, args, {
        cwd: this.root || undefined,
        env: this.env,
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
      child.on('close', () => {
        signal.removeEventListener('abort', onAbort);
        if (settled) return;
        settled = true;
        resolve();
      });
    });
  }

  dispose(): void {
    this.lifetime.abort();
  }

  private signal(callerSignal?: AbortSignal): AbortSignal {
    return callerSignal
      ? AbortSignal.any([this.lifetime.signal, callerSignal])
      : this.lifetime.signal;
  }
}
