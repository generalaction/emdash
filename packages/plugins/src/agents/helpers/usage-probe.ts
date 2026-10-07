import { spawn } from 'node:child_process';
import {
  createChildProcessTreeTerminator,
  planExecutableLaunch,
  toChildProcessLaunch,
} from '@emdash/core/primitives/exec/node';
import type { UsageProbeContext } from '@emdash/core/services/agent-plugins/api/plugins';
import { runWithTimeout } from '@emdash/shared/scheduling';

export function percent(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : null;
}

export function resetTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

type Rpc = {
  request(method: string, params?: unknown): Promise<unknown>;
  notify(method: string): void;
};

/** Short-lived read-only JSON-RPC peer. Discard diagnostics; they may contain account secrets. */
export async function withUsageRpc<T>(
  ctx: UsageProbeContext,
  read: (rpc: Rpc) => Promise<T>
): Promise<T> {
  ctx.signal.throwIfAborted();
  const plan = planExecutableLaunch({
    platform: process.platform,
    command: ctx.cli,
    args: ['app-server'],
    cwd: ctx.cwd,
    env: ctx.env,
  });
  const launch = toChildProcessLaunch(plan.invocation);
  const child = spawn(launch.executable, launch.args, {
    cwd: plan.cwd,
    env: ctx.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    windowsHide: true,
    windowsVerbatimArguments: launch.windowsVerbatimArguments,
  });
  const terminator = createChildProcessTreeTerminator(child, {
    platform: process.platform,
    processGroup: process.platform !== 'win32',
  });
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  let sequence = 0;
  let buffer = '';
  let failure: Error | undefined;
  const fail = () => {
    failure = new Error('Usage probe connection closed');
    for (const waiter of pending.values()) waiter.reject(failure);
    pending.clear();
  };
  child.on('error', fail);
  child.on('exit', fail);
  child.stdin.on('error', fail);
  child.stderr.resume();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    if (buffer.length > 1024 * 1024) {
      fail();
      void terminator.terminate();
      return;
    }
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      try {
        const message: { id?: unknown; result?: unknown; error?: unknown } = JSON.parse(line);
        if (typeof message.id !== 'number') continue;
        const waiter = pending.get(message.id);
        if (!waiter) continue;
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error('Usage request failed'));
        else waiter.resolve(message.result);
      } catch {
        /* Ignore non-protocol output. */
      }
    }
  });
  const abort = () => {
    fail();
    void terminator.terminate();
  };
  ctx.signal.addEventListener('abort', abort, { once: true });
  try {
    return await read({
      request: (method, params) =>
        runWithTimeout(
          (signal) =>
            new Promise((resolve, reject) => {
              if (failure) {
                reject(failure);
                return;
              }
              const id = ++sequence;
              const cancel = () => {
                pending.delete(id);
                reject(new Error('Usage request timed out'));
              };
              signal.addEventListener('abort', cancel, { once: true });
              pending.set(id, {
                resolve: (value) => {
                  signal.removeEventListener('abort', cancel);
                  resolve(value);
                },
                reject: (error) => {
                  signal.removeEventListener('abort', cancel);
                  reject(error);
                },
              });
              child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
            }),
          { timeoutMs: 10_000, signal: ctx.signal }
        ),
      notify: (method) => {
        child.stdin.write(JSON.stringify({ method }) + '\n');
      },
    });
  } finally {
    ctx.signal.removeEventListener('abort', abort);
    fail();
    await terminator.terminate();
  }
}
