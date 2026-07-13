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

function withNonInteractiveGitEnv(command: string, gitExecutable?: string): string {
  if (command !== 'git') return command;
  const envPrefix = Object.entries(NON_INTERACTIVE_GIT_ENV)
    .map(([key, value]) => `${key}=${quoteShellArg(value)}`)
    .join(' ');
  return `${envPrefix} ${quoteShellArg(gitExecutable ?? command)}`;
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
  gitExecutable?: string
): string {
  const escaped = args.map(quoteShellArg).join(' ');
  const executable = withNonInteractiveGitEnv(command, gitExecutable);
  const inner = args.length ? `${executable} ${escaped}` : executable;
  const body = root ? `cd ${quoteShellArg(root)} && ${inner}` : inner;
  return buildRemoteShellCommand(profile ?? FALLBACK_REMOTE_SHELL_PROFILE, body);
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

        let stdout = '';
        let stderr = '';
        let settled = false;

        const onAbort = () => {
          if (settled) return;
          settled = true;
          stream.destroy();
          reject(combined.reason ?? new DOMException('Aborted', 'AbortError'));
        };
        combined.addEventListener('abort', onAbort, { once: true });

        stream.on('data', (d: Buffer) => {
          stdout += d.toString('utf-8');
        });
        stream.stderr.on('data', (d: Buffer) => {
          stderr += d.toString('utf-8');
        });

        stream.on('close', (code: number | null | undefined, signal?: string) => {
          combined.removeEventListener('abort', onAbort);
          if (settled) return;
          settled = true;
          if (code === 0) {
            resolve({ stdout, stderr });
          } else {
            const fallbackMessage =
              code === null
                ? `Process terminated by signal ${signal ?? 'unknown'}`
                : code === undefined
                  ? 'SSH process closed without exit status'
                  : `Process exited with code ${code}`;
            reject(
              Object.assign(new Error(stderr || fallbackMessage), {
                stdout,
                stderr,
              })
            );
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
