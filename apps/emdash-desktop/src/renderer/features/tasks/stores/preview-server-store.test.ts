import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreviewServer, PreviewServerEvent } from '@shared/core/preview-servers/types';
import { previewServerUrl } from '@shared/core/preview-servers/types';
import { ok } from '@shared/lib/result';

const handlers: Array<(event: PreviewServerEvent) => void> = [];

function emitPreviewServerEvent(event: PreviewServerEvent): void {
  for (const handler of handlers) handler(event);
}

const rpcMocks = vi.hoisted(() => ({
  listForWorkspace: vi.fn(),
  forwardManual: vi.fn(),
  restart: vi.fn(),
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
    rpcMocks.forwardManual.mockReset();
    rpcMocks.restart.mockReset();
    rpcMocks.stop.mockReset();
  });

  it('loads preview servers for a workspace and exposes addressable URLs', async () => {
    const ready = forwardedServer({ id: 'ready' });
    const reconnecting = forwardedServer({
      id: 'reconnecting',
      remotePort: 3001,
      localPort: 6101,
      status: { kind: 'reconnecting' },
    });
    const failed = forwardedServer({
      id: 'failed',
      remotePort: 3002,
      localPort: undefined,
      status: { kind: 'failed', message: 'failed' },
    });
    rpcMocks.listForWorkspace.mockResolvedValueOnce([ready, reconnecting, failed]);

    const store = new PreviewServerStore({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
    });
    await store.serversResource.load();

    expect(rpcMocks.listForWorkspace).toHaveBeenCalledWith({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
    });
    expect(store.servers.map((server) => server.id)).toEqual(['ready', 'reconnecting', 'failed']);
    expect(store.urls).toEqual([previewServerUrl(ready), previewServerUrl(reconnecting)]);

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

  it('forwards a manual remote port through the workspace connection', async () => {
    const forwarded = forwardedServer({
      id: 'manual-1',
      source: { kind: 'manual' },
      remotePort: 8080,
      localPort: 6500,
    });
    rpcMocks.forwardManual.mockResolvedValueOnce(ok(forwarded));
    rpcMocks.listForWorkspace.mockResolvedValueOnce([]);

    const store = new PreviewServerStore({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      connectionId: 'ssh-1',
    });
    const result = await store.forwardManual({ protocol: 'http:', remotePort: 8080 });

    expect(rpcMocks.forwardManual).toHaveBeenCalledWith({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      connectionId: 'ssh-1',
      protocol: 'http:',
      remotePort: 8080,
    });
    expect(result).toEqual(ok(forwarded));
    expect(store.servers.map((server) => server.id)).toEqual(['manual-1']);

    store.dispose();
  });

  it('requires an SSH connection for manual forwarding', async () => {
    const store = new PreviewServerStore({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
    });

    await expect(store.forwardManual({ protocol: 'http:', remotePort: 8080 })).resolves.toEqual({
      success: false,
      error: {
        type: 'not-ssh-workspace',
        message: 'Manual port forwarding requires an SSH workspace',
      },
    });

    expect(rpcMocks.forwardManual).not.toHaveBeenCalled();
    store.dispose();
  });

  it('does not upsert manual forwards that return an error result', async () => {
    rpcMocks.forwardManual.mockResolvedValueOnce({
      success: false,
      error: {
        type: 'open-failed',
        message: 'Failed to open SSH port forward',
      },
    });
    rpcMocks.listForWorkspace.mockResolvedValueOnce([]);

    const store = new PreviewServerStore({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      connectionId: 'ssh-1',
    });

    const result = await store.forwardManual({ protocol: 'http:', remotePort: 8080 });

    expect(result.success).toBe(false);
    expect(store.servers).toEqual([]);

    store.dispose();
  });
});
