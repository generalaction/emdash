import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Duplex } from 'node:stream';
import type { SshExecOptions, SshExecResult } from '@core/primitives/ssh/api/node/ssh-client-proxy';
import { connectionDeadline, type SshInteraction } from './interaction';

export type ProcessInvocation = { executable: string; args: string[]; env: NodeJS.ProcessEnv };
type ProcessResult = { code: number | null; signal: NodeJS.Signals | null };

/** Owns the entire process tree and drains diagnostics even when the caller stops reading. */
class OwnedProcess {
  readonly child: ChildProcessWithoutNullStreams;
  readonly closed: Promise<ProcessResult>;
  private stderr = Buffer.alloc(0);
  private stopped = false;
  private escalation: ReturnType<typeof setTimeout> | undefined;

  constructor(invocation: ProcessInvocation, signal?: AbortSignal) {
    signal?.throwIfAborted();
    this.child = spawn(invocation.executable, invocation.args, {
      env: invocation.env,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stderr.on('data', (chunk: Buffer) => {
      this.stderr = Buffer.concat([this.stderr, chunk]).subarray(-16 * 1024);
    });
    // Errors on stdin (e.g. a remote command exits without reading) must never escape.
    this.child.stdin.on('error', () => {});
    this.closed = new Promise((resolve, reject) => {
      this.child.once('error', reject);
      this.child.once('close', (code, exitSignal) => {
        // ProxyCommand descendants can outlive the leader and ignore SIGTERM.
        if (this.stopped && process.platform !== 'win32') this.killGroup('SIGKILL');
        clearTimeout(this.escalation);
        signal?.removeEventListener('abort', abort);
        resolve({ code, signal: exitSignal });
      });
      const abort = () => {
        reject(signal?.reason);
        queueMicrotask(() => this.stop());
      };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
    void this.closed.catch(() => {});
  }

  diagnostics(): string {
    return this.stderr.toString('utf8').trim();
  }

  failure(result: ProcessResult): Error {
    return new Error(
      this.diagnostics() ||
        `SSH process exited with ${result.signal ?? result.code ?? 'unknown status'}`
    );
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.child.pid) {
      if (process.platform === 'win32') {
        if (this.child.exitCode === null && this.child.signalCode === null) {
          execFile(
            'taskkill',
            ['/pid', String(this.child.pid), '/T', '/F'],
            { windowsHide: true },
            () => {}
          );
        }
      } else {
        if (this.child.exitCode !== null || this.child.signalCode !== null)
          this.killGroup('SIGKILL');
        else {
          this.killGroup('SIGTERM');
          this.escalation = setTimeout(() => this.killGroup('SIGKILL'), 1_000);
          this.escalation.unref();
        }
      }
    }
    this.child.stdin.destroy();
    this.child.stdout.destroy();
  }

  private killGroup(signal: NodeJS.Signals): void {
    if (!this.child.pid) return;
    try {
      process.kill(-this.child.pid, signal);
    } catch {
      this.child.kill(signal);
    }
  }
}

/** Finite commands: cancellation, byte limits, exit status and stream draining live here. */
export async function runProcess(
  invocation: ProcessInvocation,
  options: SshExecOptions = {}
): Promise<SshExecResult> {
  const process = new OwnedProcess(invocation, options.signal);
  const output: Record<'stdout' | 'stderr', Buffer[]> = { stdout: [], stderr: [] };
  const counts = { stdout: 0, stderr: 0 };
  const timeoutMs = options.timeoutMs ?? 30_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      process.closed,
      new Promise<never>((_resolve, reject) => {
        for (const name of ['stdout', 'stderr'] as const) {
          const limit =
            (name === 'stdout' ? options.maxStdoutBytes : options.maxStderrBytes) ?? 1024 * 1024;
          process.child[name].on('data', (chunk: Buffer) => {
            counts[name] += chunk.length;
            if (counts[name] > limit)
              reject(new Error(`SSH command ${name} exceeded the ${limit}-byte limit`));
            else output[name].push(chunk);
          });
        }
        if (timeoutMs > 0)
          timer = setTimeout(
            () => reject(new Error(`SSH command timed out after ${timeoutMs}ms`)),
            timeoutMs
          );
      }),
    ]);
    if (result.code === null) throw process.failure(result);
    return {
      stdout: Buffer.concat(output.stdout).toString('utf8'),
      stderr: Buffer.concat(output.stderr).toString('utf8'),
      exitCode: result.code,
    };
  } finally {
    clearTimeout(timer);
    process.stop();
  }
}

/** A stream is acquired only after an explicit remote acknowledgement, never merely on spawn. */
export async function openProcessStream(
  invocation: ProcessInvocation,
  options: {
    readyLine: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    interaction?: SshInteraction;
  }
): Promise<Duplex> {
  const process = new OwnedProcess(invocation, options.signal);
  const prefix = Buffer.from(options.readyLine);
  let received = Buffer.alloc(0);
  let disposeDeadline: (() => void) | undefined;
  let consume: (chunk: Buffer) => void = () => {};
  try {
    await Promise.race([
      process.closed.then((result) => {
        throw process.failure(result);
      }),
      new Promise<void>((resolve, reject) => {
        consume = (chunk) => {
          received = Buffer.concat([received, chunk]);
          const compared = Math.min(received.length, prefix.length);
          if (!received.subarray(0, compared).equals(prefix.subarray(0, compared))) {
            reject(
              new Error('Unexpected SSH stream handshake (check remote shell startup output)')
            );
          } else if (received.length >= prefix.length) {
            process.child.stdout.pause();
            process.child.stdout.off('data', consume);
            if (received.length > prefix.length)
              process.child.stdout.unshift(received.subarray(prefix.length));
            resolve();
          }
        };
        process.child.stdout.on('data', consume);
        const timeoutMs = options.timeoutMs ?? 10_000;
        if (timeoutMs > 0)
          disposeDeadline = connectionDeadline(
            timeoutMs,
            () => reject(new Error(`SSH stream handshake timed out after ${timeoutMs}ms`)),
            options.interaction
          );
      }),
    ]);
    options.signal?.throwIfAborted();
    const stream = Duplex.from({ readable: process.child.stdout, writable: process.child.stdin });
    // Callers may attach their listener in the next microtask; an early process failure is safe.
    stream.on('error', () => {});
    stream.once('close', () => process.stop());
    void process.closed.then(
      (result) => {
        if (result.code !== 0) stream.destroy(process.failure(result));
      },
      (error: Error) => stream.destroy(error)
    );
    return stream;
  } catch (error) {
    process.stop();
    throw error;
  } finally {
    disposeDeadline?.();
    process.child.stdout.off('data', consume);
  }
}
