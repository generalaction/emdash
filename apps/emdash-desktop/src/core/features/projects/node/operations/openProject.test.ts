import { err, ok } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectProvider } from '@core/features/projects/api/node/project-provider';
import type { Project } from '@core/primitives/projects/api';
import { openProject } from './openProject';

describe('openProject attachment compatibility', () => {
  it('delegates one attempt to the attachment manager and returns the canonical repository row', async () => {
    const project = localProject();
    const provider = { project } as ProjectProvider;
    const open = vi.fn(async () => ok(provider));

    await expect(openProject({ openProject: open }, project.id)).resolves.toEqual(
      ok({ repositoryWorkspaceId: 'repository-1' })
    );

    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith(project.id);
  });

  it.each([
    [
      { type: 'repository-missing' as const, path: '/repo' },
      { type: 'path-not-found', path: '/repo' },
    ],
    [
      {
        type: 'repository-unavailable' as const,
        path: '/repo',
        message: 'Repository cannot be inspected',
      },
      { type: 'error', message: 'Repository cannot be inspected' },
    ],
    [
      { type: 'project-missing' as const, projectId: 'project-1' },
      { type: 'error', message: 'Project not found: project-1' },
    ],
  ])('preserves the legacy Wire outcome for %s', async (failure, expected) => {
    const open = vi.fn(async () => err(failure));

    await expect(openProject({ openProject: open }, 'project-1')).resolves.toEqual(err(expected));
    expect(open).toHaveBeenCalledOnce();
  });
});

function localProject(): Project {
  return {
    type: 'local',
    id: 'project-1',
    name: 'Project',
    path: '/repo',
    baseRef: 'main',
    repositoryWorkspaceId: 'repository-1',
    createdAt: '2026-08-13T00:00:00.000Z',
    updatedAt: '2026-08-13T00:00:00.000Z',
  };
}
