import { describe, expect, it, vi } from 'vitest';
import { utilityProcessHost } from './utility-process-host';

describe('utilityProcessHost', () => {
  it('adapts utility process messages, stdio, exits, and disposal', async () => {
    const processes: FakeUtilityProcess[] = [];
    const fork = vi.fn((entry: string, args?: string[]) => {
      const process = new FakeUtilityProcess(processes.length + 1);
      processes.push(process);
      process.entry = entry;
      process.args = args ?? [];
      return process;
    });
    const host = utilityProcessHost({ fork });
    const process = await host.spawn({
      entry: 'runtime.js',
      args: ['--one'],
      cwd: '/tmp/work',
      env: { FOO: 'bar' },
    });
    const messages: unknown[] = [];
    const stdio: Array<{ stream: 'stdout' | 'stderr'; chunk: string }> = [];
    const exits: Array<{ code: number | null; signal?: string | null; willRestart: boolean }> = [];

    process.onMessage((message) => messages.push(message));
    process.onStdio((stream, chunk) => stdio.push({ stream, chunk }));
    process.onExit((exit) => exits.push(exit));

    process.send({ kind: 'ping' });
    processes[0].emit('message', { kind: 'pong' });
    processes[0].stdout.emit('data', 'out');
    processes[0].stderr.emit('data', Buffer.from('err'));
    processes[0].emit('exit', 7, 'SIGTERM');

    expect(fork).toHaveBeenCalledWith('runtime.js', ['--one'], {
      cwd: '/tmp/work',
      env: { FOO: 'bar' },
    });
    expect(processes[0].posted).toEqual([{ kind: 'ping' }]);
    expect(messages).toEqual([{ kind: 'pong' }]);
    expect(stdio).toEqual([
      { stream: 'stdout', chunk: 'out' },
      { stream: 'stderr', chunk: 'err' },
    ]);
    await vi.waitFor(() => {
      expect(exits).toEqual([{ code: 7, signal: 'SIGTERM', willRestart: false }]);
    });

    expect(processes[0].killed).toBe(false);

    const disposable = await host.spawn({ entry: 'runtime.js' });
    await disposable.dispose();
    expect(processes[1].killed).toBe(true);
  });
});

class FakeUtilityProcess {
  entry = '';
  args: string[] = [];
  readonly stdout = new FakeEmitter();
  readonly stderr = new FakeEmitter();
  readonly posted: unknown[] = [];
  killed = false;
  private readonly emitter = new FakeEmitter();

  constructor(readonly pid: number) {}

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  kill(): void {
    this.killed = true;
  }

  on(event: string, cb: (...args: unknown[]) => void): void {
    this.emitter.on(event, cb);
  }

  off(event: string, cb: (...args: unknown[]) => void): void {
    this.emitter.off(event, cb);
  }

  emit(event: string, ...args: unknown[]): void {
    this.emitter.emit(event, ...args);
  }
}

class FakeEmitter {
  private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  on(event: string, cb: (...args: unknown[]) => void): void {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(cb);
    this.listeners.set(event, listeners);
  }

  off(event: string, cb: (...args: unknown[]) => void): void {
    this.listeners.get(event)?.delete(cb);
  }

  emit(event: string, ...args: unknown[]): void {
    for (const cb of this.listeners.get(event) ?? []) cb(...args);
  }
}
