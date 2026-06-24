import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { openSsh2Pty, Ssh2PtySession } from './ssh2-pty';

class FakeClientChannel extends EventEmitter {
  writes: string[] = [];
  windows: Array<{ rows: number; cols: number; height: number; width: number }> = [];
  closed = false;

  write(data: string): boolean {
    this.writes.push(data);
    return true;
  }

  setWindow(rows: number, cols: number, height: number, width: number): void {
    this.windows.push({ rows, cols, height, width });
  }

  close(): void {
    this.closed = true;
    this.emit('close', 0, undefined);
  }
}

describe('Ssh2PtySession', () => {
  it('wraps SSH channel data, input, resize, close, and exit semantics', () => {
    const channel = new FakeClientChannel();
    const session = new Ssh2PtySession('ssh-session', channel as never);
    const dataHandler = vi.fn();
    const exitHandler = vi.fn();

    session.onData(dataHandler);
    session.onExit(exitHandler);
    session.write('hello');
    session.resize(132, 43);
    channel.emit('data', Buffer.from('remote output'));
    session.kill();

    expect(channel.writes).toEqual(['hello']);
    expect(channel.windows).toEqual([{ rows: 43, cols: 132, height: 0, width: 0 }]);
    expect(dataHandler).toHaveBeenCalledWith('remote output');
    expect(channel.closed).toBe(true);
    expect(exitHandler).toHaveBeenCalledWith({ exitCode: 0, signal: undefined });
  });

  it('fails SSH channel opens that never call back', async () => {
    vi.useFakeTimers();
    try {
      const destroy = vi.fn();
      const proxy = {
        client: { destroy },
        execPty: vi.fn(),
      };

      const resultPromise = openSsh2Pty(proxy as never, {
        id: 'ssh-session',
        command: 'bash',
        cols: 80,
        rows: 24,
      });

      await vi.advanceTimersByTimeAsync(15_000);
      const result = await resultPromise;

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.kind).toBe('channel-open-timeout');
        expect(result.error.message).toContain('timed out');
      }
      expect(destroy).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns a failed open when execPty throws synchronously', async () => {
    const proxy = {
      execPty: vi.fn(() => {
        throw new Error('SSH connection is not available');
      }),
    };

    const result = await openSsh2Pty(proxy as never, {
      id: 'ssh-session',
      command: 'bash',
      cols: 80,
      rows: 24,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toEqual({
        kind: 'channel-open-failed',
        message: 'SSH connection is not available',
      });
    }
  });
});
