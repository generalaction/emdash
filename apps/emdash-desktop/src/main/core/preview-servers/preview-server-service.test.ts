import { describe, expect, it, vi } from 'vitest';
import type { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import type { PreviewServerEvent } from '@shared/core/preview-servers/types';
import { previewServerUrl } from '@shared/core/preview-servers/types';
import type { ConnectionState } from '@shared/core/ssh/ssh';
import { PortForwardService } from '../port-forwards/port-forward-service';
import type { PortForwardTunnel } from '../port-forwards/port-forward-tunnel';
import { PreviewServerService } from './preview-server-service';

function createService(
  options: {
    connectionState?: ConnectionState;
    openTunnel?: (request: {
      proxy: Pick<SshClientProxy, 'client' | 'isConnected'>;
      remotePort: number;
      preferredLocalPort?: number;
    }) => Promise<PortForwardTunnel>;
  } = {}
) {
  const events: PreviewServerEvent[] = [];
  const closedTunnelIds: string[] = [];
  let openedTunnels = 0;
  let connectionState = options.connectionState ?? 'connected';
  const portForwards = new PortForwardService({
    openTunnel:
      options.openTunnel ??
      (async () => {
        openedTunnels++;
        return {
          localPort: 6000 + openedTunnels,
          close: async () => {},
        };
      }),
    onTunnelClosed: (id) => closedTunnelIds.push(id),
  });

  const service = new PreviewServerService({
    portForwards,
    emit: (event) => events.push(event),
    getConnectionState: () => connectionState,
    getSshProxy: async () => fakeProxy(),
    closeDelayMs: 250,
  });

  return {
    service,
    events,
    closedTunnelIds,
    get openedTunnels() {
      return openedTunnels;
    },
    setConnectionState(next: ConnectionState) {
      connectionState = next;
    },
  };
}

function fakeProxy() {
  return {
    isConnected: true,
    get client() {
      return {} as SshClientProxy['client'];
    },
  } satisfies Pick<SshClientProxy, 'client' | 'isConnected'>;
}

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};
  let reject: (reason?: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('PreviewServerService', () => {
  it('registers local detected URLs as workspace-owned direct previews', async () => {
    const { service, events } = createService();

    const first = await service.registerDetectedTarget({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      transport: 'local',
      source: { kind: 'terminal-output', terminalId: 'terminal-1' },
      protocol: 'http:',
      host: 'localhost',
      port: 5173,
      urlPath: '/app',
    });
    const duplicate = await service.registerDetectedTarget({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      transport: 'local',
      source: { kind: 'terminal-output', terminalId: 'terminal-2' },
      protocol: 'http:',
      host: 'localhost',
      port: 5173,
      urlPath: '/ignored',
    });

    expect(duplicate.id).toBe(first.id);
    expect(
      service.listForWorkspace({ projectId: 'project-1', workspaceId: 'workspace-1' })
    ).toEqual([first]);
    expect(previewServerUrl(first)).toBe('http://localhost:5173/app');
    expect(events).toEqual([{ type: 'upsert', server: first }]);
  });

  it('deduplicates SSH detected URLs by workspace, connection, and remote port', async () => {
    const context = createService();

    const first = await context.service.registerDetectedTarget({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      connectionId: 'connection-1',
      transport: 'ssh',
      proxy: fakeProxy(),
      source: { kind: 'terminal-output', terminalId: 'terminal-1' },
      protocol: 'http:',
      port: 5173,
      urlPath: '/',
    });
    const duplicate = await context.service.registerDetectedTarget({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      connectionId: 'connection-1',
      transport: 'ssh',
      proxy: fakeProxy(),
      source: { kind: 'terminal-output', terminalId: 'terminal-1' },
      protocol: 'http:',
      port: 5173,
      urlPath: '/ignored',
    });

    expect(duplicate.id).toBe(first.id);
    expect(context.openedTunnels).toBe(1);
    expect(previewServerUrl(first)).toBe('http://127.0.0.1:6001/');
    expect(
      context.service.listForWorkspace({ projectId: 'project-1', workspaceId: 'workspace-1' })
    ).toEqual([first]);
    expect(
      context.events
        .filter((event) => event.type === 'upsert' && event.server.id === first.id)
        .map((event) => (event.type === 'upsert' ? event.server.status : null))
    ).toEqual([{ kind: 'starting' }, { kind: 'ready' }]);
  });

  it('deduplicates SSH detections while the tunnel is still opening', async () => {
    const tunnel = deferred<PortForwardTunnel>();
    let openCount = 0;
    const context = createService({
      openTunnel: async () => {
        openCount++;
        return await tunnel.promise;
      },
    });

    const firstPromise = context.service.registerDetectedTarget({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      connectionId: 'connection-1',
      transport: 'ssh',
      proxy: fakeProxy(),
      source: { kind: 'terminal-output', terminalId: 'terminal-1' },
      protocol: 'http:',
      port: 5173,
      urlPath: '/',
    });
    const duplicate = await context.service.registerDetectedTarget({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      connectionId: 'connection-1',
      transport: 'ssh',
      proxy: fakeProxy(),
      source: { kind: 'terminal-output', terminalId: 'terminal-2' },
      protocol: 'http:',
      port: 5173,
      urlPath: '/ignored',
    });

    expect(duplicate.status).toEqual({ kind: 'starting' });
    expect(openCount).toBe(1);

    tunnel.resolve({ localPort: 6100, close: async () => {} });
    const first = await firstPromise;

    expect(previewServerUrl(first)).toBe('http://127.0.0.1:6100/');
    expect(openCount).toBe(1);
  });

  it('keeps a failed SSH preview row when automatic tunnel opening fails', async () => {
    const context = createService({
      openTunnel: async () => {
        throw new Error('bind failed');
      },
    });

    const server = await context.service.registerDetectedTarget({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      connectionId: 'connection-1',
      transport: 'ssh',
      proxy: fakeProxy(),
      source: { kind: 'terminal-output', terminalId: 'terminal-1' },
      protocol: 'http:',
      port: 5173,
      urlPath: '/',
    });

    expect(server.kind).toBe('forwarded');
    expect(previewServerUrl(server)).toBeNull();
    expect(server.status).toEqual({
      kind: 'failed',
      message: 'Failed to open SSH port forward: bind failed',
    });
    expect(
      context.service.listForWorkspace({ projectId: 'project-1', workspaceId: 'workspace-1' })
    ).toEqual([server]);
    expect(
      context.events
        .filter((event) => event.type === 'upsert' && event.server.id === server.id)
        .map((event) => (event.type === 'upsert' ? event.server.status : null))
    ).toEqual([
      { kind: 'starting' },
      { kind: 'failed', message: 'Failed to open SSH port forward: bind failed' },
    ]);
  });

  it('restarts a failed SSH preview using the remote port as the preferred local port', async () => {
    const preferredLocalPorts: Array<number | undefined> = [];
    let attempt = 0;
    const context = createService({
      openTunnel: async (request) => {
        attempt++;
        preferredLocalPorts.push(request.preferredLocalPort);
        if (attempt === 1) throw new Error('bind failed');
        return { localPort: 6200, close: async () => {} };
      },
    });
    const failed = await context.service.registerDetectedTarget({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      connectionId: 'connection-1',
      transport: 'ssh',
      proxy: fakeProxy(),
      source: { kind: 'terminal-output', terminalId: 'terminal-1' },
      protocol: 'http:',
      port: 5173,
      urlPath: '/',
    });

    const restarted = await context.service.restart(failed.id);

    expect(preferredLocalPorts).toEqual([5173, 5173]);
    expect(restarted?.status).toEqual({ kind: 'ready' });
    expect(previewServerUrl(restarted!)).toBe('http://127.0.0.1:6200/');
  });

  it('keeps SSH terminal previews through transport-loss PTY exits', async () => {
    vi.useFakeTimers();
    try {
      const context = createService({ connectionState: 'reconnecting' });
      const server = await context.service.registerDetectedTarget({
        projectId: 'project-1',
        workspaceId: 'workspace-1',
        connectionId: 'connection-1',
        transport: 'ssh',
        proxy: fakeProxy(),
        source: { kind: 'terminal-output', terminalId: 'terminal-1' },
        protocol: 'http:',
        port: 5173,
        urlPath: '/',
      });

      await context.service.handleTerminalSourceClosed({
        projectId: 'project-1',
        workspaceId: 'workspace-1',
        terminalId: 'terminal-1',
        transport: 'ssh',
        connectionId: 'connection-1',
        reason: 'pty-exit',
      });
      await vi.advanceTimersByTimeAsync(250);

      expect(
        context.service.listForWorkspace({ projectId: 'project-1', workspaceId: 'workspace-1' })
      ).toEqual([server]);
      expect(context.closedTunnelIds).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops SSH terminal previews after PTY exit when SSH remains connected', async () => {
    vi.useFakeTimers();
    try {
      const context = createService({ connectionState: 'connected' });
      const server = await context.service.registerDetectedTarget({
        projectId: 'project-1',
        workspaceId: 'workspace-1',
        connectionId: 'connection-1',
        transport: 'ssh',
        proxy: fakeProxy(),
        source: { kind: 'terminal-output', terminalId: 'terminal-1' },
        protocol: 'http:',
        port: 5173,
        urlPath: '/',
      });

      await context.service.handleTerminalSourceClosed({
        projectId: 'project-1',
        workspaceId: 'workspace-1',
        terminalId: 'terminal-1',
        transport: 'ssh',
        connectionId: 'connection-1',
        reason: 'pty-exit',
      });
      await context.service.stop(server.id);
      await vi.advanceTimersByTimeAsync(250);

      expect(
        context.service.listForWorkspace({ projectId: 'project-1', workspaceId: 'workspace-1' })
      ).toEqual([]);
      expect(context.events.filter((event) => event.type === 'remove')).toEqual([
        { type: 'remove', id: server.id },
      ]);
      expect(context.closedTunnelIds).toEqual([
        'preview:ssh:auto:project-1:workspace-1:connection-1:5173',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('translates SSH connection events into forwarded preview status updates', async () => {
    const context = createService();
    const server = await context.service.registerDetectedTarget({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      connectionId: 'connection-1',
      transport: 'ssh',
      proxy: fakeProxy(),
      source: { kind: 'terminal-output', terminalId: 'terminal-1' },
      protocol: 'http:',
      port: 5173,
      urlPath: '/',
    });

    context.service.handleSshConnectionEvent({
      type: 'reconnecting',
      connectionId: 'connection-1',
    });
    context.service.handleSshConnectionEvent({ type: 'reconnected', connectionId: 'connection-1' });
    context.service.handleSshConnectionEvent({
      type: 'reconnect-failed',
      connectionId: 'connection-1',
    });

    const statusEvents = context.events
      .filter((event) => event.type === 'upsert' && event.server.id === server.id)
      .map((event) => (event.type === 'upsert' ? event.server.status : null));

    expect(statusEvents).toEqual([
      { kind: 'starting' },
      { kind: 'ready' },
      { kind: 'reconnecting' },
      { kind: 'ready' },
      { kind: 'failed', message: 'SSH connection failed to reconnect' },
    ]);
  });

  it('creates manual forwarded previews with generated identity and root path', async () => {
    const context = createService();

    const first = await context.service.forwardManual({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      connectionId: 'connection-1',
      protocol: 'https:',
      remotePort: 8443,
      preferredLocalPort: 9443,
    });
    const second = await context.service.forwardManual({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      connectionId: 'connection-1',
      protocol: 'https:',
      remotePort: 8443,
      preferredLocalPort: 9444,
    });

    expect(first.id).not.toBe(second.id);
    expect(first.source).toEqual({ kind: 'manual' });
    expect(first.urlPath).toBe('/');
    expect(first.kind).toBe('forwarded');
    expect(previewServerUrl(first)).toBe('https://127.0.0.1:6001/');
    expect(context.openedTunnels).toBe(2);
  });

  it('stops only previews owned by a released workspace', async () => {
    const context = createService();
    const first = await context.service.registerDetectedTarget({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      connectionId: 'connection-1',
      transport: 'ssh',
      proxy: fakeProxy(),
      source: { kind: 'terminal-output', terminalId: 'terminal-1' },
      protocol: 'http:',
      port: 5173,
      urlPath: '/',
    });
    const second = await context.service.registerDetectedTarget({
      projectId: 'project-1',
      workspaceId: 'workspace-2',
      connectionId: 'connection-1',
      transport: 'ssh',
      proxy: fakeProxy(),
      source: { kind: 'terminal-output', terminalId: 'terminal-2' },
      protocol: 'http:',
      port: 5174,
      urlPath: '/',
    });

    await context.service.stopForWorkspace('project-1', 'workspace-1');

    expect(
      context.service.listForWorkspace({ projectId: 'project-1', workspaceId: 'workspace-1' })
    ).toEqual([]);
    expect(
      context.service.listForWorkspace({ projectId: 'project-1', workspaceId: 'workspace-2' })
    ).toEqual([second]);
    expect(context.events).toContainEqual({ type: 'remove', id: first.id });
    expect(context.closedTunnelIds).toEqual([
      'preview:ssh:auto:project-1:workspace-1:connection-1:5173',
    ]);
  });
});
