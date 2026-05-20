import * as nodePty from 'node-pty';
import type { IDisposable, IPty } from 'node-pty';
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
const localPtys = new Set<LocalPtySession>();

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
  private killed = false;
  private exited = false;
  private suppressExit = false;
  private readonly subscriptions = new Set<IDisposable>();

  constructor(
    id: string,
    private readonly proc: IPty
  ) {
    this.id = id;
    localPtys.add(this);
  }

  write(data: string): void {
    if (this.killed || this.exited) return;
    this.proc.write(data);
  }

  resize(cols: number, rows: number): void {
    if (this.killed || this.exited) return;
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
    if (this.killed || this.exited) return;
    this.killed = true;
    this.disposeSubscriptions();
    localPtys.delete(this);
    this.proc.kill();
  }

  shutdown(): void {
    this.suppressExit = true;
    this.kill();
  }

  onData(handler: (data: string) => void): void {
    this.trackSubscription(
      this.proc.onData((data) => {
        if (!this.killed && !this.exited) handler(data);
      })
    );
  }

  onExit(handler: (info: PtyExitInfo) => void): void {
    this.trackSubscription(
      this.proc.onExit(({ exitCode, signal }) => {
        this.exited = true;
        localPtys.delete(this);
        queueMicrotask(() => this.disposeSubscriptions());
        if (this.suppressExit) return;
        handler({ exitCode, signal: normalizeSignal(signal) });
      })
    );
  }

  getPid(): number {
    return this.proc.pid;
  }

  private trackSubscription(subscription: IDisposable): void {
    this.subscriptions.add(subscription);
  }

  private disposeSubscriptions(): void {
    for (const subscription of this.subscriptions) {
      try {
        subscription.dispose();
      } catch {}
    }
    this.subscriptions.clear();
  }
}

export function shutdownLocalPtys(): void {
  for (const pty of [...localPtys]) {
    try {
      pty.shutdown();
    } catch {}
  }
}
