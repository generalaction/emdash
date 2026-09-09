import { describe, expect, it, vi } from 'vitest';
import type { PreviewServerEvent } from '@core/primitives/preview-servers/api';
import { previewServerUrl } from '@core/primitives/preview-servers/api';
import type { ConnectionState } from '@core/primitives/ssh/api';
import type { SshClientProxy } from '@core/services/ssh/node/lifecycle/ssh-client-proxy';
import { PortForwardService } from './port-forward-service';
import type {
  OpenPortForwardTunnelOptions,
  PortForwardProbeResult,
  PortForwardTunnel,
} from './port-forward-tunnel';
import { PreviewServerService } from './preview-server-service';

function createService(
  options: {
    connectionState?: ConnectionState;
    openTunnel?: (request: OpenPortForwardTunnelOptions) => Promise<PortForwardTunnel>;
    getSshProxy?: (
      connectionId: string
    ) => Promise<Pick<SshClientProxy, 'openTcpChannel' | 'isConnected'>>;
    inspectRemotePort?: (
      connectionId: string,
      remotePort: number
    ) => Promise<PortForwardProbeResult>;
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
  });
  service.attachSshRuntime({
    getConnectionState: () => connectionState,
    getSshProxy: options.getSshProxy ?? (async () => fakeProxy()),
    inspectRemotePort: options.inspectRemotePort,
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
    async openTcpChannel() {
      throw new Error('Unused by this test');
    },
  } satisfies Pick<SshClientProxy, 'openTcpChannel' | 'isConnected'>;
}

function registerLocal(service: PreviewServerService, overrides: { port?: number } = {}) {
  return service.registerDetectedTarget({
    projectId: 'project-1',
    workspaceId: 'workspace-1',
    transport: 'local',
    source: { kind: 'terminal-output', terminalId: 'terminal-1' },
    protocol: 'http:',
    host: 'localhost',
    port: overrides.port ?? 5173,
    urlPath: '/app',
  });
}

function registerSsh(service: PreviewServerService, overrides: { port?: number } = {}) {
  return service.registerDetectedTarget({
    projectId: 'project-1',
    workspaceId: 'workspace-1',
    transport: 'ssh',
    connectionId: 'connection-1',
    source: { kind: 'terminal-output', terminalId: 'terminal-1' },
    protocol: 'http:',
    host: 'localhost',
    port: overrides.port ?? 5173,
    urlPath: '/app',
  });
}

describe('PreviewServerService', () => {
  it('registers local detected URLs as workspace-owned direct previews', async () => {
    const { service, events } = createService();

    const first = await registerLocal(service);
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

  it('removes terminal-sourced previews when the source closes', async () => {
    const { service, events } = createService();
    const stopTerminal = vi.fn();
    service.registerStopTerminalServerHandler('local', stopTerminal);
    const server = await registerLocal(service);

    await service.handleTerminalSourceClosed({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      terminalId: 'terminal-1',
      transport: 'local',
      reason: 'local-probe-failed',
      server: {
        protocol: 'http:',
        host: 'localhost',
        port: 5173,
        urlPath: '/app',
      },
    });

    expect(
      service.listForWorkspace({ projectId: 'project-1', workspaceId: 'workspace-1' })
    ).toEqual([]);
    expect(events.at(-1)).toEqual({ type: 'remove', id: server.id });
    expect(stopTerminal).not.toHaveBeenCalled();
  });

  it('stops terminal servers through the registered handler', async () => {
    const { service } = createService();
    const stopTerminal = vi.fn();
    service.registerStopTerminalServerHandler('local', stopTerminal);
    const server = await registerLocal(service);

    await service.stop(server.id);

    expect(stopTerminal).toHaveBeenCalledWith(server);
  });

  it('auto-forwards SSH detected targets and deduplicates repeated detections', async () => {
    const context = createService();

    const first = await registerSsh(context.service);
    const duplicate = await registerSsh(context.service);

    expect(first).toMatchObject({
      id: 'ssh:auto:connection-1:project-1:workspace-1:http::5173',
      kind: 'forwarded',
      connectionId: 'connection-1',
      remotePort: 5173,
      localPort: 6001,
      status: { kind: 'ready' },
    });
    expect(duplicate).toEqual(first);
    expect(context.openedTunnels).toBe(1);
    expect(context.events).toEqual([
      {
        type: 'upsert',
        server: expect.objectContaining({ status: { kind: 'starting' } }),
      },
      { type: 'upsert', server: first },
    ]);
  });

  it('keeps an SSH detected target as failed when tunnel opening fails', async () => {
    const context = createService({
      openTunnel: async () => {
        throw new Error('bind failed');
      },
    });

    const server = await registerSsh(context.service);

    expect(server).toMatchObject({
      kind: 'forwarded',
      status: { kind: 'failed', message: 'Failed to open SSH port forward' },
    });
    expect(server).not.toHaveProperty('localPort');
    expect(
      context.service.listForWorkspace({ projectId: 'project-1', workspaceId: 'workspace-1' })
    ).toEqual([server]);
    expect(context.events.map((event) => event.type)).toEqual(['upsert', 'upsert']);
  });

  it('stops an auto-forwarded target through its connection handler after closing the tunnel', async () => {
    const context = createService();
    const localStopTerminal = vi.fn();
    const remoteStopTerminal = vi.fn();
    context.service.registerStopTerminalServerHandler('local', localStopTerminal);
    context.service.registerStopTerminalServerHandler('connection-1', remoteStopTerminal);
    const server = await registerSsh(context.service);

    await context.service.stop(server.id);

    expect(context.closedTunnelIds).toEqual([`preview:${server.id}`]);
    expect(remoteStopTerminal).toHaveBeenCalledWith(server);
    expect(localStopTerminal).not.toHaveBeenCalled();
  });

  it('matches terminal closure to an auto-forwarded target by remote port and connection', async () => {
    const context = createService();
    const stopTerminal = vi.fn();
    context.service.registerStopTerminalServerHandler('connection-1', stopTerminal);
    const server = await registerSsh(context.service);

    await context.service.handleTerminalSourceClosed({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      terminalId: 'terminal-1',
      transport: 'ssh',
      connectionId: 'another-connection',
      reason: 'local-probe-failed',
      server: {
        protocol: 'http:',
        host: 'localhost',
        port: 5173,
        urlPath: '/app',
      },
    });
    expect(
      context.service.listForWorkspace({ projectId: 'project-1', workspaceId: 'workspace-1' })
    ).toEqual([server]);

    await context.service.handleTerminalSourceClosed({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      terminalId: 'terminal-1',
      transport: 'ssh',
      connectionId: 'connection-1',
      reason: 'local-probe-failed',
      server: {
        protocol: 'http:',
        host: '127.0.0.1',
        port: 5173,
        urlPath: '/ignored',
      },
    });

    expect(
      context.service.listForWorkspace({ projectId: 'project-1', workspaceId: 'workspace-1' })
    ).toEqual([]);
    expect(context.closedTunnelIds).toEqual([`preview:${server.id}`]);
    expect(stopTerminal).not.toHaveBeenCalled();
  });

  it('stops previews by workspace and project', async () => {
    const { service } = createService();
    const first = await registerLocal(service, { port: 5173 });
    const second = await registerLocal(service, { port: 5174 });
    await service.registerDetectedTarget({
      projectId: 'project-2',
      workspaceId: 'workspace-2',
      transport: 'local',
      source: { kind: 'terminal-output', terminalId: 'terminal-2' },
      protocol: 'http:',
      host: 'localhost',
      port: 5175,
      urlPath: '/',
    });

    await service.stopForWorkspace('project-1', 'workspace-1');

    expect(
      service.listForWorkspace({ projectId: 'project-1', workspaceId: 'workspace-1' })
    ).toEqual([]);
    expect(
      service.listForWorkspace({ projectId: 'project-2', workspaceId: 'workspace-2' })
    ).toHaveLength(1);

    await service.stopForProject('project-2');

    expect(
      service.listForWorkspace({ projectId: 'project-2', workspaceId: 'workspace-2' })
    ).toEqual([]);
    expect(first.id).not.toBe(second.id);
  });

  it('creates manual forwarded previews with generated identity and root path', async () => {
    const context = createService();

    const firstResult = await context.service.forwardManual({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      connectionId: 'connection-1',
      protocol: 'https:',
      remotePort: 8443,
      preferredLocalPort: 9443,
    });
    const secondResult = await context.service.forwardManual({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      connectionId: 'connection-1',
      protocol: 'https:',
      remotePort: 8443,
      preferredLocalPort: 9444,
    });

    expect(firstResult.success).toBe(true);
    expect(secondResult.success).toBe(true);
    if (!firstResult.success || !secondResult.success) throw new Error('manual forward failed');

    expect(firstResult.data.id).not.toBe(secondResult.data.id);
    expect(firstResult.data.source).toEqual({ kind: 'manual' });
    expect(firstResult.data.urlPath).toBe('/');
    expect(firstResult.data.kind).toBe('forwarded');
    expect(previewServerUrl(firstResult.data)).toBe('https://127.0.0.1:6001/');
    expect(context.openedTunnels).toBe(2);
  });

  it('reuses a manual forward when SSH detection finds the same remote port', async () => {
    const context = createService();
    const manualResult = await context.service.forwardManual({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      connectionId: 'connection-1',
      protocol: 'http:',
      remotePort: 5173,
    });
    if (!manualResult.success) throw new Error('manual forward failed');

    const detected = await registerSsh(context.service);

    expect(detected).toBe(manualResult.data);
    expect(context.openedTunnels).toBe(1);
    expect(
      context.service.listForWorkspace({ projectId: 'project-1', workspaceId: 'workspace-1' })
    ).toEqual([manualResult.data]);
  });

  it('returns an error result and removes the row when manual tunnel opening fails', async () => {
    const context = createService({
      openTunnel: async () => {
        throw new Error('bind failed');
      },
    });

    const result = await context.service.forwardManual({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      connectionId: 'connection-1',
      protocol: 'http:',
      remotePort: 8080,
    });

    expect(result).toEqual({
      success: false,
      error: {
        type: 'open-failed',
        message: 'Failed to open SSH port forward',
      },
    });
    expect(
      context.service.listForWorkspace({ projectId: 'project-1', workspaceId: 'workspace-1' })
    ).toEqual([]);
    expect(context.events.map((event) => event.type)).toEqual(['upsert', 'remove']);
  });

  it('restarts a forwarded preview using the current local port as the preferred port', async () => {
    const preferredLocalPorts: Array<number | undefined> = [];
    const context = createService({
      openTunnel: async (request) => {
        preferredLocalPorts.push(request.preferredLocalPort);
        return {
          localPort: preferredLocalPorts.length === 1 ? 6100 : 6200,
          close: async () => {},
        };
      },
    });
    const result = await context.service.forwardManual({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      connectionId: 'connection-1',
      protocol: 'http:',
      remotePort: 5173,
    });
    if (!result.success) throw new Error('manual forward failed');

    const restarted = await context.service.restart(result.data.id);

    expect(preferredLocalPorts).toEqual([5173, 6100]);
    expect(restarted?.status).toEqual({ kind: 'ready' });
    expect(previewServerUrl(restarted!)).toBe('http://127.0.0.1:6200/');
  });

  it('translates SSH connection events into forwarded preview status updates', async () => {
    const context = createService();
    const result = await context.service.forwardManual({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      connectionId: 'connection-1',
      protocol: 'http:',
      remotePort: 5173,
    });
    if (!result.success) throw new Error('manual forward failed');

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
      .filter((event) => event.type === 'upsert' && event.server.id === result.data.id)
      .map((event) => (event.type === 'upsert' ? event.server.status : null));

    expect(statusEvents).toEqual([
      { kind: 'starting' },
      { kind: 'ready' },
      { kind: 'reconnecting' },
      { kind: 'ready' },
      { kind: 'failed', message: 'SSH connection failed to reconnect' },
    ]);
  });

  it('retries a failed auto-forward when its SSH connection reconnects', async () => {
    let canOpen = false;
    let openAttempts = 0;
    const context = createService({
      openTunnel: async () => {
        openAttempts++;
        if (!canOpen) throw new Error('bind failed');
        return { localPort: 6200, close: async () => {} };
      },
    });
    const failed = await registerSsh(context.service);
    expect(failed.status.kind).toBe('failed');

    canOpen = true;
    context.service.handleSshConnectionEvent({
      type: 'reconnected',
      connectionId: 'connection-1',
    });

    await vi.waitFor(() => {
      const [server] = context.service.listForWorkspace({
        projectId: 'project-1',
        workspaceId: 'workspace-1',
      });
      expect(server).toMatchObject({
        id: failed.id,
        localPort: 6200,
        status: { kind: 'ready' },
      });
    });
    expect(openAttempts).toBe(2);
  });

  it('passes a connection-scoped advisory probe to the tunnel', async () => {
    const inspectRemotePort = vi
      .fn()
      .mockResolvedValue({ listening: true, families: ['ipv6'] } satisfies PortForwardProbeResult);
    let probe: OpenPortForwardTunnelOptions['probe'];
    const context = createService({
      inspectRemotePort,
      openTunnel: async (request) => {
        probe = request.probe;
        return { localPort: 6100, close: async () => {} };
      },
    });

    await registerSsh(context.service);

    expect(probe).toBeDefined();
    await expect(probe!(5173)).resolves.toEqual({ listening: true, families: ['ipv6'] });
    expect(inspectRemotePort).toHaveBeenCalledWith('connection-1', 5173);
  });

  it('omits the probe when the SSH runtime has no port inspection', async () => {
    let request: OpenPortForwardTunnelOptions | undefined;
    const context = createService({
      openTunnel: async (openRequest) => {
        request = openRequest;
        return { localPort: 6100, close: async () => {} };
      },
    });

    await registerSsh(context.service);

    expect(request?.probe).toBeUndefined();
  });

  it('surfaces a not-listening state from the probe and recovers on the first forwarded connection', async () => {
    let onProbeResult: OpenPortForwardTunnelOptions['onProbeResult'];
    let onConnectionEstablished: OpenPortForwardTunnelOptions['onConnectionEstablished'];
    const context = createService({
      openTunnel: async (request) => {
        onProbeResult = request.onProbeResult;
        onConnectionEstablished = request.onConnectionEstablished;
        return { localPort: 6100, close: async () => {} };
      },
    });

    const server = await registerSsh(context.service);
    expect(server.status).toEqual({ kind: 'ready' });

    onProbeResult?.({ listening: false, families: [] });
    let [current] = context.service.listForWorkspace({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
    });
    expect(current).toMatchObject({
      id: server.id,
      localPort: 6100,
      status: { kind: 'not-listening' },
    });
    expect(previewServerUrl(current!)).toBe('http://127.0.0.1:6100/app');

    onConnectionEstablished?.();
    [current] = context.service.listForWorkspace({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
    });
    expect(current).toMatchObject({ id: server.id, status: { kind: 'ready' } });
  });

  it('lands in the not-listening state when the probe answers before the tunnel opens', async () => {
    const context = createService({
      openTunnel: async (request) => {
        request.onProbeResult?.({ listening: false, families: [] });
        return { localPort: 6100, close: async () => {} };
      },
    });

    const server = await registerSsh(context.service);

    expect(server.status).toEqual({ kind: 'not-listening' });
    expect(server).toMatchObject({ localPort: 6100 });
  });

  it('marks a forwarded preview failed when later browser traffic cannot reach the remote port', async () => {
    let onConnectionError: ((error: Error) => void) | undefined;
    const context = createService({
      openTunnel: async (request) => {
        onConnectionError = request.onConnectionError;
        return { localPort: 6100, close: async () => {} };
      },
    });
    const result = await context.service.forwardManual({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
      connectionId: 'connection-1',
      protocol: 'http:',
      remotePort: 5173,
    });
    if (!result.success) throw new Error('manual forward failed');

    onConnectionError?.(new Error('(SSH) Channel open failure: Connection refused'));
    await new Promise((resolve) => setImmediate(resolve));

    const [failed] = context.service.listForWorkspace({
      projectId: 'project-1',
      workspaceId: 'workspace-1',
    });
    expect(failed).toMatchObject({
      id: result.data.id,
      kind: 'forwarded',
      status: {
        kind: 'failed',
        message: 'Remote preview port is no longer accepting connections',
      },
    });
    expect(previewServerUrl(failed!)).toBeNull();
    expect(context.closedTunnelIds).toEqual([`preview:${result.data.id}`]);
    expect(context.events.at(-1)).toEqual({ type: 'upsert', server: failed });
  });
});
