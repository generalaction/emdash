import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import type { IDisposable } from '@main/lib/lifecycle';

const REQUEST_TIMEOUT_MS = 5000;

type Pending = {
  query: string;
  resolve: (v: string | null) => void;
  reject: (e: Error) => void;
};

/**
 * Persistent `git cat-file --batch` subprocess with a strictly serialized queue.
 * Local workspace only — SSH workspaces use per-call `git show` in GitService.
 */
export class CatFileBatch implements IDisposable {
  private disposed = false;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buf = Buffer.alloc(0);
  private wake: (() => void) | null = null;
  private queue: Pending[] = [];
  private processing = false;
  private readAborted: Error | null = null;

  constructor(
    private readonly cwd: string,
    private readonly gitBin: string = GIT_EXECUTABLE
  ) {}

  dispose(): void {
    this.disposed = true;
    try {
      this.proc?.stdin?.end();
      this.proc?.kill();
    } catch {}
    this.proc = null;
    this.buf = Buffer.alloc(0);
    this.readAborted = new Error('CatFileBatch disposed');
    this.wake?.();
    this.wake = null;
    this.processing = false;
    const q = this.queue;
    this.queue = [];
    for (const item of q) {
      item.reject(this.readAborted);
    }
  }

  read(query: string): Promise<string | null> {
    return new Promise((resolve, reject) => {
      if (this.disposed) {
        reject(new Error('CatFileBatch disposed'));
        return;
      }
      this.queue.push({ query, resolve, reject });
      if (!this.processing) void this._next();
    });
  }

  private _ensureProc(): ChildProcessWithoutNullStreams {
    if (this.disposed) throw new Error('CatFileBatch disposed');
    if (this.proc) return this.proc;

    this.readAborted = null;
    const child = spawn(this.gitBin, ['cat-file', '--batch'], {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'ignore'],
    });

    child.stdout.on('data', (chunk: Buffer) => {
      this.buf = Buffer.concat([this.buf, chunk]);
      this.wake?.();
    });

    child.stdout.on('end', () => {
      this.readAborted = new Error('git cat-file stdout ended');
      this.wake?.();
    });

    child.on('error', () => {
      this._recordProcDeath(new Error('git cat-file process error'));
    });

    child.on('close', () => {
      this._recordProcDeath(new Error('git cat-file process exited'));
    });

    this.proc = child as unknown as ChildProcessWithoutNullStreams;
    return this.proc;
  }

  /** Marks the current process dead and unblocks any waiting reader; does not reject queue. */
  private _recordProcDeath(err: Error): void {
    this.proc = null;
    this.readAborted = err;
    this.buf = Buffer.alloc(0);
    this.wake?.();
  }

  private async _next(): Promise<void> {
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }
    this.processing = true;
    const item = this.queue[0]!;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      const proc = this._ensureProc();
      proc.stdin.write(item.query + '\n');

      timeoutId = setTimeout(() => {
        try {
          this.proc?.kill();
        } catch {}
      }, REQUEST_TIMEOUT_MS);

      const line = await this._readLine();
      clearTimeout(timeoutId);
      timeoutId = undefined;

      if (line.endsWith(' missing') || line === 'missing' || line.endsWith(' ambiguous')) {
        item.resolve(null);
      } else {
        const parts = line.split(' ');
        const sizeStr = parts[parts.length - 1];
        const size = Number.parseInt(sizeStr ?? '', 10);
        if (Number.isNaN(size)) {
          proc.kill();
          throw new Error(`Unexpected cat-file header: ${line}`);
        }
        const body = await this._readBytes(size + 1);
        item.resolve(body.subarray(0, -1).toString('utf8'));
      }
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      item.reject(err);
      try {
        this.proc?.kill();
      } catch {}
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      this.queue.shift();
      void this._next();
    }
  }

  private _waitData(): Promise<void> {
    return new Promise((resolve) => {
      this.wake = resolve;
    });
  }

  private async _readLine(): Promise<string> {
    while (true) {
      if (this.readAborted) throw this.readAborted;
      const nl = this.buf.indexOf(0x0a);
      if (nl !== -1) {
        const line = this.buf.subarray(0, nl).toString('utf8');
        this.buf = this.buf.subarray(nl + 1);
        return line;
      }
      await this._waitData();
    }
  }

  private async _readBytes(count: number): Promise<Buffer> {
    while (this.buf.length < count) {
      if (this.readAborted) throw this.readAborted;
      await this._waitData();
    }
    const out = this.buf.subarray(0, count);
    this.buf = this.buf.subarray(count);
    return out;
  }
}
