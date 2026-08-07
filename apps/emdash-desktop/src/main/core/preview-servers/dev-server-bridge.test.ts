import type { TerminalDevServerList } from '@emdash/core/runtimes/terminals/api';
import type * as WireState from '@emdash/wire/state';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hostFileRefFromNativePath } from '@core/primitives/desktop-runtime/api';
import type { PreviewServer } from '@core/primitives/preview-servers/api';
import { createDevServerBridge, type DevServerBridgeDependencies } from './dev-server-bridge';

const mocks = vi.hoisted(() => ({
  list: {} as TerminalDevServerList,
  observe: vi.fn(),
  remote: vi.fn(),
  whenReady: vi.fn(),
}));

vi.mock('@emdash/wire/state', async (importOriginal) => ({
  ...(await importOriginal<typeof WireState>()),
  observe: mocks.observe,
  remote: mocks.remote,
  whenReady: mocks.whenReady,
}));

describe('createDevServerBridge', () => {
  beforeEach(() => {
    mocks.list = {
      detected: {
        key: {
          workspace: hostFileRefFromNativePath('/repo', 'connection-1'),
          id: 'project-1:workspace-1:terminal-1',
        },
        protocol: 'http:',
        host: 'localhost',
        port: 5173,
        urlPath: '/app',
        detectedAt: 1,
      },
    };
    mocks.observe.mockReset();
    mocks.remote.mockReset();
    mocks.whenReady.mockReset();
    mocks.remote.mockReturnValue(() => ({ states: { list: {} } }));
    mocks.observe.mockImplementation(
      (_state: unknown, listener: (snapshot: { value: TerminalDevServerList }) => void) => {
        listener({ value: mocks.list });
        return () => {};
      }
    );
    mocks.whenReady.mockResolvedValue(undefined);
  });

  it('threads SSH host context, matches forwarded previews, and reconciles to empty on dispose', async () => {
    let stopHandler: ((server: PreviewServer) => Promise<void> | void) | undefined;
    const unregisterStopHandler = vi.fn();
    const registerDetectedTarget = vi.fn(async () => undefined);
    const handleTerminalSourceClosed = vi.fn(async () => {});
    const registerStopTerminalServerHandler = vi.fn(
      (_key: string, handler: (server: PreviewServer) => Promise<void> | void) => {
        stopHandler = handler;
        return unregisterStopHandler;
      }
    );
    const resolveWorkspace = vi.fn(async () => ({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
    }));
    const dependencies = {
      previewServers: {
        registerDetectedTarget,
        handleTerminalSourceClosed,
        registerStopTerminalServerHandler,
      },
      resolveWorkspace,
    } as unknown as DevServerBridgeDependencies;
    const sendInput = vi.fn(async () => ({ success: true, data: undefined }));
    const bridge = await createDevServerBridge(
      { devServers: {}, sendInput } as never,
      dependencies,
      { transport: 'ssh', connectionId: 'connection-1' }
    );

    expect(registerDetectedTarget).toHaveBeenCalledWith({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      transport: 'ssh',
      connectionId: 'connection-1',
      source: { kind: 'terminal-output', terminalId: 'terminal-1' },
      protocol: 'http:',
      host: 'localhost',
      port: 5173,
      urlPath: '/app',
    });
    expect(registerStopTerminalServerHandler).toHaveBeenCalledWith(
      'connection-1',
      expect.any(Function)
    );

    await stopHandler?.({
      id: 'ssh:auto:1',
      kind: 'forwarded',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      source: { kind: 'terminal-output', terminalId: 'terminal-1' },
      protocol: 'http:',
      urlPath: '/app',
      status: { kind: 'ready' },
      connectionId: 'connection-1',
      remotePort: 5173,
      localPort: 6173,
    });
    expect(sendInput).toHaveBeenCalledWith({
      key: mocks.list.detected!.key,
      data: '\x03',
    });

    await bridge.dispose();

    expect(handleTerminalSourceClosed).toHaveBeenCalledWith({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      terminalId: 'terminal-1',
      transport: 'ssh',
      connectionId: 'connection-1',
      reason: 'source-detached',
      server: {
        protocol: 'http:',
        host: 'localhost',
        port: 5173,
        urlPath: '/app',
      },
    });
    expect(unregisterStopHandler).toHaveBeenCalledOnce();
  });
});
