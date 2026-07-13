import {
  normalizeSignal,
  PosixPtyTerminator,
  type PtyExitInfo,
  type PtyProcess,
  type PtySpawner,
  type PtySpawnSpec,
} from '@services/pty/api';

const MIN_COLS = 2;
const MIN_ROWS = 1;

type NodePtyModule = {
  spawn(
    command: string,
    args: string[],
    options: {
      name: string;
      cols: number;
      rows: number;
      cwd: string;
      env: Record<string, string>;
    }
  ): NodePtyLike;
};

type NodePtyLike = {
  pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(handler: (data: string) => void): void;
  onExit(
    handler: (event: { exitCode: number | null; signal?: number | string | null }) => void
  ): void;
  on?: (event: 'error', handler: (error: NodeJS.ErrnoException) => void) => void;
};

let nodePtyPromise: Promise<NodePtyModule> | null = null;

export class NodePtySpawner implements PtySpawner {
  async spawn(spec: PtySpawnSpec): Promise<PtyProcess> {
    try {
      const nodePty = await loadNodePty();
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
    private readonly proc: NodePtyLike,
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

async function loadNodePty(): Promise<NodePtyModule> {
  nodePtyPromise ??= import('node-pty').then((mod) => mod as NodePtyModule);
  return nodePtyPromise;
}

function suppressExpectedNodePtyErrors(
  proc: NodePtyLike,
  platform: NodeJS.Platform = process.platform
): void {
  if (platform !== 'win32') return;
  proc.on?.('error', (error) => {
    if (error.code === 'EPIPE' || error.code === 'EIO') return;
    process.stderr.write(`node-pty: unexpected PTY error: ${error.message}\n`);
  });
}
