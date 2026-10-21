import { err, ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepositoryRouter } from '../api/node/repository-router';
import { ProviderRepositoryService } from './provider-repository-service';

const router = { route: vi.fn<RepositoryRouter['route']>() };
const mockProjectManager = { requireAttached: vi.fn() };
const loadProject = vi.fn<(projectId: string) => Promise<{ id: string } | undefined>>(async () => ({
  id: 'project-1',
}));

function mockProject(remoteState: { hasRemote: boolean; selectedRemoteUrl?: string | null }) {
  mockProjectManager.requireAttached.mockReturnValue(
    ok({
      getRemoteState: vi.fn().mockResolvedValue(remoteState),
    } as never)
  );
}

describe('ProviderRepositoryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns no_remote when the project is missing', async () => {
    loadProject.mockResolvedValueOnce(undefined);

    await expect(
      new ProviderRepositoryService({
        projects: mockProjectManager,
        loadProject,
        router,
      }).resolveProject('project-1')
    ).resolves.toEqual(err({ type: 'project-missing', projectId: 'project-1' }));
    expect(mockProjectManager.requireAttached).not.toHaveBeenCalled();
  });

  it('preserves the typed effective-attachment error when Host access races', async () => {
    const unavailable = {
      type: 'attachment-unavailable' as const,
      host: { type: 'local' as const },
      phase: 'waiting' as const,
    };
    mockProjectManager.requireAttached.mockReturnValue(err(unavailable));

    await expect(
      new ProviderRepositoryService({
        projects: mockProjectManager,
        loadProject,
        router,
      }).resolveProject('project-1')
    ).resolves.toEqual(err(unavailable));
  });

  it('returns invalid_remote when the project has no selected remote URL', async () => {
    mockProject({ hasRemote: true, selectedRemoteUrl: '' });

    await expect(
      new ProviderRepositoryService({
        projects: mockProjectManager,
        loadProject,
        router,
      }).resolveProject('project-1')
    ).resolves.toEqual(err({ type: 'invalid_remote' }));
  });

  it('derives capabilities from the plugins registered for the routed integration', async () => {
    mockProject({ hasRemote: true, selectedRemoteUrl: 'https://ghe.example.com/acme/repo' });
    router.route.mockResolvedValue(
      ok({
        integrationId: 'github',
        repository: {
          host: 'ghe.example.com',
          owner: 'acme',
          repo: 'repo',
          nameWithOwner: 'acme/repo',
          repositoryUrl: 'https://ghe.example.com/acme/repo',
        },
      })
    );

    await expect(
      new ProviderRepositoryService({
        projects: mockProjectManager,
        loadProject,
        router,
      }).resolveProject('project-1')
    ).resolves.toEqual(
      ok({
        provider: 'github',
        host: 'ghe.example.com',
        repositoryUrl: 'https://ghe.example.com/acme/repo',
        nameWithOwner: 'acme/repo',
        capabilities: { pullRequests: true, issues: true },
      })
    );
    expect(router.route).toHaveBeenCalledWith('https://ghe.example.com/acme/repo');
  });

  it('reports no pull-request support for an integration without a pull-requests plugin', async () => {
    mockProject({ hasRemote: true, selectedRemoteUrl: 'https://gitlab.com/group/sub/proj' });
    router.route.mockResolvedValue(
      ok({
        integrationId: 'gitlab',
        repository: {
          host: 'gitlab.com',
          owner: 'group/sub',
          repo: 'proj',
          nameWithOwner: 'group/sub/proj',
          repositoryUrl: 'https://gitlab.com/group/sub/proj',
        },
      })
    );

    const result = await new ProviderRepositoryService({
      projects: mockProjectManager,
      loadProject,
      router,
    }).resolveProject('project-1');
    expect(result).toMatchObject({
      success: true,
      data: { provider: 'gitlab', capabilities: { pullRequests: false, issues: true } },
    });
  });

  it('surfaces routing failures instead of assuming GitHub', async () => {
    mockProject({ hasRemote: true, selectedRemoteUrl: 'https://git.example.com/acme/repo' });
    router.route.mockResolvedValue(
      err({ type: 'no_integration_for_host', host: 'git.example.com' })
    );

    await expect(
      new ProviderRepositoryService({
        projects: mockProjectManager,
        loadProject,
        router,
      }).resolveProject('project-1')
    ).resolves.toEqual(err({ type: 'no_integration_for_host', host: 'git.example.com' }));
  });
});
