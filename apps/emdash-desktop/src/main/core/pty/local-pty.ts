import * as nodePty from 'node-pty';
import type { IPty } from 'node-pty';
import { log } from '@main/lib/logger';
import { normalizeSignal } from './exit-signals';
import { suppressExpectedNodePtyErrors } from './node-pty-errors';
import { collectLocalDescendantPidsAsync } from './process-tree';
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

/** Grace period between the SIGTERM and the SIGKILL escalation. */
const KILL_GRACE_MS = 2000;

/** SIGTERM/SIGKILL individual pids, ignoring any that are already gone. */
function signalPids(pids: number[], signal: NodeJS.Signals): void {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {}
  }
}

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
  private killTimer: ReturnType<typeof setTimeout> | null = null;
  private descendantKillTimer: ReturnType<typeof setTimeout> | null = null;
  private killed = false;

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
    if (this.killed) return;
    this.killed = true;

    const pid = this.proc.pid;
    if (process.platform === 'win32' || !Number.isInteger(pid) || pid <= 0) {
      try {
        this.proc.kill();
      } catch {}
      return;
    }

    // Snapshot detached descendants BEFORE any signal. Children that called
    // setsid() (the watchman daemon, ts-checker-rspack-plugin workers, sudo'd
    // processes) form their own process group and escape a kill() aimed at the
    // PTY's foreground group. The snapshot must precede the kill: once the shell
    // dies the survivors are reparented to init and the parent links that
    // identify them are gone. Async so spawning `ps` never blocks the Electron
    // main-process event loop. See issue #2110.
    void collectLocalDescendantPidsAsync(pid).then(
      (descendants) => this.terminate(pid, descendants),
      () => this.terminate(pid, [])
    );
  }

  private terminate(pid: number, descendants: number[]): void {
    // Foreground process group: SIGTERM now, SIGKILL after a grace period —
    // unless the shell exits cleanly first (onExit clears killTimer), since the
    // group dies with it and a late SIGKILL could hit a reused pid.
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {}
    this.killTimer = setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {}
      this.killTimer = null;
    }, KILL_GRACE_MS);

    // Detached descendants outlive the shell, so their SIGKILL escalation must
    // NOT be cancelled by onExit. Daemons like watchman ignore SIGTERM and only
    // die on SIGKILL — without this independent pass they would survive the
    // shell's quick exit, defeating the reaping entirely.
    if (descendants.length > 0) {
      signalPids(descendants, 'SIGTERM');
      this.descendantKillTimer = setTimeout(() => {
        signalPids(descendants, 'SIGKILL');
        this.descendantKillTimer = null;
      }, KILL_GRACE_MS);
    }

    try {
      this.proc.kill();
    } catch {}
  }

  onData(handler: (data: string) => void): void {
    this.proc.onData(handler);
  }

  onExit(handler: (info: PtyExitInfo) => void): void {
    this.proc.onExit(({ exitCode, signal }) => {
      // Cancel only the group SIGKILL — the foreground group dies with the shell,
      // so a late SIGKILL is pointless and risks hitting a reused pid. The
      // descendant escalation (descendantKillTimer) is intentionally left running:
      // setsid()-detached descendants survive the shell and may have ignored
      // SIGTERM, so they still need the SIGKILL pass.
      if (this.killTimer) {
        clearTimeout(this.killTimer);
        this.killTimer = null;
      }
      handler({ exitCode, signal: normalizeSignal(signal) });
    });
  }

  getPid(): number {
    return this.proc.pid;
  }
}
