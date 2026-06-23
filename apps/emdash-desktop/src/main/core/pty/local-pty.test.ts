import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { log } from '@main/lib/logger';
import { LocalPtySession } from './local-pty';

vi.mock('node-pty', () => ({
  spawn: vi.fn(),
}));

vi.mock('@main/lib/logger', () => ({
  log: {
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe('LocalPtySession', () => {
  type MockPtyProcess = ConstructorParameters<typeof LocalPtySession>[1];

  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  let mockProc: MockPtyProcess;
  let pty: LocalPtySession;

  function setPlatform(platform: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', {
      ...originalPlatform,
      value: platform,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockProc = {
      pid: 1234,
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(),
      onExit: vi.fn(),
    } as unknown as MockPtyProcess;
    pty = new LocalPtySession('test-id', mockProc);

    vi.spyOn(process, 'kill').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
  });

  it('kill() sends SIGTERM to process group on POSIX', () => {
    setPlatform('linux');

    pty.kill();

    expect(process.kill).toHaveBeenCalledWith(-1234, 'SIGTERM');
    expect(mockProc.kill).toHaveBeenCalled();
  });

  it('kill() follows up with SIGKILL after 2 seconds if not exited', () => {
    setPlatform('linux');

    pty.kill();
    expect(process.kill).not.toHaveBeenCalledWith(-1234, 'SIGKILL');

    vi.advanceTimersByTime(2000);
    expect(process.kill).toHaveBeenCalledWith(-1234, 'SIGKILL');
  });

  it('kill() does not send SIGKILL if process exits before timeout', () => {
    setPlatform('linux');

    let exitHandler: ((info: { exitCode: number; signal: number }) => void) | undefined;
    vi.mocked(mockProc.onExit).mockImplementation((handler) => {
      exitHandler = handler;
      return { dispose: vi.fn() };
    });

    pty.onExit(() => {});
    pty.kill();
    exitHandler?.({ exitCode: 0, signal: 0 });

    vi.advanceTimersByTime(2000);
    expect(process.kill).not.toHaveBeenCalledWith(-1234, 'SIGKILL');
  });

  it('catches errors thrown by onExit handlers', () => {
    let exitHandler: ((info: { exitCode: number; signal: number }) => void) | undefined;
    vi.mocked(mockProc.onExit).mockImplementation((handler) => {
      exitHandler = handler;
      return { dispose: vi.fn() };
    });

    pty.onExit(() => {
      throw new Error('cleanup failed');
    });

    expect(() => exitHandler?.({ exitCode: 1, signal: 15 })).not.toThrow();
    expect(log.error).toHaveBeenCalledWith('LocalPtySession:onExit handler failed', {
      id: 'test-id',
      exitCode: 1,
      signal: 'SIGTERM',
      error: 'cleanup failed',
    });
  });

  it('kill() does not use process groups on Windows', () => {
    setPlatform('win32');

    pty.kill();

    expect(process.kill).not.toHaveBeenCalledWith(-1234, expect.any(String));
    expect(mockProc.kill).toHaveBeenCalled();
  });

  it('kill() is idempotent', () => {
    setPlatform('linux');

    pty.kill();
    pty.kill();

    expect(process.kill).toHaveBeenCalledTimes(1);
    expect(mockProc.kill).toHaveBeenCalledTimes(1);
  });
});
