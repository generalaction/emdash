import { describe, expect, it, vi } from 'vitest';
import { WorkspaceMutationService } from './workspace-mutation-service';

const unavailableProjects = {
  requireAttached: () => ({
    success: false as const,
    error: {
      type: 'attachment-unavailable' as const,
      host: {} as never,
      phase: 'waiting' as const,
    },
  }),
};

describe('WorkspaceMutationService', () => {
  it('refuses to clean artifacts when Project attachment is unavailable', async () => {
    const runtimeClient = vi.fn();
    const service = new WorkspaceMutationService({
      db: {} as never,
      projects: unavailableProjects,
      runtimes: { client: runtimeClient } as never,
    });

    await expect(
      service.cleanArtifacts({ projectId: 'project-1', workspaceId: 'workspace-1' })
    ).resolves.toEqual({
      success: false,
      error: {
        type: 'project-unavailable',
        message: 'This action requires live Project access.',
      },
    });
    expect(runtimeClient).not.toHaveBeenCalled();
  });

  it('cleans artifacts in place through the attached host registry, never removing the worktree', async () => {
    const cleanArtifacts = vi.fn(async () => ({ success: true as const, data: undefined }));
    const deleteWorktree = vi.fn();
    const attachedProjects = {
      requireAttached: () => ({
        success: true as const,
        data: { workspaceRegistry: { cleanArtifacts, deleteWorktree } } as never,
      }),
    };
    const service = new WorkspaceMutationService({
      db: {} as never,
      projects: attachedProjects,
      runtimes: {} as never,
    });

    await expect(
      service.cleanArtifacts({ projectId: 'project-1', workspaceId: 'workspace-1' })
    ).resolves.toEqual({ success: true, data: {} });
    expect(cleanArtifacts).toHaveBeenCalledWith({ workspaceId: 'workspace-1' });
    expect(deleteWorktree).not.toHaveBeenCalled();
  });

  it('explains a refusal while sessions run in the workspace', async () => {
    const cleanArtifacts = vi.fn(async () => ({
      success: false as const,
      error: { type: 'workspace-active' as const, workspaceId: 'workspace-1' },
    }));
    const service = new WorkspaceMutationService({
      db: {} as never,
      projects: {
        requireAttached: () => ({
          success: true as const,
          data: { workspaceRegistry: { cleanArtifacts } } as never,
        }),
      },
      runtimes: {} as never,
    });

    await expect(
      service.cleanArtifacts({ projectId: 'project-1', workspaceId: 'workspace-1' })
    ).resolves.toEqual({
      success: false,
      error: {
        type: 'workspace-active',
        message: 'Agents or terminals are running in this workspace. Stop them, then try again.',
      },
    });
  });

  it('reports a missing Project when no live Task owns the workspace', async () => {
    const service = new WorkspaceMutationService({
      db: {} as never,
      projects: unavailableProjects,
      runtimes: {} as never,
      projectIdForWorkspace: vi.fn(async () => undefined),
    });

    await expect(service.delete({ workspaceId: 'workspace-1' })).resolves.toEqual({
      success: false,
      error: {
        type: 'project-missing',
        message: 'The Project for this workspace was not found.',
      },
    });
  });

  it('checks the owning Project attachment before deleting', async () => {
    const runtimeClient = vi.fn();
    const service = new WorkspaceMutationService({
      db: {} as never,
      projects: unavailableProjects,
      runtimes: { client: runtimeClient } as never,
      projectIdForWorkspace: vi.fn(async () => 'project-1'),
    });

    await expect(service.delete({ workspaceId: 'workspace-1' })).resolves.toEqual({
      success: false,
      error: {
        type: 'project-unavailable',
        message: 'This action requires live Project access.',
      },
    });
    expect(runtimeClient).not.toHaveBeenCalled();
  });
});
