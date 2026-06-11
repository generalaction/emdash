import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { BoundExec } from '../exec';
import type { IDisposable } from '../lib';

const REQUEST_TIMEOUT_MS = 5_000;

type Pending = {
  query: string;
  resolve: (value: string | null) => void;
  reject: (error: Error) => void;
};

export type CatFileBatchOptions = {
  exec: BoundExec;
};

export class CatFileBatch implements IDisposable {
  private disposed = false;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buffer = Buffer.alloc(0);
  private wake: (() => void) | null = null;
  private queue: Pending[] = [];
  private processing = false;
  private readAborted: Error | null = null;
  private readonly exec: BoundExec;

  constructor(options: CatFileBatchOptions) {
    this.exec = options.exec;
  }

  dispose(): void {
    this.disposed = true;
    try {
      this.proc?.stdin.end();
      this.proc?.kill();
    } catch {}
    this.proc = null;
    this.buffer = Buffer.alloc(0);
    this.readAborted = new Error('CatFileBatch disposed');
    this.wake?.();
    this.wake = null;
    this.processing = false;
    const queue = this.queue;
    this.queue = [];
    for (const item of queue) {
      item.reject(this.readAborted);
    }
  }

  readText(query: string): Promise<string | null> {
    return new Promise((resolve, reject) => {
      if (this.disposed) {
        reject(new Error('CatFileBatch disposed'));
        return;
      }
      this.queue.push({ query, resolve, reject });
      if (!this.processing) void this.next();
    });
  }

  private ensureProc(): ChildProcessWithoutNullStreams {
    if (this.disposed) throw new Error('CatFileBatch disposed');
    if (this.proc) return this.proc;

    this.readAborted = null;
    const child = spawn(this.exec.file, ['cat-file', '--batch'], {
      cwd: this.exec.cwd,
      env: this.exec.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stderr.resume();

    child.stdout.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.wake?.();
    });
    child.stdout.on('end', () => {
      this.readAborted = new Error('git cat-file stdout ended');
      this.wake?.();
    });
    child.on('error', () => {
      this.recordProcDeath(new Error('git cat-file process error'));
    });
    child.on('close', () => {
      this.recordProcDeath(new Error('git cat-file process exited'));
    });

    this.proc = child;
    return this.proc;
  }

  private recordProcDeath(error: Error): void {
    this.proc = null;
    this.readAborted = error;
    this.buffer = Buffer.alloc(0);
    this.wake?.();
  }

  private async next(): Promise<void> {
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }

    this.processing = true;
    const item = this.queue[0]!;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    try {
      const proc = this.ensureProc();
      proc.stdin.write(`${item.query}\n`);

      timeoutId = setTimeout(() => {
        try {
          this.proc?.kill();
        } catch {}
      }, REQUEST_TIMEOUT_MS);

      const line = await this.readLine();
      clearTimeout(timeoutId);
      timeoutId = undefined;

      if (line.endsWith(' missing') || line === 'missing' || line.endsWith(' ambiguous')) {
        item.resolve(null);
      } else {
        const parts = line.split(' ');
        const size = Number.parseInt(parts[parts.length - 1] ?? '', 10);
        if (Number.isNaN(size)) {
          proc.kill();
          throw new Error(`Unexpected cat-file header: ${line}`);
        }
        const body = await this.readBytes(size + 1);
        item.resolve(body.subarray(0, -1).toString('utf8'));
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      item.reject(err);
      try {
        this.proc?.kill();
      } catch {}
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      this.queue.shift();
      void this.next();
    }
  }

  private waitForData(): Promise<void> {
    return new Promise((resolve) => {
      this.wake = resolve;
    });
  }

  private async readLine(): Promise<string> {
    while (true) {
      if (this.readAborted) throw this.readAborted;
      const newline = this.buffer.indexOf(0x0a);
      if (newline !== -1) {
        const line = this.buffer.subarray(0, newline).toString('utf8');
        this.buffer = this.buffer.subarray(newline + 1);
        return line;
      }
      await this.waitForData();
    }
  }

  private async readBytes(count: number): Promise<Buffer> {
    while (this.buffer.length < count) {
      if (this.readAborted) throw this.readAborted;
      await this.waitForData();
    }
    const output = this.buffer.subarray(0, count);
    this.buffer = this.buffer.subarray(count);
    return output;
  }
}
