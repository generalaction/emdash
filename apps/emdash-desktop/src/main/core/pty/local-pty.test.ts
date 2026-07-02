import * as nodePty from 'node-pty';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markConptyDllUnavailable, resolveUseConptyDll } from './conpty-dll';
import { LocalPtySession, spawnLocalPty } from './local-pty';
import type { PosixPtyTerminator } from './posix-pty-terminator';

vi.mock('node-pty', () => ({
  spawn: vi.fn(),
}));

vi.mock('./conpty-dll', () => ({
  resolveUseConptyDll: vi.fn(() => false),
  markConptyDllUnavailable: vi.fn(),
}));

function makeMockProc(pid = 1234) {
  return {
    pid,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn(),
  };
}

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
    mockProc = makeMockProc(pid) as unknown as MockPtyProcess;
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

  describe('spawnLocalPty ConPTY selection', () => {
    const spawnOptions = {
      id: 'test-id',
      command: 'cmd.exe',
      args: [],
      cwd: 'C:\\',
      env: {},
      cols: 80,
      rows: 24,
    };

    function fakeProc(): ReturnType<typeof nodePty.spawn> {
      return makeMockProc(42) as unknown as ReturnType<typeof nodePty.spawn>;
    }

    it('passes the resolved useConptyDll flag to node-pty', () => {
      vi.mocked(resolveUseConptyDll).mockReturnValue(true);
      vi.mocked(nodePty.spawn).mockReturnValue(fakeProc());

      spawnLocalPty(spawnOptions);

      expect(nodePty.spawn).toHaveBeenCalledWith(
        'cmd.exe',
        [],
        expect.objectContaining({ useConptyDll: true })
      );
    });

    it('retries with the in-box ConPTY when the bundled dll fails to spawn', () => {
      vi.mocked(resolveUseConptyDll).mockReturnValue(true);
      vi.mocked(nodePty.spawn)
        .mockImplementationOnce(() => {
          throw new Error('Cannot find conpty.dll');
        })
        .mockReturnValueOnce(fakeProc());

      const session = spawnLocalPty(spawnOptions);

      expect(session).toBeInstanceOf(LocalPtySession);
      expect(nodePty.spawn).toHaveBeenCalledTimes(2);
      expect(vi.mocked(nodePty.spawn).mock.calls[1]![2]).toMatchObject({ useConptyDll: false });
      // The in-box fallback worked, so the dll is the problem — later spawns
      // must skip the doomed bundled-dll attempt.
      expect(markConptyDllUnavailable).toHaveBeenCalledTimes(1);
    });

    it('throws when both spawn attempts fail', () => {
      vi.mocked(resolveUseConptyDll).mockReturnValue(true);
      vi.mocked(nodePty.spawn).mockImplementation(() => {
        throw new Error('boom');
      });

      expect(() => spawnLocalPty(spawnOptions)).toThrow('Failed to spawn PTY: boom');
      expect(nodePty.spawn).toHaveBeenCalledTimes(2);
      // Both attempts failing means the failure is not dll-specific — keep
      // the bundled dll enabled for future spawns.
      expect(markConptyDllUnavailable).not.toHaveBeenCalled();
    });

    it('does not retry when the bundled dll was not requested', () => {
      vi.mocked(resolveUseConptyDll).mockReturnValue(false);
      vi.mocked(nodePty.spawn).mockImplementation(() => {
        throw new Error('boom');
      });

      expect(() => spawnLocalPty(spawnOptions)).toThrow('Failed to spawn PTY: boom');
      expect(nodePty.spawn).toHaveBeenCalledTimes(1);
    });
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
