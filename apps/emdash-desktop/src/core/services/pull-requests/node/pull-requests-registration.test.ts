import { ok } from '@emdash/shared/result';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PullRequestsRuntimeClient } from '@core/services/pull-requests/api';
import { PullRequestsRegistration } from './pull-requests-registration';

const mocks = vi.hoisted(() => ({
  projects: new Map<
    string,
    { remoteUrls: string[]; subscribeRemotes: (handler: () => void) => () => void }
  >(),
  resolveAuth: vi.fn(),
}));

vi.mock('@emdash/shared/logger', () => ({
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

function createRegistration(client: ReturnType<typeof createClient>) {
  return new PullRequestsRegistration({
    getClient: async () => client as unknown as PullRequestsRuntimeClient,
    onProjectOpened: vi.fn(() => () => {}),
    onProjectClosed: vi.fn(() => () => {}),
    onProjectSettingsChanged: vi.fn(() => () => {}),
    onTaskProvisioned: vi.fn(() => () => {}),
    subscribeToProjectRemotes: (projectId, handler) => {
      const project = mocks.projects.get(projectId);
      return project?.subscribeRemotes(handler);
    },
    resolveProjectRepositoryUrls: async (projectId) =>
      mocks.projects.get(projectId)?.remoteUrls ?? [],
    resolveProjectAuthContext: mocks.resolveAuth,
  });
}

describe('PullRequestsRegistration', () => {
  beforeEach(() => {
    mocks.projects.clear();
    mocks.resolveAuth.mockResolvedValue(ok({ accountId: 'account-1' }));
  });

  it('only cancels a shared repository after its last project closes', async () => {
    const repositoryUrl = 'https://github.com/acme/shared';
    mocks.projects.set('project-1', { remoteUrls: [repositoryUrl], subscribeRemotes: vi.fn() });
    mocks.projects.set('project-2', { remoteUrls: [repositoryUrl], subscribeRemotes: vi.fn() });
    const client = createClient();
    const registration = createRegistration(client);

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
    const registration = createRegistration(client);

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
    const registration = createRegistration(client);

    await registration.onProjectOpened('project-1');
    await registration.deleteProjectData('project-1');

    expect(client.unregisterRepository).toHaveBeenCalledWith({ repositoryUrl });
  });
});
