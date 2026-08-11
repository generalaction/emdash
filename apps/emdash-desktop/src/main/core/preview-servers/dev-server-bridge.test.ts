import type { TerminalDevServerList } from '@emdash/core/runtimes/terminals/api';
import type * as WireState from '@emdash/wire/state';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hostFileRefFromNativePath } from '@core/primitives/desktop-runtime/api';
import type { PreviewServer } from '@core/primitives/preview-servers/api';
import { createDevServerBridge, type DevServerBridgeDependencies } from './dev-server-bridge';

const mocks = vi.hoisted(() => ({
  list: {} as TerminalDevServerList,
  scriptList: {} as Record<string, unknown>,
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
    mocks.scriptList = {};
    mocks.observe.mockReset();
    mocks.remote.mockReset();
    mocks.whenReady.mockReset();
    mocks.remote.mockReturnValue(() => ({ states: { list: {} } }));
    // The bridge observes the terminals list first, then the scripts list.
    mocks.observe
      .mockImplementationOnce(
        (_state: unknown, listener: (snapshot: { value: TerminalDevServerList }) => void) => {
          listener({ value: mocks.list });
          return () => {};
        }
      )
      .mockImplementationOnce(
        (_state: unknown, listener: (snapshot: { value: Record<string, unknown> }) => void) => {
          listener({ value: mocks.scriptList });
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
      {
        terminals: { devServers: {}, sendInput },
        scripts: { devServers: {}, sendInput: vi.fn() },
      } as never,
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

  it('registers script-plane dev servers under lifecycle terminal ids and interrupts via the scripts runtime', async () => {
    mocks.list = {};
    mocks.scriptList = {
      detected: {
        key: { workspacePath: '/repo', script: 'run' },
        protocol: 'http:',
        host: 'localhost',
        port: 5173,
        urlPath: '/app',
        detectedAt: 1,
      },
    };
    let stopHandler: ((server: PreviewServer) => Promise<void> | void) | undefined;
    const registerDetectedTarget = vi.fn(async () => undefined);
    const dependencies = {
      previewServers: {
        registerDetectedTarget,
        handleTerminalSourceClosed: vi.fn(async () => {}),
        registerStopTerminalServerHandler: vi.fn(
          (_key: string, handler: (server: PreviewServer) => Promise<void> | void) => {
            stopHandler = handler;
            return vi.fn();
          }
        ),
      },
      resolveWorkspace: vi.fn(async () => ({
        projectId: 'project-1',
        workspaceId: 'workspace-1',
      })),
    } as unknown as DevServerBridgeDependencies;
    const terminalSendInput = vi.fn(async () => ({ success: true, data: undefined }));
    const scriptStop = vi.fn(async () => ({ success: true, data: undefined }));
    const bridge = await createDevServerBridge(
      {
        terminals: { devServers: {}, sendInput: terminalSendInput },
        scripts: { devServers: {}, stop: scriptStop },
      } as never,
      dependencies,
      { transport: 'local' }
    );

    expect(registerDetectedTarget).toHaveBeenCalledWith({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      transport: 'local',
      source: { kind: 'terminal-output', terminalId: 'script-lifecycle-run' },
      protocol: 'http:',
      host: 'localhost',
      port: 5173,
      urlPath: '/app',
    });

    await stopHandler?.({
      id: 'local:auto:1',
      kind: 'direct',
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      source: { kind: 'terminal-output', terminalId: 'script-lifecycle-run' },
      protocol: 'http:',
      host: 'localhost',
      port: 5173,
      urlPath: '/app',
      status: { kind: 'ready' },
    });
    // The stop verb, not a Ctrl-C: the run settles as cancelled in the timeline.
    expect(scriptStop).toHaveBeenCalledWith({
      workspacePath: '/repo',
      script: 'run',
    });
    expect(terminalSendInput).not.toHaveBeenCalled();

    await bridge.dispose();
  });
});
