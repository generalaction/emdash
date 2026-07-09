import {
  normalizeSignal,
  PosixPtyTerminator,
  type PtyExitInfo,
  type PtyProcess,
  type PtySpawner,
  type PtySpawnSpec,
} from '@emdash/core/pty';
import * as nodePty from 'node-pty';
import type { IPty } from 'node-pty';

const MIN_COLS = 2;
const MIN_ROWS = 1;

export class NodePtySpawner implements PtySpawner {
  spawn(spec: PtySpawnSpec): PtyProcess {
    try {
      const proc = nodePty.spawn(spec.command, spec.args, {
        name: 'xterm-256color',
        cols: spec.cols,
        rows: spec.rows,
        cwd: spec.cwd,
        env: spec.env,
      });
      suppressExpectedNodePtyErrors(proc);
      return new NodePtyProcess(proc);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(`Failed to spawn PTY: ${message}`);
    }
  }
}

class NodePtyProcess implements PtyProcess {
  private killed = false;

  constructor(
    private readonly proc: IPty,
    private readonly posixTerminator: Pick<
      PosixPtyTerminator,
      'kill' | 'markExited'
    > = new PosixPtyTerminator()
  ) {}

  write(data: string): void {
    this.proc.write(data);
  }

  resize(cols: number, rows: number): void {
    const c = Number.isFinite(cols) ? Math.max(MIN_COLS, Math.floor(cols)) : MIN_COLS;
    const r = Number.isFinite(rows) ? Math.max(MIN_ROWS, Math.floor(rows)) : MIN_ROWS;
    try {
      this.proc.resize(c, r);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      if (/EBADF|ENOTTY|ioctl\(2\) failed|not open|Napi::Error/.test(message)) return;
      process.stderr.write(`NodePtyProcess: resize failed: ${message}\n`);
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
      handler({ exitCode, signal: normalizeSignal(signal) ?? null });
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

type NodePtyWithErrorEvents = IPty & {
  on?: (event: 'error', handler: (error: NodeJS.ErrnoException) => void) => void;
};

function suppressExpectedNodePtyErrors(
  proc: IPty,
  platform: NodeJS.Platform = process.platform
): void {
  if (platform !== 'win32') return;
  (proc as NodePtyWithErrorEvents).on?.('error', (error) => {
    if (error.code === 'EPIPE' || error.code === 'EIO') return;
    process.stderr.write(`node-pty: unexpected PTY error: ${error.message}\n`);
  });
}
