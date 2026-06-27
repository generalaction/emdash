import * as nodePty from 'node-pty';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalPtySession, spawnLocalPty } from './local-pty';
import type { PosixPtyTerminator } from './posix-pty-terminator';
import type { WindowsConsoleInputInjector } from './windows-console-input';
import { extractSgrMouseSequences, stripSgrMouseSequences } from './windows-console-input';

vi.mock('node-pty', () => ({
  spawn: vi.fn(),
}));

describe('LocalPtySession', () => {
  type MockPtyProcess = ConstructorParameters<typeof LocalPtySession>[1];

  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  let mockProc: MockPtyProcess;
  let posixTerminator: Pick<PosixPtyTerminator, 'kill' | 'markExited'>;
  let windowsInputInjector: WindowsConsoleInputInjector;
  let pty: LocalPtySession;

  function setPlatform(platform: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', {
      ...originalPlatform,
      value: platform,
    });
  }

  function createPty(pid = 1234): void {
    mockProc = {
      pid,
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(),
      onExit: vi.fn(),
    } as unknown as MockPtyProcess;
    posixTerminator = {
      kill: vi.fn(),
      markExited: vi.fn(),
    };
    windowsInputInjector = { injectText: vi.fn(async () => true) };
    pty = new LocalPtySession('test-id', mockProc, posixTerminator, windowsInputInjector);
  }

  async function flushWindowsWrite(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    createPty();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  it('kill() delegates POSIX process-tree termination', () => {
    setPlatform('linux');

    pty.kill();

    expect(posixTerminator.kill).toHaveBeenCalledTimes(1);
    const [pid, killPty] = vi.mocked(posixTerminator.kill).mock.calls[0]!;
    expect(pid).toBe(1234);
    expect(mockProc.kill).not.toHaveBeenCalled();

    killPty();
    expect(mockProc.kill).toHaveBeenCalledTimes(1);
  });

  it('kill() does not use POSIX termination on Windows', () => {
    setPlatform('win32');

    pty.kill();

    expect(posixTerminator.kill).not.toHaveBeenCalled();
    expect(mockProc.kill).toHaveBeenCalledTimes(1);
  });

  it('kill() falls back to node-pty when pid is unavailable', () => {
    setPlatform('linux');
    createPty(0);

    pty.kill();

    expect(posixTerminator.kill).not.toHaveBeenCalled();
    expect(mockProc.kill).toHaveBeenCalledTimes(1);
  });

  it('kill() is idempotent', () => {
    setPlatform('linux');

    pty.kill();
    pty.kill();

    expect(posixTerminator.kill).toHaveBeenCalledTimes(1);
    expect(mockProc.kill).not.toHaveBeenCalled();
  });

  it('onExit() marks the POSIX terminator exited before forwarding exit info', () => {
    let exitHandler: ((info: { exitCode: number; signal: number }) => void) | undefined;
    vi.mocked(mockProc.onExit).mockImplementation((handler) => {
      exitHandler = handler;
      return { dispose: vi.fn() };
    });
    const handler = vi.fn();

    pty.onExit(handler);
    exitHandler?.({ exitCode: 143, signal: 15 });

    expect(vi.mocked(posixTerminator.markExited).mock.invocationCallOrder[0]).toBeLessThan(
      handler.mock.invocationCallOrder[0]!
    );
    expect(handler).toHaveBeenCalledWith({ exitCode: 143, signal: 'SIGTERM' });
  });

  it('write() injects SGR mouse reports into the Windows console input queue', async () => {
    setPlatform('win32');

    pty.write('a\x1b[<0;10;10M\x1b[<0;10;10m\x1b[A');
    await flushWindowsWrite();

    expect(windowsInputInjector.injectText).toHaveBeenCalledWith(
      1234,
      '\x1b[<0;10;10M\x1b[<0;10;10m'
    );
    expect(mockProc.write).toHaveBeenCalledWith('a\x1b[A');
  });

  it('write() treats SGR mouse reports as undelivered when Windows mouse injection fails', async () => {
    setPlatform('win32');
    vi.mocked(windowsInputInjector.injectText).mockResolvedValue(false);

    pty.write('a\x1b[<0;10;10M\x1b[A');
    await flushWindowsWrite();

    expect(mockProc.write).toHaveBeenCalledWith('a\x1b[<0;10;10M\x1b[A');
  });

  it('write() falls back to the PTY for mouse-only input when Windows injection fails', async () => {
    setPlatform('win32');
    vi.mocked(windowsInputInjector.injectText).mockResolvedValue(false);

    pty.write('\x1b[<64;10;10M');
    await flushWindowsWrite();

    expect(mockProc.write).toHaveBeenCalledWith('\x1b[<64;10;10M');
  });

  it('write() injects binary SGR wheel reports into the Windows console input queue', async () => {
    setPlatform('win32');

    pty.write(Buffer.from('\x1b[<64;10;10M', 'latin1'));
    await flushWindowsWrite();

    expect(windowsInputInjector.injectText).toHaveBeenCalledWith(1234, '\x1b[<64;10;10M');
    expect(mockProc.write).not.toHaveBeenCalled();
  });

  it('write() does not inject console input on POSIX', () => {
    setPlatform('linux');

    pty.write('\x1b[<0;10;10M');

    expect(windowsInputInjector.injectText).not.toHaveBeenCalled();
    expect(mockProc.write).toHaveBeenCalledWith('\x1b[<0;10;10M');
  });

  it('uses node-pty default ConPTY backend on Windows', () => {
    setPlatform('win32');
    vi.mocked(nodePty.spawn).mockReturnValue(mockProc);

    spawnLocalPty({
      id: 'session-1',
      command: 'cmd.exe',
      args: [],
      cwd: 'C:\\repo',
      env: { PATH: 'C:\\Windows\\System32' },
      cols: 80,
      rows: 24,
    });

    expect(nodePty.spawn).toHaveBeenCalledWith(
      'cmd.exe',
      [],
      expect.not.objectContaining({ useConpty: expect.anything() })
    );
  });

  it('does not force a Windows PTY backend on POSIX', () => {
    setPlatform('linux');
    vi.mocked(nodePty.spawn).mockReturnValue(mockProc);

    spawnLocalPty({
      id: 'session-1',
      command: '/bin/bash',
      args: [],
      cwd: '/repo',
      env: { PATH: '/usr/bin' },
      cols: 80,
      rows: 24,
    });

    expect(nodePty.spawn).toHaveBeenCalledWith(
      '/bin/bash',
      [],
      expect.not.objectContaining({ useConpty: expect.anything() })
    );
  });
});

describe('extractSgrMouseSequences', () => {
  it('extracts complete SGR mouse reports only', () => {
    expect(extractSgrMouseSequences('x\x1b[<0;10;10M\x1b[A\x1b[<64;2;3M')).toBe(
      '\x1b[<0;10;10M\x1b[<64;2;3M'
    );
  });
});

describe('stripSgrMouseSequences', () => {
  it('removes complete SGR mouse reports only', () => {
    expect(stripSgrMouseSequences('x\x1b[<0;10;10M\x1b[A\x1b[<64;2;3M')).toBe('x\x1b[A');
  });
});
