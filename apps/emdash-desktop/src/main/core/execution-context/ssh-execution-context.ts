import type { ClientChannel } from 'ssh2';
import {
  buildRemoteShellCommand,
  FALLBACK_REMOTE_SHELL_PROFILE,
  type RemoteShellProfile,
} from '@main/core/ssh/lifecycle/remote-shell-profile';
import type { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import { getGitExecutable } from '@main/core/utils/exec';
import { quoteShellArg } from '@main/utils/shellEscape';
import { NON_INTERACTIVE_GIT_ENV } from './non-interactive-git-env';
import type { ExecOptions, ExecResult, IExecutionContext } from './types';

const DEFAULT_MAX_BUFFER = 1024 * 1024;

function executableWithNonInteractiveGitEnv(command: string, gitExecutable?: string): string {
  const executable = quoteShellArg(gitExecutable ?? command);
  if (command !== 'git') return executable;
  const envPrefix = Object.entries(NON_INTERACTIVE_GIT_ENV)
    .map(([key, value]) => `${key}=${quoteShellArg(value)}`)
    .join(' ');
  return `${envPrefix} ${executable}`;
}

function definedEnvironment(env: ExecOptions['env']): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env ?? {}).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
}

/**
 * Builds the full shell command string to send over SSH.
 * When `root` is provided the command runs inside `cd root &&`.
 * Args are shell-escaped for safe remote execution.
 */
export function buildSshCommand(
  root: string | undefined,
  command: string,
  args: string[],
  profile?: RemoteShellProfile,
  gitExecutable?: string,
  env: ExecOptions['env'] = {}
): string {
  const escaped = args.map(quoteShellArg).join(' ');
  const executable = executableWithNonInteractiveGitEnv(command, gitExecutable);
  const inner = args.length ? `${executable} ${escaped}` : executable;
  const body = root ? `cd ${quoteShellArg(root)} && ${inner}` : inner;
  return buildRemoteShellCommand(
    profile ?? FALLBACK_REMOTE_SHELL_PROFILE,
    body,
    definedEnvironment(env)
  );
}

type BufferedExecError = Error & {
  code?: number | string;
  exitCode?: number | null;
  killed?: boolean;
  signal?: string;
  stdout?: string;
  stderr?: string;
};

function abortError(): DOMException {
  return new DOMException('The operation was aborted', 'AbortError');
}

function executionError(
  message: string,
  details: Omit<BufferedExecError, keyof Error>
): BufferedExecError {
  return Object.assign(new Error(message), details);
}

function timeoutError(timeout: number, stdout: string, stderr: string): BufferedExecError {
  const error = executionError(`Remote command timed out after ${timeout}ms`, {
    code: 'ETIMEDOUT',
    exitCode: null,
    killed: true,
    signal: 'SIGTERM',
    stderr,
    stdout,
  });
  error.name = 'TimeoutError';
  return error;
}

function maxBufferError(
  stream: 'stdout' | 'stderr',
  stdout: string,
  stderr: string
): BufferedExecError {
  return executionError(`${stream} exceeded maxBuffer`, {
    code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
    exitCode: null,
    stderr,
    stdout,
  });
}

export class SshExecutionContext implements IExecutionContext {
  readonly root?: string;
  readonly supportsLocalSpawn = false;

  private readonly _lifetime = new AbortController();

  constructor(
    private readonly proxy: SshClientProxy,
    private readonly contextOptions: { root?: string; connectionId?: string } = {}
  ) {
    this.root = contextOptions.root;
  }

  async exec(command: string, args: string[] = [], opts: ExecOptions = {}): Promise<ExecResult> {
    const maxBuffer = opts.maxBuffer ?? DEFAULT_MAX_BUFFER;
    if (!Number.isFinite(maxBuffer) || maxBuffer < 0) {
      throw Object.assign(new RangeError('maxBuffer must be a finite non-negative number'), {
        code: 'ERR_OUT_OF_RANGE',
      });
    }
    const combined = this._signal(opts.signal);

    return new Promise((resolve, reject) => {
      if (combined.aborted) {
        reject(abortError());
        return;
      }

      let stream: ClientChannel | undefined;
      let settled = false;
      let destroyed = false;
      let stdoutBytes = 0;
      let stderrBytes = 0;
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let timer: ReturnType<typeof setTimeout> | undefined;

      const stdout = () => Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = () => Buffer.concat(stderrChunks).toString('utf8');

      const destroyStream = () => {
        if (!stream || destroyed) return;
        destroyed = true;
        stream.destroy();
      };

      const removeStreamListeners = () => {
        if (!stream) return;
        stream.removeListener('data', onStdout);
        stream.stderr.removeListener('data', onStderr);
        stream.removeListener('close', onClose);
        stream.removeListener('error', onStreamError);
      };

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        timer = undefined;
        combined.removeEventListener('abort', onAbort);
        removeStreamListeners();
      };

      const resolveOnce = (result: ExecResult) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };

      const rejectOnce = (error: unknown, destroy = false) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (destroy) destroyStream();
        reject(error);
      };

      const appendChunk = (kind: 'stdout' | 'stderr', value: Buffer) => {
        if (settled) return;
        const chunks = kind === 'stdout' ? stdoutChunks : stderrChunks;
        const bytes = kind === 'stdout' ? stdoutBytes : stderrBytes;
        const remaining = Math.max(0, maxBuffer - bytes);
        if (remaining > 0) chunks.push(value.subarray(0, remaining));
        if (kind === 'stdout') stdoutBytes += Math.min(value.length, remaining);
        else stderrBytes += Math.min(value.length, remaining);
        if (value.length > remaining) {
          rejectOnce(maxBufferError(kind, stdout(), stderr()), true);
        }
      };

      const onStdout = (value: Buffer) => appendChunk('stdout', Buffer.from(value));
      const onStderr = (value: Buffer) => appendChunk('stderr', Buffer.from(value));
      const onClose = (code: number | null) => {
        if (code === 0) {
          resolveOnce({ stdout: stdout(), stderr: stderr() });
          return;
        }
        rejectOnce(
          executionError(stderr() || `Process exited with code ${code ?? 'unknown'}`, {
            code: code ?? undefined,
            exitCode: code,
            stderr: stderr(),
            stdout: stdout(),
          })
        );
      };
      const onStreamError = (error: Error) => {
        rejectOnce(
          Object.assign(error, {
            exitCode: null,
            stderr: stderr(),
            stdout: stdout(),
          }),
          true
        );
      };
      const onAbort = () => rejectOnce(abortError(), true);

      combined.addEventListener('abort', onAbort, { once: true });
      if (opts.timeout !== undefined && opts.timeout > 0) {
        timer = setTimeout(() => {
          rejectOnce(timeoutError(opts.timeout!, stdout(), stderr()), true);
        }, opts.timeout);
      }

      void this.proxy
        .getRemoteShellProfile()
        .then((profile) => {
          if (settled) return;
          const full = buildSshCommand(
            this.root,
            command,
            args,
            profile,
            this.gitExecutableFor(command),
            opts.env
          );
          this.proxy.exec(full, (execErr, openedStream) => {
            if (settled) {
              openedStream?.destroy();
              return;
            }
            if (execErr) {
              rejectOnce(execErr);
              return;
            }

            stream = openedStream;
            stream.on('data', onStdout);
            stream.stderr.on('data', onStderr);
            stream.on('close', onClose);
            stream.on('error', onStreamError);
          });
        })
        .catch((error: unknown) => rejectOnce(error));
    });
  }

  async refreshShellEnv(): Promise<void> {
    await this.proxy.refreshRemoteShellProfile();
  }

  async execStreaming(
    command: string,
    args: string[],
    onChunk: (chunk: string) => boolean,
    opts: { signal?: AbortSignal } = {}
  ): Promise<void> {
    const { signal } = opts;
    const profile = await this.proxy.getRemoteShellProfile();
    const full = buildSshCommand(this.root, command, args, profile, this.gitExecutableFor(command));
    const combined = this._signal(signal);

    return new Promise((resolve, reject) => {
      if (combined.aborted) {
        reject(combined.reason ?? new DOMException('Aborted', 'AbortError'));
        return;
      }

      this.proxy.exec(full, (execErr, stream) => {
        if (execErr) return reject(execErr);

        let settled = false;

        const onAbort = () => {
          if (settled) return;
          settled = true;
          stream.destroy();
          reject(combined.reason ?? new DOMException('Aborted', 'AbortError'));
        };
        combined.addEventListener('abort', onAbort, { once: true });

        stream.setEncoding('utf8');
        stream.on('data', (chunk: string) => {
          if (settled) return;
          if (!onChunk(chunk)) {
            stream.destroy();
          }
        });

        stream.on('close', () => {
          combined.removeEventListener('abort', onAbort);
          if (!settled) {
            settled = true;
            resolve();
          }
        });

        stream.on('error', (err: Error) => {
          combined.removeEventListener('abort', onAbort);
          if (!settled) {
            settled = true;
            reject(err);
          }
        });
      });
    });
  }

  dispose(): void {
    this._lifetime.abort();
  }

  private gitExecutableFor(command: string): string | undefined {
    if (command !== 'git' || !this.contextOptions.connectionId) return undefined;
    return getGitExecutable(this.contextOptions.connectionId);
  }

  private _signal(callerSignal?: AbortSignal): AbortSignal {
    const signals: AbortSignal[] = [this._lifetime.signal];
    if (callerSignal) signals.push(callerSignal);
    return AbortSignal.any(signals);
  }
}
