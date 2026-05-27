import { beforeEach, describe, expect, it, vi } from 'vitest';
import { githubRepositoryResolver } from '@main/core/github/services/github-repository-resolver';
import { projectManager } from '@main/core/projects/project-manager';
import { err, ok } from '@shared/result';
import { ProviderRepositoryService } from './provider-repository-service';

vi.mock('@main/core/github/services/github-repository-resolver', () => ({
  githubRepositoryResolver: {
    resolve: vi.fn(),
  },
}));

vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: {
    getProject: vi.fn(),
  },
}));

const mockRepositoryResolver = vi.mocked(githubRepositoryResolver);
const mockProjectManager = vi.mocked(projectManager);

function mockProject(remoteState: { hasRemote: boolean; selectedRemoteUrl?: string | null }) {
  mockProjectManager.getProject.mockReturnValue({
    getRemoteState: vi.fn().mockResolvedValue(remoteState),
  } as never);
}

describe('ProviderRepositoryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns no_remote when the project is missing', async () => {
    mockProjectManager.getProject.mockReturnValue(undefined);

    await expect(new ProviderRepositoryService().resolveProject('project-1')).resolves.toEqual(
      err({ type: 'no_remote' })
    );
  });

  it('returns invalid_remote when the project has no selected remote URL', async () => {
    mockProject({ hasRemote: true, selectedRemoteUrl: '' });

    await expect(new ProviderRepositoryService().resolveProject('project-1')).resolves.toEqual(
      err({ type: 'invalid_remote' })
    );
  });

  it('returns GitHub provider capabilities for GHES repositories', async () => {
    mockProject({ hasRemote: true, selectedRemoteUrl: 'https://ghe.example.com/acme/repo' });
    mockRepositoryResolver.resolve.mockResolvedValue(
      ok({
        host: 'ghe.example.com',
        owner: 'acme',
        repo: 'repo',
        nameWithOwner: 'acme/repo',
        repositoryUrl: 'https://ghe.example.com/acme/repo',
      })
    );

    await expect(new ProviderRepositoryService().resolveProject('project-1')).resolves.toEqual(
      ok({
        provider: 'github',
        host: 'ghe.example.com',
        repositoryUrl: 'https://ghe.example.com/acme/repo',
        nameWithOwner: 'acme/repo',
        capabilities: {
          pullRequests: true,
          issues: true,
        },
      })
    );
  });

  it('maps unsupported providers from GitHub resolution', async () => {
    mockProject({ hasRemote: true, selectedRemoteUrl: 'https://gitlab.example.com/acme/repo' });
    mockRepositoryResolver.resolve.mockResolvedValue(
      err({ type: 'not_github', host: 'gitlab.example.com', reason: 'not GitHub' })
    );

    await expect(new ProviderRepositoryService().resolveProject('project-1')).resolves.toEqual(
      err({ type: 'unsupported_provider', host: 'gitlab.example.com', reason: 'not GitHub' })
    );
  });
});
