import type { Client, ClientChannel } from 'ssh2';
import { err, ok, type Result } from '@shared/result';
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

  constructor(
    id: string,
    private readonly channel: ClientChannel
  ) {
    this.id = id;
  }

  write(data: string): void {
    this.channel.write(data);
  }

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
  sshClient: Client,
  options: Ssh2SpawnOptions
): Promise<Result<Ssh2PtySession, Ssh2OpenError>> {
  const { id, command, cols, rows } = options;
  return new Promise((resolve) => {
    sshClient.exec(
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
