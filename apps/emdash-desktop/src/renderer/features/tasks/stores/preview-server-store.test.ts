import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreviewServer, PreviewServerEvent } from '@shared/core/preview-servers/types';
import { previewServerUrl } from '@shared/core/preview-servers/types';

const handlers: Array<(event: PreviewServerEvent) => void> = [];

function emitPreviewServerEvent(event: PreviewServerEvent): void {
  for (const handler of handlers) handler(event);
}

const rpcMocks = vi.hoisted(() => ({
  listForWorkspace: vi.fn(),
  stop: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: {
    on: vi.fn((_channel, handler: (event: PreviewServerEvent) => void) => {
      handlers.push(handler);
      return () => {};
    }),
  },
  rpc: {
    previewServers: rpcMocks,
  },
}));

const { PreviewServerStore } = await import('./preview-server-store');

function directServer(overrides: Partial<PreviewServer> = {}): PreviewServer {
  return {
    kind: 'direct',
    id: 'direct-1',
    projectId: 'project-1',
    workspaceId: 'workspace-1',
    source: { kind: 'terminal-output', terminalId: 'terminal-1' },
    protocol: 'http:',
    host: 'localhost',
    port: 5173,
    urlPath: '/',
    status: { kind: 'ready' },
    ...overrides,
  } as PreviewServer;
}

function forwardedServer(overrides: Partial<PreviewServer> = {}): PreviewServer {
  return {
    kind: 'forwarded',
    id: 'forwarded-1',
    projectId: 'project-1',
    workspaceId: 'workspace-1',
    source: { kind: 'terminal-output', terminalId: 'terminal-1' },
    protocol: 'http:',
    connectionId: 'ssh-1',
    remotePort: 3000,
    localPort: 6100,
    urlPath: '/',
    status: { kind: 'ready' },
    ...overrides,
  } as PreviewServer;
}

describe('PreviewServerStore', () => {
  beforeEach(() => {
    handlers.length = 0;
    rpcMocks.listForWorkspace.mockReset();
    rpcMocks.stop.mockReset();
  });

  it('loads preview servers for a workspace and exposes addressable URLs', async () => {
    const first = forwardedServer({ id: 'first', remotePort: 3000 });
    const second = directServer({ id: 'second', port: 5174 });
    const pending = forwardedServer({
      id: 'pending',
      remotePort: 3001,
      localPort: undefined,
      status: { kind: 'starting' },
    });
    rpcMocks.listForWorkspace.mockResolvedValueOnce([second, pending, first]);

    const store = new PreviewServerStore({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
    });
    await store.serversResource.load();

    expect(rpcMocks.listForWorkspace).toHaveBeenCalledWith({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
    });
    expect(store.servers.map((server) => server.id)).toEqual(['first', 'pending', 'second']);
    expect(store.urls).toEqual([previewServerUrl(first), previewServerUrl(second)]);

    store.dispose();
  });

  it('applies upsert and remove events for the active workspace', async () => {
    rpcMocks.listForWorkspace.mockResolvedValue([]);
    const store = new PreviewServerStore({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
    });
    await store.serversResource.load();
    store.start();

    const active = directServer();
    emitPreviewServerEvent({ type: 'upsert', server: active });
    emitPreviewServerEvent({
      type: 'upsert',
      server: directServer({
        id: 'other',
        workspaceId: 'workspace-2',
        port: 5174,
      }),
    });

    expect(store.servers.map((server) => server.id)).toEqual(['direct-1']);

    emitPreviewServerEvent({ type: 'remove', id: active.id });

    expect(store.servers).toEqual([]);

    store.dispose();
  });

  it('stops a preview server', async () => {
    const server = directServer();
    rpcMocks.listForWorkspace.mockResolvedValueOnce([server]);
    const store = new PreviewServerStore({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
    });
    await store.serversResource.load();

    await store.stop(server.id);

    expect(rpcMocks.stop).toHaveBeenCalledWith(server.id);
    expect(store.servers).toEqual([]);

    store.dispose();
  });

  it('stubs manual forwarding until the workspace-server client is available', async () => {
    const localStore = new PreviewServerStore({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
    });
    await expect(
      localStore.forwardManual({ protocol: 'http:', remotePort: 8080 })
    ).resolves.toEqual({
      success: false,
      error: {
        type: 'not-ssh-workspace',
        message: 'Manual port forwarding requires a remote workspace',
      },
    });

    const remoteStore = new PreviewServerStore({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      connectionId: 'ssh-1',
    });
    await expect(
      remoteStore.forwardManual({ protocol: 'http:', remotePort: 8080 })
    ).resolves.toEqual({
      success: false,
      error: {
        type: 'runtime-unavailable',
        message:
          'Port forwarding requires the workspace server and is not available in this build.',
      },
    });
  });
});
