import { ok } from '@emdash/shared/result';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PullRequestsRuntimeClient } from '@main/gateway/desktop-workers';
import { PullRequestsRegistration } from './pull-requests-registration';

const mocks = vi.hoisted(() => ({
  projects: new Map<string, { remoteUrls: string[]; subscribeRemotes: () => () => void }>(),
  resolve: vi.fn(),
  resolveAuth: vi.fn(),
}));

vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: {
    getProject: (projectId: string) => {
      const project = mocks.projects.get(projectId);
      if (!project) return undefined;
      return {
        repository: { path: `/tmp/${projectId}` },
        git: {
          repository: {
            model: {
              state: () => ({
                snapshot: async () => ({
                  data: {
                    remotes: project.remoteUrls.map((url, index) => ({
                      name: `remote-${index}`,
                      url,
                    })),
                  },
                }),
              }),
            },
          },
        },
        gitRepository: {
          subscribeRemotes: project.subscribeRemotes,
        },
      };
    },
    on: vi.fn(() => () => {}),
  },
}));

vi.mock('@main/core/github/services/github-repository-resolver', () => ({
  githubRepositoryResolver: { resolve: mocks.resolve },
}));

vi.mock('@main/core/github/services/project-github-auth-context', () => ({
  resolveProjectGitHubAuthContext: mocks.resolveAuth,
}));

vi.mock('@main/core/projects/settings/project-settings-service', () => ({
  projectSettingsService: { on: vi.fn(() => () => {}) },
}));

vi.mock('@main/core/tasks/task-session-manager', () => ({
  taskSessionManager: { hooks: { on: vi.fn(() => () => {}) } },
}));

vi.mock('@main/gateway/desktop-workers', () => ({
  getPullRequestsRuntimeClient: vi.fn(),
}));

vi.mock('@main/lib/logger', () => ({
  log: { warn: vi.fn() },
}));

function createClient() {
  return {
    registerRepository: vi.fn(async () => ok()),
    unregisterRepository: vi.fn(async () => ok()),
    cancelSync: vi.fn(async () => ok()),
    getPullRequestsForBranch: vi.fn(async () =>
      ok({ prs: [] as Array<{ identifier: string | null }> })
    ),
    syncSingle: vi.fn(async () => ok({ pr: {} })),
  };
}

describe('PullRequestsRegistration', () => {
  beforeEach(() => {
    mocks.projects.clear();
    mocks.resolve.mockImplementation(async (remoteUrl: string) =>
      ok({
        host: 'github.com',
        owner: 'acme',
        name: remoteUrl.split('/').at(-1) ?? 'repo',
        repositoryUrl: remoteUrl,
      })
    );
    mocks.resolveAuth.mockResolvedValue(ok({ accountId: 'account-1' }));
  });

  it('only cancels a shared repository after its last project closes', async () => {
    const repositoryUrl = 'https://github.com/acme/shared';
    mocks.projects.set('project-1', { remoteUrls: [repositoryUrl], subscribeRemotes: vi.fn() });
    mocks.projects.set('project-2', { remoteUrls: [repositoryUrl], subscribeRemotes: vi.fn() });
    const client = createClient();
    const registration = new PullRequestsRegistration({
      getClient: async () => client as unknown as PullRequestsRuntimeClient,
    });

    await registration.onProjectOpened('project-1');
    await registration.onProjectOpened('project-2');
    await registration.onProjectClosed('project-1');
    expect(client.cancelSync).not.toHaveBeenCalled();

    await registration.onProjectClosed('project-2');
    expect(client.cancelSync).toHaveBeenCalledWith({ repositoryUrl });
  });

  it('refreshes matching branch pull requests after task provisioning', async () => {
    const repositoryUrl = 'https://github.com/acme/repo';
    mocks.projects.set('project-1', { remoteUrls: [repositoryUrl], subscribeRemotes: vi.fn() });
    const client = createClient();
    client.getPullRequestsForBranch.mockResolvedValue(ok({ prs: [{ identifier: '#42' }] }));
    const registration = new PullRequestsRegistration({
      getClient: async () => client as unknown as PullRequestsRuntimeClient,
    });

    await registration.onProjectOpened('project-1');
    await registration.onTaskProvisioned('project-1', 'feature-branch');

    expect(client.getPullRequestsForBranch).toHaveBeenCalledWith({
      repositoryUrl,
      branch: 'feature-branch',
    });
    expect(client.syncSingle).toHaveBeenCalledWith({ repositoryUrl, number: 42 });
  });

  it('unregisters repositories when their project is deleted', async () => {
    const repositoryUrl = 'https://github.com/acme/deleted';
    mocks.projects.set('project-1', { remoteUrls: [repositoryUrl], subscribeRemotes: vi.fn() });
    const client = createClient();
    const registration = new PullRequestsRegistration({
      getClient: async () => client as unknown as PullRequestsRuntimeClient,
    });

    await registration.onProjectOpened('project-1');
    await registration.deleteProjectData('project-1');

    expect(client.unregisterRepository).toHaveBeenCalledWith({ repositoryUrl });
  });
});
