import { execFile, spawn, type ExecFileOptions } from 'node:child_process';
import {
  getGitExecutable,
  isMissingGitExecutableError,
  missingGitExecutableError,
} from '@main/core/utils/exec';
import { buildExternalToolEnv } from '@main/utils/childProcessEnv';
import { NON_INTERACTIVE_GIT_ENV } from './non-interactive-git-env';
import type { ExecOptions, ExecResult, IExecutionContext } from './types';

function execFileAsync(
  command: string,
  args: string[],
  options: ExecFileOptions
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { ...options, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stderr, stdout }));
        return;
      }
      resolve({ stderr, stdout });
    });
  });
}

function buildNonInteractiveGitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...NON_INTERACTIVE_GIT_ENV,
  };
}

function buildExecEnv(command: string, overlay: ExecOptions['env']): NodeJS.ProcessEnv | undefined {
  if (!overlay) return command === 'git' ? buildNonInteractiveGitEnv() : undefined;
  return {
    ...buildExternalToolEnv(),
    ...overlay,
    ...(command === 'git' ? NON_INTERACTIVE_GIT_ENV : {}),
  };
}

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
    return command === 'git' ? getGitExecutable() : command;
  }

  exec(command: string, args: string[] = [], opts: ExecOptions = {}): Promise<ExecResult> {
    const { timeout, maxBuffer } = opts;
    return execFileAsync(this.resolveCommand(command), args, {
      cwd: this.root || undefined,
      env: buildExecEnv(command, opts.env),
      timeout,
      maxBuffer,
      signal: this._signal(opts.signal),
    }).catch((error) => {
      if (command === 'git' && isMissingGitExecutableError(error)) {
        throw missingGitExecutableError();
      }
      throw error;
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

      const child = spawn(this.resolveCommand(command), args, {
        cwd: this.root || undefined,
        env: command === 'git' ? buildNonInteractiveGitEnv() : undefined,
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
        if (settled) return;
        if (!onChunk(chunk)) {
          child.kill('SIGTERM');
        }
      });

      child.on('error', (err) => {
        signal.removeEventListener('abort', onAbort);
        if (!settled) {
          settled = true;
          reject(
            command === 'git' && isMissingGitExecutableError(err)
              ? missingGitExecutableError()
              : err
          );
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
