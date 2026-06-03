import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { PtyExitInfo } from '@main/core/pty/pty';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import { openSsh2Pty } from '@main/core/pty/ssh2-pty';
import type { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import { makePtySessionId } from '@shared/ptySessionId';
import type { Terminal } from '@shared/terminals';
import { SshTerminalProvider } from './ssh-terminal-provider';

const ptyMock = vi.hoisted(() => ({
  exitHandlers: [] as Array<(info: PtyExitInfo) => void>,
  sessions: [] as Array<{
    kill: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('@main/core/pty/ssh2-pty', () => ({
  openSsh2Pty: vi.fn(async () => {
    const session = {
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(),
      onExit: vi.fn((handler: (info: PtyExitInfo) => void) => {
        ptyMock.exitHandlers.push(handler);
      }),
    };
    ptyMock.sessions.push(session);
    return {
      success: true,
      data: session,
    };
  }),
}));

vi.mock('@main/core/pty/pty-session-registry', () => ({
  ptySessionRegistry: {
    register: vi.fn(),
    unregister: vi.fn(),
  },
}));

vi.mock('@main/core/ssh/lifecycle/production-ssh-connection-manager', () => ({
  sshConnectionManager: {
    on: vi.fn(),
    off: vi.fn(),
  },
}));

vi.mock('../dev-server-watcher', () => ({
  wireTerminalDevServerWatcher: vi.fn(),
}));

const terminal: Terminal = {
  id: 'terminal-1',
  projectId: 'project-1',
  taskId: 'task-1',
  shellId: 'system',
  name: 'Terminal 1',
};

const ctx = {
  supportsLocalSpawn: false,
  exec: vi.fn(),
  execStreaming: vi.fn(),
  dispose: vi.fn(),
} satisfies IExecutionContext;

const proxy = {
  getRemoteShellProfile: vi.fn(async () => ({
    shell: '/bin/bash',
    env: { PATH: '/usr/bin', HOME: '/home/me' },
  })),
} satisfies Partial<SshClientProxy> as unknown as SshClientProxy;

describe('SshTerminalProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ptyMock.exitHandlers.length = 0;
    ptyMock.sessions.length = 0;
    vi.mocked(ptySessionRegistry.register).mockClear();
    proxy.getRemoteShellProfile = vi.fn(async () => ({
      shell: '/bin/bash',
      env: { PATH: '/usr/bin', HOME: '/home/me' },
    }));
  });

  it('registers user terminals with their display name for resource monitor labels', async () => {
    const provider = new SshTerminalProvider({
      projectId: terminal.projectId,
      scopeId: terminal.taskId,
      taskPath: '/repo',
      ctx,
      proxy,
      connectionId: 'ssh-1',
    });

    await provider.spawnTerminal(terminal);

    const sessionId = makePtySessionId(terminal.projectId, terminal.taskId, terminal.id);
    expect(ptySessionRegistry.register).toHaveBeenCalledWith(
      sessionId,
      expect.anything(),
      expect.objectContaining({ metadata: { title: terminal.name, isRemote: true } })
    );
  });

  it('cleans up cached shell profiles after a non-respawned exit', async () => {
    const provider = new SshTerminalProvider({
      projectId: terminal.projectId,
      scopeId: terminal.taskId,
      taskPath: '/repo',
      ctx,
      proxy,
      connectionId: 'ssh-1',
    });

    await provider.spawnLifecycleScript({
      terminal,
      command: 'echo ready',
    });

    const sessionId = makePtySessionId(terminal.projectId, terminal.taskId, terminal.id);
    expect(
      (provider as unknown as { shellProfiles: Map<string, unknown> }).shellProfiles.has(sessionId)
    ).toBe(true);

    for (const handler of ptyMock.exitHandlers) handler({ exitCode: 0 });

    expect(
      (provider as unknown as { shellProfiles: Map<string, unknown> }).shellProfiles.has(sessionId)
    ).toBe(false);
  });

  it('does not respawn when a manual terminal kill exits synchronously', async () => {
    vi.useFakeTimers();
    try {
      const provider = new SshTerminalProvider({
        projectId: terminal.projectId,
        scopeId: terminal.taskId,
        taskPath: '/repo',
        ctx,
        proxy,
        connectionId: 'ssh-1',
      });

      await provider.spawnTerminal(terminal);

      const pty = ptyMock.sessions[0];
      pty.kill.mockImplementation(() => {
        for (const handler of [...ptyMock.exitHandlers]) handler({ signal: 'SIGTERM' });
      });
      vi.mocked(openSsh2Pty).mockClear();

      await provider.killTerminal(terminal.id);
      await vi.advanceTimersByTimeAsync(600);

      expect(openSsh2Pty).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
