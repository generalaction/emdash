import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import type { ExecOptions, ExecResult, IExecutionContext } from './types';

const execFileAsync = promisify(execFile);

export class LocalExecutionContext implements IExecutionContext {
  readonly root: string;
  readonly supportsLocalSpawn = true;

  private readonly _lifetime = new AbortController();

  constructor(opts: { root?: string } = {}) {
    this.root = opts.root ?? '';
  }

  private _signal(callerSignal?: AbortSignal): AbortSignal {
    const signals: AbortSignal[] = [this._lifetime.signal];
    if (callerSignal) signals.push(callerSignal);
    return AbortSignal.any(signals);
  }

  private resolveCommand(command: string): string {
    return command === 'git' ? GIT_EXECUTABLE : command;
  }

  exec(command: string, args: string[] = [], opts: ExecOptions = {}): Promise<ExecResult> {
    const { timeout, maxBuffer } = opts;
    return execFileAsync(this.resolveCommand(command), args, {
      cwd: this.root || undefined,
      timeout,
      maxBuffer,
      signal: this._signal(opts.signal),
    }) as Promise<ExecResult>;
  }

  execStreaming(
    command: string,
    args: string[],
    onChunk: (chunk: string) => boolean,
    opts: { signal?: AbortSignal } = {}
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const signal = this._signal(opts.signal);

      if (signal.aborted) {
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        return;
      }

      const child = spawn(this.resolveCommand(command), args, { cwd: this.root || undefined });

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
        if (settled) return;
        if (!onChunk(chunk)) {
          child.kill('SIGTERM');
        }
      });

      child.on('error', (err) => {
        signal.removeEventListener('abort', onAbort);
        if (!settled) {
          settled = true;
          reject(err);
        }
      });

      child.on('close', () => {
        signal.removeEventListener('abort', onAbort);
        if (!settled) {
          settled = true;
          resolve();
        }
      });
    });
  }

  dispose(): void {
    this._lifetime.abort();
  }
}
