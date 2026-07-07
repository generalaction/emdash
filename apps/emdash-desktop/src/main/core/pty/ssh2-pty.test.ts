import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { Ssh2PtySession } from './ssh2-pty';

class FakeClientChannel extends EventEmitter {
  writes: string[] = [];
  windows: Array<{ rows: number; cols: number; height: number; width: number }> = [];
  closed = false;
  /** When false, `write()` returns false to simulate a full send buffer. */
  acceptWrites = true;

  write(data: string): boolean {
    this.writes.push(data);
    return this.acceptWrites;
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

  it('defers writes while the channel buffer is full and flushes them on drain, in order', () => {
    const channel = new FakeClientChannel();
    const session = new Ssh2PtySession('s', channel as never);

    channel.acceptWrites = false; // buffer over high-water mark
    session.write('a'); // buffered by ssh2, returns false -> start draining
    session.write('b'); // deferred
    session.write('c'); // deferred
    expect(channel.writes).toEqual(['a']);

    channel.acceptWrites = true;
    channel.emit('drain');
    expect(channel.writes).toEqual(['a', 'b', 'c']);
    expect(channel.listenerCount('drain')).toBe(0);
  });

  it('keeps deferring across multiple drains while the channel stays full', () => {
    const channel = new FakeClientChannel();
    const session = new Ssh2PtySession('s', channel as never);

    channel.acceptWrites = false;
    session.write('a'); // draining
    session.write('b'); // deferred
    channel.emit('drain'); // still full: 'b' is buffered but write returns false again
    expect(channel.writes).toEqual(['a', 'b']);

    channel.acceptWrites = true;
    session.write('c'); // still deferred (draining re-armed)
    channel.emit('drain');
    expect(channel.writes).toEqual(['a', 'b', 'c']);
  });

  it('drops deferred writes and removes the drain listener on kill()', () => {
    const channel = new FakeClientChannel();
    const session = new Ssh2PtySession('s', channel as never);

    channel.acceptWrites = false;
    session.write('a'); // draining
    session.write('b'); // deferred
    session.kill();

    expect(channel.closed).toBe(true);
    expect(channel.listenerCount('drain')).toBe(0);

    channel.acceptWrites = true;
    channel.emit('drain'); // no-op, listener removed
    session.write('c'); // ignored, session closed
    expect(channel.writes).toEqual(['a']);
  });
});
