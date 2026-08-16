import { err, ok, type Result } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import type { PreviewServer } from '@core/primitives/preview-servers/api';
import { PreviewServerAccessService } from './preview-server-access-service';

const input = { projectId: 'project-1', workspaceId: 'workspace-1' };
const unavailable = {
  type: 'project-missing' as const,
  projectId: input.projectId,
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
  const previewServers = {
    listForWorkspace: vi.fn(() => [server]),
    getServer: vi.fn(() => server),
    forwardManual: vi.fn(async () => ok(server)),
    restart: vi.fn(async () => server),
    stop: vi.fn(async () => {}),
  };
  const service = new PreviewServerAccessService({
    projects: { requireAttached } as never,
    previewServers,
  });
  return { previewServers, requireAttached, service };
}

describe('PreviewServerAccessService', () => {
  it('returns a typed unavailable result before a workspace was observed', async () => {
    const { previewServers, requireAttached, service } = harness();
    requireAttached.mockReturnValue(err(unavailable));

    await expect(service.listForWorkspace(input)).resolves.toEqual(
      err({
        type: 'project-unavailable',
        projectId: input.projectId,
        reason: 'project-missing',
        message: 'Project runtime is unavailable.',
      })
    );
    expect(previewServers.listForWorkspace).not.toHaveBeenCalled();
  });

  it('retains an observed service snapshot after attachment is lost', async () => {
    const { requireAttached, service } = harness();
    await expect(service.listForWorkspace(input)).resolves.toEqual(ok([server]));

    requireAttached.mockReturnValue(err(unavailable));
    await expect(service.listForWorkspace(input)).resolves.toEqual(ok([server]));
  });

  it('forgets every workspace for one detached project without evicting other projects', async () => {
    const { requireAttached, service } = harness();
    const secondWorkspace = { projectId: input.projectId, workspaceId: 'workspace-2' };
    const otherProject = { projectId: 'project-2', workspaceId: 'workspace-3' };

    await service.listForWorkspace(input);
    await service.listForWorkspace(secondWorkspace);
    await service.listForWorkspace(otherProject);

    requireAttached.mockReturnValue(err(unavailable));
    await expect(service.listForWorkspace(input)).resolves.toEqual(ok([server]));
    await expect(service.listForWorkspace(otherProject)).resolves.toEqual(ok([server]));

    service.forgetProject(input.projectId);

    await expect(service.listForWorkspace(input)).resolves.toMatchObject({
      success: false,
      error: { type: 'project-unavailable', projectId: input.projectId },
    });
    await expect(service.listForWorkspace(secondWorkspace)).resolves.toMatchObject({
      success: false,
      error: { type: 'project-unavailable', projectId: input.projectId },
    });
    await expect(service.listForWorkspace(otherProject)).resolves.toEqual(ok([server]));
  });

  it('checks effective project attachment before live mutations', async () => {
    const { previewServers, requireAttached, service } = harness();
    requireAttached.mockReturnValue(err(unavailable));

    await expect(service.restart({ id: server.id })).resolves.toMatchObject({
      success: false,
      error: { type: 'project-unavailable', reason: 'project-missing' },
    });
    expect(previewServers.restart).not.toHaveBeenCalled();
  });
});
