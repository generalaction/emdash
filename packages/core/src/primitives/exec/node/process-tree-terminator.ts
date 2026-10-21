import { execFile } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { noopLogger, type Logger } from '@emdash/shared/logger';
import { recordSpawn } from '@emdash/shared/perf';

const DEFAULT_GRACE_MS = 1_000;
const POLL_INTERVAL_MS = 20;
const TASKKILL_TIMEOUT_MS = 2_000;

export type ProcessTreeTarget = {
  pid: number | undefined;
  isExited(): boolean;
  kill(signal: NodeJS.Signals): void;
};

export type TaskkillRunner = (args: string[]) => Promise<void>;

export type ProcessTreeTerminatorOptions = {
  platform?: NodeJS.Platform;
  /** Whether the PID is also the process-group ID on POSIX. */
  processGroup?: boolean;
  graceMs?: number;
  logger?: Logger;
  taskkill?: TaskkillRunner;
};

/**
 * Best-effort, idempotent termination of a local process and its descendants.
 *
 * POSIX children are expected to be spawned detached when `processGroup` is
 * true. Windows uses taskkill directly with an argv array so no user-controlled
 * text is interpreted by a shell.
 */
export class ProcessTreeTerminator {
  private readonly platform: NodeJS.Platform;
  private readonly processGroup: boolean;
  private readonly graceMs: number;
  private readonly logger: Logger;
  private readonly taskkill: TaskkillRunner;
  private termination: Promise<void> | undefined;

  constructor(
    private readonly target: ProcessTreeTarget,
    options: ProcessTreeTerminatorOptions = {}
  ) {
    this.platform = options.platform ?? process.platform;
    this.processGroup = options.processGroup ?? false;
    this.graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
    this.logger = options.logger ?? noopLogger;
    this.taskkill = options.taskkill ?? runTaskkill;
  }

  terminate(signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
    this.termination ??= this.terminateOnce(signal).catch((error) => {
      this.logger.debug('process-tree: termination failed', {
        pid: this.target.pid,
        platform: this.platform,
        error: String(error),
      });
    });
    return this.termination;
  }

  private async terminateOnce(signal: NodeJS.Signals): Promise<void> {
    const pid = this.target.pid;
    if (!isValidPid(pid) || this.target.isExited()) return;

    if (this.platform === 'win32') {
      await this.terminateWindows(pid, signal);
      return;
    }

    this.signalPosix(pid, signal);
    if (signal === 'SIGKILL' || (await this.waitForExit(pid, this.graceMs))) return;
    this.signalPosix(pid, 'SIGKILL');
    await this.waitForExit(pid, this.graceMs);
  }

  private async terminateWindows(pid: number, signal: NodeJS.Signals): Promise<void> {
    const force = signal === 'SIGKILL';
    await this.invokeTaskkill(pid, force);
    this.killTarget(signal);
    if (force || (await this.waitForExit(pid, this.graceMs))) return;

    // Recheck the original child before addressing the numeric PID again. This
    // avoids targeting a reused PID after the wrapper has naturally exited.
    if (this.target.isExited()) return;
    await this.invokeTaskkill(pid, true);
    this.killTarget('SIGKILL');
    await this.waitForExit(pid, this.graceMs);
  }

  private async invokeTaskkill(pid: number, force: boolean): Promise<void> {
    const args = ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])];
    try {
      await this.taskkill(args);
    } catch (error) {
      this.logger.debug('process-tree: taskkill failed', {
        pid,
        force,
        error: String(error),
      });
    }
  }

  private signalPosix(pid: number, signal: NodeJS.Signals): void {
    if (this.processGroup) {
      try {
        process.kill(-pid, signal);
      } catch {
        // The group can disappear between the liveness check and the signal.
      }
    }
    this.killTarget(signal);
  }

  private killTarget(signal: NodeJS.Signals): void {
    try {
      this.target.kill(signal);
    } catch {
      // Child/PTY handles can throw after their native resource has closed.
    }
  }

  private async waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (this.isTreeAlive(pid) && Date.now() < deadline) {
      await delay(Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
    }
    return !this.isTreeAlive(pid);
  }

  private isTreeAlive(pid: number): boolean {
    if (!this.processGroup || this.platform === 'win32') return !this.target.isExited();
    try {
      process.kill(-pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}

export function createChildProcessTreeTerminator(
  child: ChildProcess,
  options: ProcessTreeTerminatorOptions = {}
): ProcessTreeTerminator {
  let exited =
    (child.exitCode !== null && child.exitCode !== undefined) ||
    (child.signalCode !== null && child.signalCode !== undefined);
  child.once('exit', () => {
    exited = true;
  });
  child.once('error', () => {
    exited = true;
  });

  return new ProcessTreeTerminator(
    {
      pid: child.pid,
      isExited: () => exited,
      kill: (signal) => {
        child.kill(signal);
      },
    },
    options
  );
}

function isValidPid(pid: number | undefined): pid is number {
  return pid !== undefined && Number.isInteger(pid) && pid > 0;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runTaskkill(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    recordSpawn('other', 'taskkill.exe');
    execFile(
      'taskkill.exe',
      args,
      {
        encoding: 'utf8',
        maxBuffer: 64 * 1024,
        timeout: TASKKILL_TIMEOUT_MS,
        windowsHide: true,
      },
      (error) => {
        if (error) reject(error);
        else resolve();
      }
    );
  });
}
