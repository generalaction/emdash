import { err, ok, type Result } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import type { PreviewServer } from '@core/primitives/preview-servers/api';
import { createPreviewServersWireController } from './wire-controller';

const input = { projectId: 'project-1', workspaceId: 'workspace-1' };
const unavailable = {
  type: 'project-missing' as const,
  projectId: 'project-1',
};
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

function harness() {
  const requireAttached = vi.fn((): Result<never, typeof unavailable> => ok({} as never));
  const service = {
    listForWorkspace: vi.fn(() => [server]),
    getServer: vi.fn(() => server),
    forwardManual: vi.fn(async () => ok(server)),
    restart: vi.fn(async () => server),
    stop: vi.fn(async () => {}),
  };
  const controller = createPreviewServersWireController({
    projects: { requireAttached } as never,
    service,
  });
  return { controller, requireAttached, service };
}

describe('createPreviewServersWireController', () => {
  it('returns a typed unavailable result before a workspace was observed', async () => {
    const { controller, requireAttached, service } = harness();
    requireAttached.mockReturnValue(err(unavailable));

    await expect(controller.call('listForWorkspace', input)).resolves.toEqual(
      err({
        type: 'project-unavailable',
        projectId: input.projectId,
        reason: 'project-missing',
        message: 'Project runtime is unavailable.',
      })
    );
    expect(service.listForWorkspace).not.toHaveBeenCalled();
  });

  it('retains an observed service snapshot after attachment is lost', async () => {
    const { controller, requireAttached } = harness();
    await expect(controller.call('listForWorkspace', input)).resolves.toEqual(ok([server]));

    requireAttached.mockReturnValue(err(unavailable));
    await expect(controller.call('listForWorkspace', input)).resolves.toEqual(ok([server]));
  });

  it('checks effective project attachment before live mutations', async () => {
    const { controller, requireAttached, service } = harness();
    requireAttached.mockReturnValue(err(unavailable));

    await expect(controller.call('restart', { id: server.id })).resolves.toMatchObject({
      success: false,
      error: { type: 'project-unavailable', reason: 'project-missing' },
    });
    expect(service.restart).not.toHaveBeenCalled();
  });
});
