import {
  buildRemoteShellCommand,
  FALLBACK_REMOTE_SHELL_PROFILE,
  type RemoteShellProfile,
} from '@main/core/ssh/remote-shell-profile';
import type { SshClientProxy } from '@main/core/ssh/ssh-client-proxy';
import { quoteShellArg } from '@main/utils/shellEscape';
import type { ExecOptions, ExecResult, IExecutionContext } from './types';

/**
 * Builds the full shell command string to send over SSH.
 * When `root` is provided the command runs inside `cd root &&`.
 * Args are shell-escaped for safe remote execution.
 */
export function buildSshCommand(
  root: string | undefined,
  command: string,
  args: string[],
  profile?: RemoteShellProfile
): string {
  const escaped = args.map(quoteShellArg).join(' ');
  const inner = args.length ? `${command} ${escaped}` : command;
  const body = root ? `cd ${quoteShellArg(root)} && ${inner}` : inner;
  return buildRemoteShellCommand(profile ?? FALLBACK_REMOTE_SHELL_PROFILE, body);
}

export class SshExecutionContext implements IExecutionContext {
  readonly root?: string;
  readonly supportsLocalSpawn = false;

  private readonly _lifetime = new AbortController();

  constructor(
    private readonly proxy: SshClientProxy,
    opts: { root?: string } = {}
  ) {
    this.root = opts.root;
  }

  async exec(command: string, args: string[] = [], opts: ExecOptions = {}): Promise<ExecResult> {
    const { signal } = opts;
    const profile = await this.proxy.getRemoteShellProfile();
    const full = buildSshCommand(this.root, command, args, profile);
    const combined = this._signal(signal);

    return new Promise((resolve, reject) => {
      if (combined.aborted) {
        reject(combined.reason ?? new DOMException('Aborted', 'AbortError'));
        return;
      }

      this.proxy.client.exec(full, (execErr, stream) => {
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

        stream.on('close', (code: number | null) => {
          combined.removeEventListener('abort', onAbort);
          if (settled) return;
          settled = true;
          if ((code ?? 0) === 0) {
            resolve({ stdout, stderr });
          } else {
            reject(
              Object.assign(new Error(stderr || `Process exited with code ${code}`), {
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

  async execStreaming(
    command: string,
    args: string[],
    onChunk: (chunk: string) => boolean,
    opts: { signal?: AbortSignal } = {}
  ): Promise<void> {
    const { signal } = opts;
    const profile = await this.proxy.getRemoteShellProfile();
    const full = buildSshCommand(this.root, command, args, profile);
    const combined = this._signal(signal);

    return new Promise((resolve, reject) => {
      if (combined.aborted) {
        reject(combined.reason ?? new DOMException('Aborted', 'AbortError'));
        return;
      }

      this.proxy.client.exec(full, (execErr, stream) => {
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

  private _signal(callerSignal?: AbortSignal): AbortSignal {
    const signals: AbortSignal[] = [this._lifetime.signal];
    if (callerSignal) signals.push(callerSignal);
    return AbortSignal.any(signals);
  }
}
