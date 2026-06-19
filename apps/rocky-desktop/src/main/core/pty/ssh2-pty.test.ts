import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { Ssh2PtySession } from './ssh2-pty';

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
});
