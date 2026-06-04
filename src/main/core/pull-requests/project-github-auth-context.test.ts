import { beforeEach, describe, expect, it, vi } from 'vitest';
import { githubAccountSelectionResolver } from '@main/core/github/services/github-account-selection-resolver';
import { projectManager } from '@main/core/projects/project-manager';
import { log } from '@main/lib/logger';
import { resolveProjectGitHubAuthContext } from './project-github-auth-context';

vi.mock('@main/core/github/services/github-account-selection-resolver', () => ({
  githubAccountSelectionResolver: {
    resolve: vi.fn(),
  },
}));

vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: {
    getProject: vi.fn(),
  },
}));

vi.mock('@main/lib/logger', () => ({
  log: {
    warn: vi.fn(),
  },
}));

const mockProjectManager = vi.mocked(projectManager);
const mockGithubAccountSelectionResolver = vi.mocked(githubAccountSelectionResolver);

describe('resolveProjectGitHubAuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves account selection for a mounted project', async () => {
    const project = { settings: {}, ctx: {} } as never;
    mockProjectManager.getProject.mockReturnValue(project);
    mockGithubAccountSelectionResolver.resolve.mockResolvedValue({
      accountId: 'github.com:42',
      source: 'project-settings',
    });

    await expect(resolveProjectGitHubAuthContext('project-1')).resolves.toEqual({
      accountId: 'github.com:42',
    });
    expect(mockGithubAccountSelectionResolver.resolve).toHaveBeenCalledWith(project);
  });

  it('returns empty context when the project is not mounted', async () => {
    mockProjectManager.getProject.mockReturnValue(undefined);

    await expect(resolveProjectGitHubAuthContext('project-1')).resolves.toEqual({});
    expect(mockGithubAccountSelectionResolver.resolve).not.toHaveBeenCalled();
  });

  it('returns empty context when account selection resolution fails', async () => {
    const project = { settings: {}, ctx: {} } as never;
    mockProjectManager.getProject.mockReturnValue(project);
    mockGithubAccountSelectionResolver.resolve.mockRejectedValue(new Error('git config failed'));

    await expect(resolveProjectGitHubAuthContext('project-1')).resolves.toEqual({});
    expect(log.warn).toHaveBeenCalledWith('Failed to resolve project GitHub account selection', {
      projectId: 'project-1',
      error: 'git config failed',
    });
  });
});
