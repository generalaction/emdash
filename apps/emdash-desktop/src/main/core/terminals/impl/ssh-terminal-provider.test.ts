import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { Pty, PtyExitInfo } from '@main/core/pty/pty';
import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import type { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import { makePtySessionId } from '@shared/core/pty/ptySessionId';
import type { Terminal } from '@shared/core/terminals/terminals';
import { SshTerminalProvider } from './ssh-terminal-provider';

const ptyMock = vi.hoisted(() => ({
  exitHandlers: [] as Array<(info: PtyExitInfo) => void>,
  ptys: [] as Array<{
    write: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    kill: ReturnType<typeof vi.fn>;
    onData: ReturnType<typeof vi.fn>;
    onExit: ReturnType<typeof vi.fn>;
  }>,
}));

const openSsh2PtyMock = vi.hoisted(() =>
  vi.fn(async () => {
    const pty = {
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(),
      onExit: vi.fn((handler: (info: PtyExitInfo) => void) => {
        ptyMock.exitHandlers.push(handler);
      }),
    };
    ptyMock.ptys.push(pty);
    return { success: true, data: pty };
  })
);

const sshConnectionManagerMock = vi.hoisted(() => ({
  handlers: [] as Array<(event: { type: string; connectionId: string }) => void>,
}));

const previewServerServiceMock = vi.hoisted(() => ({
  registerDetectedTarget: vi.fn(),
  handleTerminalSourceClosed: vi.fn(),
}));

const terminalUrlDetectorMock = vi.hoisted(() => ({
  wireTerminalUrlDetector: vi.fn(),
}));

vi.mock('@main/core/pty/ssh2-pty', () => ({
  openSsh2Pty: openSsh2PtyMock,
}));

vi.mock('@main/core/pty/pty-session-registry', () => ({
  ptySessionRegistry: {
    register: vi.fn(),
    unregister: vi.fn(),
    getLastSize: vi.fn(),
  },
}));

vi.mock('@main/core/ssh/lifecycle/production-ssh-connection-manager', () => ({
  sshConnectionManager: {
    on: vi.fn(
      (_event: string, handler: (event: { type: string; connectionId: string }) => void) => {
        sshConnectionManagerMock.handlers.push(handler);
      }
    ),
    off: vi.fn(),
  },
}));

vi.mock('@main/core/preview-servers/preview-server-service-instance', () => ({
  previewServerService: previewServerServiceMock,
}));

vi.mock('@main/core/preview-servers/terminal-url-detector', () => ({
  wireTerminalUrlDetector: terminalUrlDetectorMock.wireTerminalUrlDetector,
}));

vi.mock('@main/core/pty/terminal-color-scheme', () => ({
  getTerminalColorEnv: vi.fn().mockResolvedValue({}),
}));

const { sshConnectionManager } =
  await import('@main/core/ssh/lifecycle/production-ssh-connection-manager');

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
    ptyMock.exitHandlers.length = 0;
    ptyMock.ptys.length = 0;
    sshConnectionManagerMock.handlers.length = 0;
    openSsh2PtyMock.mockClear();
    vi.mocked(sshConnectionManager.off).mockClear();
    terminalUrlDetectorMock.wireTerminalUrlDetector.mockClear();
    vi.mocked(ptySessionRegistry.unregister).mockClear();
    previewServerServiceMock.registerDetectedTarget.mockClear();
    previewServerServiceMock.registerDetectedTarget.mockResolvedValue(undefined);
    previewServerServiceMock.handleTerminalSourceClosed.mockClear();
    vi.mocked(ptySessionRegistry.register).mockClear();
    vi.mocked(ptySessionRegistry.getLastSize).mockReturnValue(undefined);
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

  it('registers detected preview URLs against the SSH workspace and connection', async () => {
    const provider = new SshTerminalProvider({
      projectId: terminal.projectId,
      workspaceId: 'workspace-1',
      scopeId: terminal.taskId,
      taskPath: '/repo',
      ctx,
      proxy,
      connectionId: 'ssh-1',
    });

    await provider.spawnTerminal(terminal);

    const detectorOptions = terminalUrlDetectorMock.wireTerminalUrlDetector.mock.calls[0]?.[0];
    expect(detectorOptions).toMatchObject({ probeLocalPorts: false });

    detectorOptions.onDetected({
      protocol: 'http:',
      host: '127.0.0.1',
      port: 5173,
      urlPath: '/',
    });

    expect(previewServerServiceMock.registerDetectedTarget).toHaveBeenCalledWith({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      connectionId: 'ssh-1',
      transport: 'ssh',
      proxy,
      source: { kind: 'terminal-output', terminalId: 'terminal-1' },
      protocol: 'http:',
      port: 5173,
      urlPath: '/',
    });
  });

  it('detaches stale sessions on disconnect so reconnect can rehydrate them', async () => {
    const provider = new SshTerminalProvider({
      projectId: terminal.projectId,
      scopeId: terminal.taskId,
      taskPath: '/repo',
      ctx,
      proxy,
      connectionId: 'ssh-1',
    });

    await provider.spawnTerminal(terminal, { cols: 120, rows: 40 });
    const sessionId = makePtySessionId(terminal.projectId, terminal.taskId, terminal.id);
    expect(
      (provider as unknown as { sessions: Map<string, unknown> }).sessions.has(sessionId)
    ).toBe(true);

    for (const handler of sshConnectionManagerMock.handlers) {
      handler({ type: 'disconnected', connectionId: 'ssh-1' });
    }

    expect(
      (provider as unknown as { sessions: Map<string, unknown> }).sessions.has(sessionId)
    ).toBe(false);
    expect(ptySessionRegistry.unregister).toHaveBeenCalledWith(sessionId, { pty: ptyMock.ptys[0] });
    expect(ptyMock.ptys[0]!.kill).toHaveBeenCalledOnce();

    for (const handler of sshConnectionManagerMock.handlers) {
      handler({ type: 'reconnected', connectionId: 'ssh-1' });
    }
    await new Promise((resolve) => setImmediate(resolve));

    expect(openSsh2PtyMock).toHaveBeenCalledTimes(2);
    expect(
      (provider as unknown as { sessions: Map<string, unknown> }).sessions.has(sessionId)
    ).toBe(true);
  });

  it('rehydrates detached sessions when manually connected', async () => {
    const provider = new SshTerminalProvider({
      projectId: terminal.projectId,
      scopeId: terminal.taskId,
      taskPath: '/repo',
      ctx,
      proxy,
      connectionId: 'ssh-1',
    });

    await provider.spawnTerminal(terminal);

    for (const handler of sshConnectionManagerMock.handlers) {
      handler({ type: 'disconnected', connectionId: 'ssh-1' });
    }
    for (const handler of sshConnectionManagerMock.handlers) {
      handler({ type: 'connected', connectionId: 'ssh-1' });
    }
    await new Promise((resolve) => setImmediate(resolve));

    expect(openSsh2PtyMock).toHaveBeenCalledTimes(2);
  });

  it('clears reconnect sizes when killing a terminal detached for reconnect', async () => {
    const provider = new SshTerminalProvider({
      projectId: terminal.projectId,
      scopeId: terminal.taskId,
      taskPath: '/repo',
      ctx,
      proxy,
      connectionId: 'ssh-1',
    });

    await provider.spawnTerminal(terminal, { cols: 120, rows: 40 });
    const sessionId = makePtySessionId(terminal.projectId, terminal.taskId, terminal.id);
    vi.mocked(ptySessionRegistry.getLastSize).mockReturnValue({ cols: 120, rows: 40 });

    for (const handler of sshConnectionManagerMock.handlers) {
      handler({ type: 'disconnected', connectionId: 'ssh-1' });
    }

    expect(
      (provider as unknown as { reconnectSizes: Map<string, unknown> }).reconnectSizes.has(
        sessionId
      )
    ).toBe(true);

    await provider.killTerminal(terminal.id);

    expect(
      (provider as unknown as { reconnectSizes: Map<string, unknown> }).reconnectSizes.has(
        sessionId
      )
    ).toBe(false);
  });

  it('cancels in-flight rehydrate starts after detachAll', async () => {
    const provider = new SshTerminalProvider({
      projectId: terminal.projectId,
      scopeId: terminal.taskId,
      taskPath: '/repo',
      ctx,
      proxy,
      connectionId: 'ssh-1',
    });
    let resolveRehydrateOpen: ((value: { success: true; data: Pty }) => void) | undefined;

    await provider.spawnTerminal(terminal);
    const firstPty = ptyMock.ptys[0];
    openSsh2PtyMock.mockImplementationOnce(
      (() =>
        new Promise<{ success: true; data: Pty }>((resolve) => {
          resolveRehydrateOpen = resolve;
        })) as never
    );

    for (const handler of sshConnectionManagerMock.handlers) {
      handler({ type: 'disconnected', connectionId: 'ssh-1' });
    }
    for (const handler of sshConnectionManagerMock.handlers) {
      handler({ type: 'reconnected', connectionId: 'ssh-1' });
    }
    await new Promise((resolve) => setImmediate(resolve));

    await provider.detachAll();
    const rehydratedPty = {
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(),
      onExit: vi.fn(),
    } satisfies Pty;
    resolveRehydrateOpen?.({ success: true, data: rehydratedPty });
    await new Promise((resolve) => setImmediate(resolve));

    const sessionId = makePtySessionId(terminal.projectId, terminal.taskId, terminal.id);
    expect(openSsh2PtyMock).toHaveBeenCalledTimes(2);
    expect(firstPty?.kill).toHaveBeenCalledOnce();
    expect(rehydratedPty.kill).toHaveBeenCalledOnce();
    expect(
      (provider as unknown as { sessions: Map<string, unknown> }).sessions.has(sessionId)
    ).toBe(false);
    expect(ptySessionRegistry.register).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes SSH connection listeners when detached', async () => {
    const provider = new SshTerminalProvider({
      projectId: terminal.projectId,
      scopeId: terminal.taskId,
      taskPath: '/repo',
      ctx,
      proxy,
      connectionId: 'ssh-1',
    });

    await provider.detachAll();

    expect(sshConnectionManager.off).toHaveBeenCalledWith('connection-event', expect.any(Function));
  });
});
