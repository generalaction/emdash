import * as nodePty from 'node-pty';
import type { IPty } from 'node-pty';
import { log } from '@main/lib/logger';
import { normalizeSignal } from './exit-signals';
import { suppressExpectedNodePtyErrors } from './node-pty-errors';
import type { Pty, PtyDimensions, PtyExitInfo } from './pty';

export interface LocalSpawnOptions extends PtyDimensions {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

const MIN_COLS = 2;
const MIN_ROWS = 1;

export function spawnLocalPty(options: LocalSpawnOptions): LocalPtySession {
  const { id, command, args, cwd, env, cols, rows } = options;

  log.info('LocalPtySession:spawn', {
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
      cols,
      rows,
      cwd,
      env,
    });
    suppressExpectedNodePtyErrors(proc);
    return new LocalPtySession(id, proc);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to spawn PTY: ${message}`);
  }
}

export class LocalPtySession implements Pty {
  readonly id: string;

  constructor(
    id: string,
    private readonly proc: IPty
  ) {
    this.id = id;
  }

  write(data: string): void {
    this.proc.write(data);
  }

  resize(cols: number, rows: number): void {
    const c = Number.isFinite(cols) ? Math.max(MIN_COLS, Math.floor(cols)) : MIN_COLS;
    const r = Number.isFinite(rows) ? Math.max(MIN_ROWS, Math.floor(rows)) : MIN_ROWS;
    try {
      this.proc.resize(c, r);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/EBADF|ENOTTY|ioctl\(2\) failed|not open|Napi::Error/.test(msg)) {
        return;
      }
      log.error('LocalPtySession:resize failed', { cols: c, rows: r, error: msg });
    }
  }

  kill(): void {
    if (canSignalProcess()) {
      try {
        signalProcessGroup(this.proc.pid, 'SIGCONT');
      } catch {
        // A paused process may need SIGCONT before node-pty's kill can take effect.
      }
    }
    this.proc.kill();
  }

  pause(): void {
    if (!canSignalProcess()) throw new Error('Process pausing is not supported on this platform');
    signalProcessGroup(this.proc.pid, 'SIGSTOP');
  }

  resume(): void {
    if (!canSignalProcess()) throw new Error('Process pausing is not supported on this platform');
    signalProcessGroup(this.proc.pid, 'SIGCONT');
  }

  onData(handler: (data: string) => void): void {
    this.proc.onData(handler);
  }

  onExit(handler: (info: PtyExitInfo) => void): void {
    this.proc.onExit(({ exitCode, signal }) => {
      handler({ exitCode, signal: normalizeSignal(signal) });
    });
  }

  getPid(): number {
    return this.proc.pid;
  }
}

function canSignalProcess(): boolean {
  return process.platform !== 'win32';
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (isNoSuchProcessError(error)) {
      process.kill(pid, signal);
      return;
    }
    throw error;
  }
}

function isNoSuchProcessError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH';
}
