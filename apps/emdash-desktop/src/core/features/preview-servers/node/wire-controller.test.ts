import { ok } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import type { PreviewServer } from '@core/primitives/preview-servers/api';
import { createPreviewServersWireController } from './wire-controller';

const input = { projectId: 'project-1', workspaceId: 'workspace-1' };
const server: PreviewServer = {
  id: 'preview-1',
  projectId: input.projectId,
  workspaceId: input.workspaceId,
  kind: 'direct',
  source: { kind: 'terminal-output', terminalId: 'terminal-1' },
  protocol: 'http:',
  host: 'localhost',
  port: 3000,
  urlPath: '/',
  status: { kind: 'ready' },
};

describe('createPreviewServersWireController', () => {
  it('delegates preview-server operations to the access service', async () => {
    const service = {
      listForWorkspace: vi.fn(async () => ok([server])),
      forwardManual: vi.fn(async () => ok(server)),
      restart: vi.fn(async () => ok<void>()),
      stop: vi.fn(async () => ok<void>()),
    };
    const controller = createPreviewServersWireController(service);
    await expect(controller.call('listForWorkspace', input)).resolves.toEqual(ok([server]));
    await expect(controller.call('restart', { id: server.id })).resolves.toEqual(ok<void>());

    expect(service.listForWorkspace).toHaveBeenCalledWith(input);
    expect(service.restart).toHaveBeenCalledWith({ id: server.id });
  });
});
