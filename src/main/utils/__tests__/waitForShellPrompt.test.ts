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

  it('detects prompt followed by charset designation escape \\x1b(B', () => {
    const pty = createMockPty();
    waitForShellPrompt({
      subscribe: pty.subscribe,
      write: pty.write,
      data: 'cd /foo\n',
    });

    // fish's set_color normal emits \x1b(B after the prompt
    pty.emit('\x1b[32muser@host\x1b[0m \x1b[34m~\x1b[0m\x1b(B> \x1b[?2004h');
    expect(pty.write).toHaveBeenCalledWith('cd /foo\n');
  });

  it('detects prompt with trailing unstripped escape sequences', () => {
    const pty = createMockPty();
    waitForShellPrompt({
      subscribe: pty.subscribe,
      write: pty.write,
      data: 'cd /foo\n',
    });

    // Prompt followed by charset reset + bracketed paste that survive escape stripping
    pty.emit('user@host ~> \x1b(B');
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

  it('detects fish prompt with DCS and mixed OSC terminators', () => {
    const pty = createMockPty();
    waitForShellPrompt({
      subscribe: pty.subscribe,
      write: pty.write,
      data: 'cd /foo\n',
    });

    // Real fish output: DCS queries (\x1bP...\x1b\\), ST-terminated OSC (\x1b]...\x1b\\),
    // and BEL-terminated OSC (\x1b]...\x07) interleaved with visible prompt text.
    // The ST-terminated OSC must be stripped before the BEL-terminated OSC regex runs,
    // otherwise the greedy BEL regex matches from an ST-terminated \x1b] across visible
    // text to a distant \x07, consuming the entire prompt.
    pty.emit(
      '\x1b[?u\x1b[>0q\x1b]11;?\x1b\\\x1b[?1049h' +
        '\x1bP+q696e646e\x1b\\\x1bP+q71756572792d6f732d6e616d65\x1b\\' +
        '\x1b[?1049l\x1b[0c\r' +
        'Welcome to fish, the friendly interactive shell\r\n' +
        'Type \x1b[32mhelp\x1b[m for instructions on how to use fish\r\n' +
        '\x1b]7;file://host/home/user/project\x07' +
        '\x1b]0;[host] ~/project\x07' +
        '\x1b[m\x1b]11;?\x1b\\\x1b[6n\x1b[0c' +
        '\x1b[?2004h\x1b[?2031h\x1b[>4;1m\x1b=' +
        '\x1b]133;A;click_events=1\x1b\\' +
        '\x1b[92muser\x1b[m@\x1b[33mhost\x1b[m \x1b[32m~/project\x1b[m (master)\x1b[m> ' +
        '\x1b]133;B\x07\x1b[K\r\x1b[45C'
    );
    expect(pty.write).toHaveBeenCalledWith('cd /foo\n');
  });

  it('detects prompt split across TCP segments', () => {
    const pty = createMockPty();
    waitForShellPrompt({
      subscribe: pty.subscribe,
      write: pty.write,
      data: 'cd /foo\n',
    });

    // Prompt character arrives in a separate chunk from the rest
    pty.emit('user@host /path');
    expect(pty.write).not.toHaveBeenCalled();

    pty.emit('> ');
    expect(pty.write).toHaveBeenCalledWith('cd /foo\n');
  });

  it('detects fish prompt split across TCP segments', () => {
    const pty = createMockPty();
    waitForShellPrompt({
      subscribe: pty.subscribe,
      write: pty.write,
      data: 'cd /foo\n',
    });

    pty.emit('Welcome to fish, the friendly interactive shell\r\n');
    pty.emit('Type `help` for instructions on how to use fish\r\n');
    expect(pty.write).not.toHaveBeenCalled();

    pty.emit('\x1b[32muser@host\x1b[0m \x1b[34m~');
    expect(pty.write).not.toHaveBeenCalled();

    pty.emit('\x1b[0m> ');
    expect(pty.write).toHaveBeenCalledWith('cd /foo\n');
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
