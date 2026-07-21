import { describe, expect, it, vi } from 'vitest';
import type { PreviewServerEvent } from '@core/primitives/preview-servers/api';
import { previewServerUrl } from '@core/primitives/preview-servers/api';
import { PreviewServerService } from './preview-server-service';

function createService() {
  const events: PreviewServerEvent[] = [];
  const service = new PreviewServerService({
    emit: (event) => events.push(event),
  });
  return { service, events };
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
  });

  it('stops terminal servers through the registered handler', async () => {
    const { service } = createService();
    const stopTerminal = vi.fn();
    service.setStopTerminalServerHandler(stopTerminal);
    const server = await registerLocal(service);

    await service.stop(server.id);

    expect(stopTerminal).toHaveBeenCalledWith(server);
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
});
