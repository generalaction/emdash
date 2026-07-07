import * as nodePty from 'node-pty';
import type { IPty } from 'node-pty';
import type { Logger } from '@emdash/shared/logger';
import type { PtyExitInfo, PtyHandle, PtySpawnSpec } from '../transport';
import { normalizeSignal } from './exit-signals';
import { suppressExpectedNodePtyErrors } from './node-pty-errors';
import { PosixPtyTerminator } from './posix-pty-terminator';

const MIN_COLS = 2;
const MIN_ROWS = 1;

export type LocalPtySpawnSpec = PtySpawnSpec & {
  logger: Logger;
};

export function spawnLocalPty(options: LocalPtySpawnSpec): LocalPtySession {
  const { id, command, args, cwd, env, cols, rows, logger } = options;

  logger.info('PtyConversations:spawnLocalPty', {
    id,
    command,
    args,
    cwd,
    cols,
    rows,
  });

  try {
    const proc = nodePty.spawn(command, args, {
      name: 'xterm-256color',
      cols: clampCols(cols),
      rows: clampRows(rows),
      cwd,
      env,
    });
    suppressExpectedNodePtyErrors(proc, logger);
    return new LocalPtySession(id, proc, logger);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to spawn PTY: ${message}`);
  }
}

export class LocalPtySession implements PtyHandle {
  readonly id: string;
  private killed = false;

  constructor(
    id: string,
    private readonly proc: IPty,
    private readonly logger: Pick<Logger, 'error'>,
    private readonly posixTerminator: Pick<
      PosixPtyTerminator,
      'kill' | 'markExited'
    > = new PosixPtyTerminator()
  ) {
    this.id = id;
  }

  write(data: string): void {
    this.proc.write(data);
  }

  resize(cols: number, rows: number): void {
    const c = clampCols(cols);
    const r = clampRows(rows);
    try {
      this.proc.resize(c, r);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/EBADF|ENOTTY|ioctl\(2\) failed|not open|Napi::Error/.test(msg)) {
        return;
      }
      this.logger.error('PtyConversations:resize failed', { cols: c, rows: r, error: msg });
    }
  }

  kill(): void {
    if (this.killed) return;
    this.killed = true;

    const pid = this.proc.pid;
    if (process.platform === 'win32' || !Number.isInteger(pid) || pid <= 0) {
      this.killPty();
      return;
    }

    this.posixTerminator.kill(pid, () => this.killPty());
  }

  onData(handler: (data: string) => void): void {
    this.proc.onData(handler);
  }

  onExit(handler: (info: PtyExitInfo) => void): void {
    this.proc.onExit(({ exitCode, signal }) => {
      this.posixTerminator.markExited();
      handler({
        exitCode: exitCode ?? null,
        ...(normalizeSignal(signal) ? { signal: normalizeSignal(signal) } : {}),
      });
    });
  }

  getPid(): number {
    return this.proc.pid;
  }

  private killPty(): void {
    try {
      this.proc.kill();
    } catch {}
  }
}

function clampCols(cols: number): number {
  return Number.isFinite(cols) ? Math.max(MIN_COLS, Math.floor(cols)) : MIN_COLS;
}

function clampRows(rows: number): number {
  return Number.isFinite(rows) ? Math.max(MIN_ROWS, Math.floor(rows)) : MIN_ROWS;
}
