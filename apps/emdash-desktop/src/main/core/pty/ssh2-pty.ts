import { err, ok, type Result } from '@emdash/shared';
import type { ClientChannel } from 'ssh2';
import type { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import { log } from '@main/lib/logger';
import { normalizeSignal } from './exit-signals';
import type { Pty, PtyDimensions, PtyExitInfo } from './pty';

export type Ssh2OpenError = {
  readonly kind: 'channel-open-failed';
  readonly message: string;
};

export interface Ssh2SpawnOptions extends PtyDimensions {
  id: string;
  command: string;
}

export class Ssh2PtySession implements Pty {
  readonly id: string;
  /**
   * Input deferred while the ssh2 channel's send buffer is full. Without this,
   * `write()` ignored `channel.write()`'s return value and kept blasting the
   * channel — a tmux mouse drag floods SGR reports faster than the remote can
   * drain, freezing the panel and the remote tmux server. See issue #1994.
   */
  private readonly pendingWrites: string[] = [];
  private draining = false;
  private closed = false;

  constructor(
    id: string,
    private readonly channel: ClientChannel
  ) {
    this.id = id;
  }

  write(data: string): void {
    if (this.closed) return;
    if (this.draining) {
      this.pendingWrites.push(data);
      return;
    }
    // `write()` returning false means the buffer is over its high-water mark:
    // the data is still queued by ssh2, but we must stop writing until `drain`.
    if (!this.channel.write(data)) {
      this.draining = true;
      this.channel.once('drain', this.onDrain);
    }
  }

  private readonly onDrain = (): void => {
    this.draining = false;
    while (!this.closed && this.pendingWrites.length > 0) {
      const chunk = this.pendingWrites.shift()!;
      if (!this.channel.write(chunk)) {
        this.draining = true;
        this.channel.once('drain', this.onDrain);
        return;
      }
    }
  };

  resize(cols: number, rows: number): void {
    try {
      this.channel.setWindow(rows, cols, 0, 0);
    } catch (err: unknown) {
      log.warn('Ssh2PtySession:resize failed', {
        cols,
        rows,
        error: String((err as Error)?.message ?? err),
      });
    }
  }

  kill(): void {
    this.closed = true;
    this.pendingWrites.length = 0;
    this.channel.removeListener('drain', this.onDrain);
    try {
      this.channel.close();
    } catch {}
  }

  onData(handler: (data: string) => void): void {
    this.channel.on('data', (chunk: Buffer) => {
      handler(chunk.toString('utf-8'));
    });
  }

  onExit(handler: (info: PtyExitInfo) => void): void {
    this.channel.on('close', (exitCode: number | null, signal: string | null) => {
      handler({ exitCode: exitCode ?? undefined, signal: normalizeSignal(signal) });
    });
  }
}

export async function openSsh2Pty(
  proxy: SshClientProxy,
  options: Ssh2SpawnOptions
): Promise<Result<Ssh2PtySession, Ssh2OpenError>> {
  const { id, command, cols, rows } = options;
  return new Promise((resolve) => {
    proxy.execPty(
      command,
      {
        pty: {
          term: 'xterm-256color',
          cols,
          rows,
          // width/height in pixels — set to 0, terminal uses cols/rows instead
          width: 0,
          height: 0,
        },
      },
      (e, channel) => {
        if (e) {
          const message = e instanceof Error ? e.message : String(e);
          return resolve(err({ kind: 'channel-open-failed', message }));
        }
        resolve(ok(new Ssh2PtySession(id, channel)));
      }
    );
  });
}
