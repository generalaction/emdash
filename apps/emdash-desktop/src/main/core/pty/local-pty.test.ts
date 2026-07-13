import type { PosixPtyTerminator } from '@emdash/core/services/pty/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalPtySession } from './local-pty';

vi.mock('node-pty', () => ({
  spawn: vi.fn(),
}));

describe('LocalPtySession', () => {
  type MockPtyProcess = ConstructorParameters<typeof LocalPtySession>[1];

  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  let mockProc: MockPtyProcess;
  let posixTerminator: Pick<PosixPtyTerminator, 'kill' | 'markExited'>;
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
    pty = new LocalPtySession('test-id', mockProc, posixTerminator);
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
});
