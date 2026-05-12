import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { platform } from '@main/core/platform';
import {
  GIT_EXECUTABLE,
  isMissingGitExecutableError,
  missingGitExecutableError,
} from '@main/core/utils/exec';
import type { ExecOptions, ExecResult, IExecutionContext } from './types';

const execFileAsync = promisify(execFile);

/**
 * On Windows the Electron main process inherits the GUI PATH (system + user)
 * but **not** the user's interactive-shell modifications (e.g. nvm switches,
 * pnpm setup script edits). That means `where codex` from inside Electron
 * frequently fails to find a CLI the user can invoke from their terminal.
 *
 * We sidestep this by augmenting the spawn env with well-known install dirs
 * (npm global bin, VS Code's bin, JetBrains Toolbox scripts, Git for Windows,
 * etc. — see `src/main/core/platform/windows.ts`). The augmentation is a no-op
 * on POSIX. Cached at the `platform` adapter level so this is essentially
 * free per call.
 */
function buildSpawnEnv(): NodeJS.ProcessEnv | undefined {
  if (!platform.isWindows) return undefined;
  return platform.augmentEnv(process.env);
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
    return command === 'git' ? GIT_EXECUTABLE : command;
  }

  exec(command: string, args: string[] = [], opts: ExecOptions = {}): Promise<ExecResult> {
    const { timeout, maxBuffer } = opts;
    return execFileAsync(this.resolveCommand(command), args, {
      cwd: this.root || undefined,
      timeout,
      maxBuffer,
      signal: this._signal(opts.signal),
      env: buildSpawnEnv(),
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
        env: buildSpawnEnv(),
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
