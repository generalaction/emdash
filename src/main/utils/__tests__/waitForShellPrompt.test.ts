import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { waitForShellPrompt } from '../waitForShellPrompt';

describe('waitForShellPrompt', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function createMockPty() {
    const listeners: Array<(chunk: string) => void> = [];
    return {
      subscribe: (cb: (chunk: string) => void) => {
        listeners.push(cb);
        return () => {
          const idx = listeners.indexOf(cb);
          if (idx >= 0) listeners.splice(idx, 1);
        };
      },
      write: vi.fn(),
      emit: (data: string) => {
        for (const cb of [...listeners]) cb(data);
      },
      listenerCount: () => listeners.length,
    };
  }

  it('writes data after detecting a $ prompt', () => {
    const pty = createMockPty();
    waitForShellPrompt({
      subscribe: pty.subscribe,
      write: pty.write,
      data: 'cd /foo\n',
    });

    expect(pty.write).not.toHaveBeenCalled();
    pty.emit('user@host:~$ ');
    expect(pty.write).toHaveBeenCalledWith('cd /foo\n');
  });

  it('writes data after detecting a # prompt (root)', () => {
    const pty = createMockPty();
    waitForShellPrompt({
      subscribe: pty.subscribe,
      write: pty.write,
      data: 'cd /foo\n',
    });

    pty.emit('root@host:~# ');
    expect(pty.write).toHaveBeenCalledWith('cd /foo\n');
  });

  it('writes data after detecting a % prompt (zsh)', () => {
    const pty = createMockPty();
    waitForShellPrompt({
      subscribe: pty.subscribe,
      write: pty.write,
      data: 'cd /foo\n',
    });

    pty.emit('host% ');
    expect(pty.write).toHaveBeenCalledWith('cd /foo\n');
  });

  it('writes data after detecting a > prompt', () => {
    const pty = createMockPty();
    waitForShellPrompt({
      subscribe: pty.subscribe,
      write: pty.write,
      data: 'cd /foo\n',
    });

    pty.emit('PS> ');
    expect(pty.write).toHaveBeenCalledWith('cd /foo\n');
  });

  it('writes data after detecting a ❯ prompt (starship)', () => {
    const pty = createMockPty();
    waitForShellPrompt({
      subscribe: pty.subscribe,
      write: pty.write,
      data: 'cd /foo\n',
    });

    pty.emit('~/projects ❯ ');
    expect(pty.write).toHaveBeenCalledWith('cd /foo\n');
  });

  it('strips ANSI codes before matching', () => {
    const pty = createMockPty();
    waitForShellPrompt({
      subscribe: pty.subscribe,
      write: pty.write,
      data: 'cd /foo\n',
    });

    pty.emit('\x1b[32muser@host\x1b[0m:\x1b[34m~\x1b[0m$ ');
    expect(pty.write).toHaveBeenCalledWith('cd /foo\n');
  });

  it('strips OSC sequences before matching', () => {
    const pty = createMockPty();
    waitForShellPrompt({
      subscribe: pty.subscribe,
      write: pty.write,
      data: 'cd /foo\n',
    });

    pty.emit('\x1b]0;user@host:~\x07user@host:~$ ');
    expect(pty.write).toHaveBeenCalledWith('cd /foo\n');
  });

  it('detects a prompt split across chunks', () => {
    const pty = createMockPty();
    waitForShellPrompt({
      subscribe: pty.subscribe,
      write: pty.write,
      data: 'cd /foo\n',
    });

    pty.emit('user@host:~');
    expect(pty.write).not.toHaveBeenCalled();

    pty.emit('$ ');
    expect(pty.write).toHaveBeenCalledWith('cd /foo\n');
  });

  it('detects a fish prompt after greeting output arrives in earlier chunks', () => {
    const pty = createMockPty();
    waitForShellPrompt({
      subscribe: pty.subscribe,
      write: pty.write,
      data: 'cd /foo\n',
    });

    pty.emit('Welcome to fish, the friendly interactive shell\r\n');
    pty.emit('Type help for instructions on how to use fish\r\n');
    pty.emit('user@remote ~/worktrees/1597-fish-prompt');
    expect(pty.write).not.toHaveBeenCalled();

    pty.emit('> ');
    expect(pty.write).toHaveBeenCalledWith('cd /foo\n');
  });

  it('does not match a bare prompt character with no preceding context', () => {
    const pty = createMockPty();
    waitForShellPrompt({
      subscribe: pty.subscribe,
      write: pty.write,
      data: 'cd /foo\n',
    });

    pty.emit('$ ');
    expect(pty.write).not.toHaveBeenCalled();
  });

  it('does not match MOTD content that lacks prompt characters at end', () => {
    const pty = createMockPty();
    waitForShellPrompt({
      subscribe: pty.subscribe,
      write: pty.write,
      data: 'cd /foo\n',
    });

    pty.emit('Welcome to Ubuntu 22.04 LTS\r\n');
    expect(pty.write).not.toHaveBeenCalled();

    pty.emit('Last login: Mon Jan 1 00:00:00 2024\r\n');
    expect(pty.write).not.toHaveBeenCalled();
  });

  it('falls back to timeout when no prompt is detected', () => {
    const pty = createMockPty();
    const onTimeout = vi.fn();
    waitForShellPrompt({
      subscribe: pty.subscribe,
      write: pty.write,
      data: 'cd /foo\n',
      timeoutMs: 5000,
      onTimeout,
    });

    pty.emit('Welcome to server\r\n');
    expect(pty.write).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5000);
    expect(pty.write).toHaveBeenCalledWith('cd /foo\n');
    expect(onTimeout).toHaveBeenCalled();
  });

  it('uses default 15s timeout', () => {
    const pty = createMockPty();
    waitForShellPrompt({
      subscribe: pty.subscribe,
      write: pty.write,
      data: 'cd /foo\n',
    });

    vi.advanceTimersByTime(14999);
    expect(pty.write).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(pty.write).toHaveBeenCalledWith('cd /foo\n');
  });

  it('only writes once even if multiple prompt chunks arrive', () => {
    const pty = createMockPty();
    waitForShellPrompt({
      subscribe: pty.subscribe,
      write: pty.write,
      data: 'cd /foo\n',
    });

    pty.emit('user@host:~$ ');
    pty.emit('user@host:~$ ');
    expect(pty.write).toHaveBeenCalledTimes(1);
  });

  it('only writes once when prompt detected and then timeout fires', () => {
    const pty = createMockPty();
    waitForShellPrompt({
      subscribe: pty.subscribe,
      write: pty.write,
      data: 'cd /foo\n',
      timeoutMs: 1000,
    });

    pty.emit('user@host:~$ ');
    expect(pty.write).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1000);
    expect(pty.write).toHaveBeenCalledTimes(1);
  });

  it('cleans up data listener after prompt detection', () => {
    const pty = createMockPty();
    waitForShellPrompt({
      subscribe: pty.subscribe,
      write: pty.write,
      data: 'cd /foo\n',
    });

    expect(pty.listenerCount()).toBe(1);
    pty.emit('user@host:~$ ');
    expect(pty.listenerCount()).toBe(0);
  });

  it('cleans up data listener after timeout', () => {
    const pty = createMockPty();
    waitForShellPrompt({
      subscribe: pty.subscribe,
      write: pty.write,
      data: 'cd /foo\n',
      timeoutMs: 1000,
    });

    expect(pty.listenerCount()).toBe(1);
    vi.advanceTimersByTime(1000);
    expect(pty.listenerCount()).toBe(0);
  });

  it('cancel() prevents writing and cleans up', () => {
    const pty = createMockPty();
    const handle = waitForShellPrompt({
      subscribe: pty.subscribe,
      write: pty.write,
      data: 'cd /foo\n',
      timeoutMs: 1000,
    });

    handle.cancel();
    pty.emit('user@host:~$ ');
    vi.advanceTimersByTime(1000);
    expect(pty.write).not.toHaveBeenCalled();
    expect(pty.listenerCount()).toBe(0);
  });

  it('is a no-op when data is empty', () => {
    const pty = createMockPty();
    waitForShellPrompt({
      subscribe: pty.subscribe,
      write: pty.write,
      data: '',
    });

    expect(pty.listenerCount()).toBe(0);
    pty.emit('user@host:~$ ');
    expect(pty.write).not.toHaveBeenCalled();
  });

  it('does not match download progress ending with %', () => {
    const pty = createMockPty();
    waitForShellPrompt({
      subscribe: pty.subscribe,
      write: pty.write,
      data: 'cd /foo\n',
    });

    pty.emit('Downloading... 100%');
    expect(pty.write).not.toHaveBeenCalled();
  });

  it('does not match percentage in progress output', () => {
    const pty = createMockPty();
    waitForShellPrompt({
      subscribe: pty.subscribe,
      write: pty.write,
      data: 'cd /foo\n',
    });

    pty.emit('Progress: 50%');
    expect(pty.write).not.toHaveBeenCalled();
  });

  it('does not match dollar after digit', () => {
    const pty = createMockPty();
    waitForShellPrompt({
      subscribe: pty.subscribe,
      write: pty.write,
      data: 'cd /foo\n',
    });

    pty.emit('Total: 5$');
    expect(pty.write).not.toHaveBeenCalled();
  });

  it('detects prompt after multiple MOTD chunks', () => {
    const pty = createMockPty();
    waitForShellPrompt({
      subscribe: pty.subscribe,
      write: pty.write,
      data: 'cd /foo\n',
    });

    pty.emit('Welcome to Ubuntu 22.04.3 LTS (GNU/Linux 5.15.0)\r\n');
    pty.emit('\r\n');
    pty.emit(' * Documentation:  https://help.ubuntu.com\r\n');
    pty.emit(' * Management:     https://landscape.canonical.com\r\n');
    pty.emit('\r\n');
    pty.emit('Last login: Mon Mar 6 12:00:00 2026 from 10.0.0.1\r\n');
    expect(pty.write).not.toHaveBeenCalled();

    pty.emit('user@server:~$ ');
    expect(pty.write).toHaveBeenCalledWith('cd /foo\n');
  });
});
