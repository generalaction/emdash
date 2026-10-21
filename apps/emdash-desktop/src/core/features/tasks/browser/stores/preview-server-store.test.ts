import { ok } from '@emdash/shared';
import { observable, runInAction } from 'mobx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ProjectHostAccess,
  ProjectHostAccessState,
} from '@core/features/projects/api/browser/stores/project-context';
import type { PreviewServer, PreviewServerEvent } from '@core/primitives/preview-servers/api';
import { previewServerUrl } from '@core/primitives/preview-servers/api';

const handlers: Array<(event: PreviewServerEvent) => void> = [];

function emitPreviewServerEvent(event: PreviewServerEvent): void {
  for (const handler of handlers) handler(event);
}

const wireMocks = vi.hoisted(() => ({
  listForWorkspace: vi.fn(),
  forwardManual: vi.fn(),
  restart: vi.fn(),
  stop: vi.fn(),
  subscribe: vi.fn(async (_key, observer: { onEvent: (event: PreviewServerEvent) => void }) => {
    handlers.push(observer.onEvent);
    return () => {};
  }),
}));

vi.mock('@core/features/preview-servers/api/browser/client', () => ({
  getPreviewServersClient: async () => ({
    ...wireMocks,
    events: { subscribe: wireMocks.subscribe },
  }),
}));

const { PreviewServerStore } = await import('../../api/browser/stores/preview-server-store');

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
    wireMocks.listForWorkspace.mockReset();
    wireMocks.forwardManual.mockReset();
    wireMocks.restart.mockReset();
    wireMocks.stop.mockReset();
    wireMocks.subscribe.mockClear();
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
    wireMocks.listForWorkspace.mockResolvedValueOnce(ok([second, pending, first]));

    const store = new PreviewServerStore({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
    });
    await store.serversResource.load();

    expect(wireMocks.listForWorkspace).toHaveBeenCalledWith({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
    });
    expect(store.servers.map((server) => server.id)).toEqual(['first', 'pending', 'second']);
    expect(store.urls).toEqual([previewServerUrl(first), previewServerUrl(second)]);

    store.dispose();
  });

  it('applies upsert and remove events for the active workspace', async () => {
    wireMocks.listForWorkspace.mockResolvedValue(ok([]));
    const store = new PreviewServerStore({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
    });
    await store.serversResource.load();
    store.start();
    await vi.waitFor(() => expect(handlers).toHaveLength(1));

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
    wireMocks.listForWorkspace.mockResolvedValueOnce(ok([server]));
    wireMocks.stop.mockResolvedValueOnce(ok(undefined));
    const store = new PreviewServerStore({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
    });
    await store.serversResource.load();

    await store.stop(server.id);

    expect(wireMocks.stop).toHaveBeenCalledWith({ id: server.id });
    expect(store.servers).toEqual([]);

    store.dispose();
  });

  it('guards manual forwarding to remote workspaces', async () => {
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
    expect(wireMocks.forwardManual).not.toHaveBeenCalled();
  });

  it('forwards a manual remote port through the wire client', async () => {
    const server = forwardedServer({
      id: 'manual-1',
      source: { kind: 'manual' },
      remotePort: 8080,
      localPort: 9000,
    });
    const remoteStore = new PreviewServerStore({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      connectionId: 'ssh-1',
    });
    wireMocks.forwardManual.mockResolvedValueOnce({ success: true, data: server });

    await expect(
      remoteStore.forwardManual({
        protocol: 'http:',
        remotePort: 8080,
        preferredLocalPort: 9000,
      })
    ).resolves.toEqual({ success: true, data: server });

    expect(wireMocks.forwardManual).toHaveBeenCalledWith({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      connectionId: 'ssh-1',
      protocol: 'http:',
      remotePort: 8080,
      preferredLocalPort: 9000,
    });
    expect(remoteStore.servers).toEqual([server]);
  });

  it('restarts a forwarded preview server through the wire client', async () => {
    const store = new PreviewServerStore({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
    });

    wireMocks.restart.mockResolvedValueOnce(ok(undefined));
    await store.restart('forwarded-1');

    expect(wireMocks.restart).toHaveBeenCalledWith({ id: 'forwarded-1' });
  });

  it('keeps prior observations stale offline and refreshes in place after recovery', async () => {
    const state = observable.box<ProjectHostAccessState>({
      kind: 'ready',
      hostGeneration: 1,
    });
    const hostAccess = {
      get state() {
        return state.get();
      },
      get liveAction() {
        const current = state.get();
        return current.kind === 'ready'
          ? ({ kind: 'enabled' } as const)
          : ({ kind: 'disabled', state: current } as const);
      },
    } as ProjectHostAccess;
    const first = directServer({ id: 'first' });
    const recovered = directServer({ id: 'recovered', port: 5174 });
    wireMocks.listForWorkspace
      .mockResolvedValueOnce(ok([first]))
      .mockResolvedValueOnce(ok([recovered]));
    const store = new PreviewServerStore({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      hostAccess,
    });
    store.start();
    await vi.waitFor(() => expect(store.servers.map((server) => server.id)).toEqual(['first']));

    runInAction(() =>
      state.set({
        kind: 'degraded',
        situation: 'offline',
        recovery: 'automatic',
      })
    );

    expect(store.observation).toEqual({ kind: 'stale', value: [first] });
    await expect(
      store.forwardManual({ protocol: 'http:', remotePort: 8080 })
    ).resolves.toMatchObject({
      success: false,
      error: { type: 'project-unavailable', projectId: 'project-1' },
    });
    expect(wireMocks.forwardManual).not.toHaveBeenCalled();

    runInAction(() => state.set({ kind: 'ready', hostGeneration: 2 }));
    await vi.waitFor(() => expect(store.servers.map((server) => server.id)).toEqual(['recovered']));
    expect(store.observation.kind).toBe('live');
    store.dispose();
  });

  it('reports never-observed preview data unavailable without calling live seams', () => {
    const state: ProjectHostAccessState = {
      kind: 'degraded',
      situation: 'offline',
      recovery: 'automatic',
    };
    const hostAccess = {
      state,
      liveAction: { kind: 'disabled', state },
    } as ProjectHostAccess;
    const store = new PreviewServerStore({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      hostAccess,
    });

    store.start();

    expect(store.observation).toEqual({ kind: 'unavailable' });
    expect(wireMocks.listForWorkspace).not.toHaveBeenCalled();
    expect(wireMocks.subscribe).not.toHaveBeenCalled();
    store.dispose();
  });
});
