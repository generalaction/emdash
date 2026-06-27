import * as nodePty from 'node-pty';
import type { IPty } from 'node-pty';
import { log } from '@main/lib/logger';
import { normalizeSignal } from './exit-signals';
import { suppressExpectedNodePtyErrors } from './node-pty-errors';
import { PosixPtyTerminator } from './posix-pty-terminator';
import type { Pty, PtyDimensions, PtyExitInfo } from './pty';
import {
  extractSgrMouseSequences,
  stripSgrMouseSequences,
  windowsConsoleInputInjector,
  type WindowsConsoleInputInjector,
} from './windows-console-input';

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
  private killed = false;
  private windowsWriteQueue: Promise<void> = Promise.resolve();

  constructor(
    id: string,
    private readonly proc: IPty,
    private readonly posixTerminator: Pick<
      PosixPtyTerminator,
      'kill' | 'markExited'
    > = new PosixPtyTerminator(),
    private readonly windowsInputInjector: WindowsConsoleInputInjector = windowsConsoleInputInjector
  ) {
    this.id = id;
  }

  write(data: string | Buffer): void {
    if (process.platform === 'win32') {
      this.windowsWriteQueue = this.windowsWriteQueue
        .then(() => this.writeWindows(data))
        .catch((error: unknown) => {
          log.warn('LocalPtySession: Windows write failed', { error: String(error) });
        });
      return;
    }
    this.proc.write(data);
  }

  private async writeWindows(data: string | Buffer): Promise<void> {
    const mouseInput = extractSgrMouseSequences(data);
    if (!mouseInput) {
      this.proc.write(data);
      return;
    }

    try {
      await this.windowsInputInjector.injectText(this.proc.pid, mouseInput);
    } catch (error) {
      log.warn('LocalPtySession: Windows mouse injection failed', { error: String(error) });
    }
    const passthroughInput = stripSgrMouseSequences(data);
    if (passthroughInput.length > 0) {
      this.proc.write(passthroughInput);
    }
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
    if (this.killed) return;
    this.killed = true;

    const pid = this.proc.pid;
    if (process.platform === 'win32' || !Number.isInteger(pid) || pid <= 0) {
      this.killPty();
      return;
    }

    this.posixTerminator.kill(pid, () => this.killPty());
  }

  private killPty(): void {
    try {
      this.proc.kill();
    } catch {}
  }

  onData(handler: (data: string) => void): void {
    this.proc.onData(handler);
  }

  onExit(handler: (info: PtyExitInfo) => void): void {
    this.proc.onExit(({ exitCode, signal }) => {
      this.posixTerminator.markExited();
      handler({ exitCode, signal: normalizeSignal(signal) });
    });
  }

  getPid(): number {
    return this.proc.pid;
  }
}
