import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createProjectIntegrationAccountResolver,
  type ProjectIntegrationAccountResolver,
} from '@core/features/integrations/api/node/project-integration-account-resolver';
import type { RepoFacts, StoredBaseProjectSettings } from '@core/primitives/project-settings/api';
import type { Project } from '@core/primitives/projects/api';
import type { ProviderAccountSummary } from '@core/primitives/provider-accounts/api';

type FakeProject = {
  record: Project;
  stored: StoredBaseProjectSettings;
  facts: RepoFacts | null;
};

class FakeProjectLookup {
  private readonly projects = new Map<string, FakeProject>();
  readonly getProjectById = vi.fn(
    async (projectId: string) => this.projects.get(projectId)?.record
  );
  readonly getStoredGitSettings = vi.fn(
    async (projectId: string) => this.projects.get(projectId)?.stored ?? {}
  );
  readonly getStoredIntegrationAccounts = vi.fn(
    async (projectId: string) => this.projects.get(projectId)?.stored.integrationAccounts ?? {}
  );
  readonly getRepoFacts = vi.fn(
    async (project: Project) => this.projects.get(project.id)?.facts ?? null
  );

  setProject(projectId: string, project: FakeProject): void {
    this.projects.set(projectId, project);
  }
}

const GITHUB_FACTS: RepoFacts = {
  remotes: [{ name: 'origin', host: 'github.com', headBranch: 'main', branches: ['main'] }],
  localBranches: ['main'],
};

function account(overrides: Partial<ProviderAccountSummary> = {}): ProviderAccountSummary {
  return {
    providerId: 'github',
    displayName: '@octocat',
    accountId: 'github.com:42',
    host: 'github.com',
    login: 'octocat',
    avatarUrl: '',
    credentialSource: 'secure_storage',
    isDefault: false,
    ...overrides,
  };
}

function makeProject(
  stored: StoredBaseProjectSettings = {},
  facts: RepoFacts | null = GITHUB_FACTS
): FakeProject {
  return {
    record: {
      type: 'local',
      id: 'project-1',
      name: 'Project',
      path: '/repo',
      baseRef: 'main',
      repositoryWorkspaceId: 'repository-1',
      createdAt: '2026-08-13T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z',
    },
    stored,
    facts,
  };
}

describe('createProjectIntegrationAccountResolver', () => {
  let projects: FakeProjectLookup;
  let accounts: ProviderAccountSummary[];
  let resolve: ProjectIntegrationAccountResolver;

  beforeEach(() => {
    projects = new FakeProjectLookup();
    accounts = [];
    resolve = createProjectIntegrationAccountResolver({
      getStoredIntegrationAccounts: projects.getStoredIntegrationAccounts,
      getProjectRepositoryContext: async (projectId) => {
        const project = await projects.getProjectById(projectId);
        if (!project) throw new Error(`Project ${projectId} does not exist.`);
        return {
          storedGitSettings: await projects.getStoredGitSettings(projectId),
          repoFacts: await projects.getRepoFacts(project),
        };
      },
      listAccounts: async () => accounts,
    });
  });

  it('resolves a pinned account with set provenance', async () => {
    accounts = [account()];
    projects.setProject(
      'project-1',
      makeProject({
        integrationAccounts: { github: { kind: 'account', accountId: 'github.com:42' } },
      })
    );

    await expect(resolve('project-1', 'github', { kind: 'project' })).resolves.toMatchObject({
      value: accounts[0],
      provenance: { kind: 'set' },
    });
  });

  it('resolves a durable account pin while repository facts are unavailable', async () => {
    accounts = [account()];
    projects.setProject(
      'project-1',
      makeProject(
        { integrationAccounts: { github: { kind: 'account', accountId: 'github.com:42' } } },
        null
      )
    );

    await expect(resolve('project-1', 'github', { kind: 'project' })).resolves.toMatchObject({
      value: accounts[0],
      provenance: { kind: 'set' },
    });
  });

  it('infers the host-matching account when no account is pinned', async () => {
    accounts = [account()];
    projects.setProject('project-1', makeProject({}));

    await expect(resolve('project-1', 'github', { kind: 'project' })).resolves.toMatchObject({
      value: accounts[0],
      provenance: { kind: 'inferred', from: 'only host-matching account' },
    });
  });

  it('resolves null with inferred provenance when inference finds nothing', async () => {
    accounts = [account({ accountId: 'ghe.corp:7', host: 'ghe.corp' })];
    projects.setProject('project-1', makeProject({}));

    await expect(resolve('project-1', 'github', { kind: 'project' })).resolves.toMatchObject({
      value: null,
      provenance: { kind: 'inferred', from: 'no host-matching account' },
    });
  });

  it('resolves null with set provenance for an explicit stored none', async () => {
    accounts = [account()];
    projects.setProject(
      'project-1',
      makeProject({ integrationAccounts: { github: { kind: 'none' } } })
    );

    await expect(resolve('project-1', 'github', { kind: 'project' })).resolves.toMatchObject({
      value: null,
      provenance: { kind: 'set' },
    });
  });

  it('fails closed with unresolvable provenance on a dangling account pin', async () => {
    accounts = [account()];
    projects.setProject(
      'project-1',
      makeProject({
        integrationAccounts: { github: { kind: 'account', accountId: 'github.com:999' } },
      })
    );

    await expect(resolve('project-1', 'github', { kind: 'project' })).resolves.toMatchObject({
      value: null,
      provenance: { kind: 'unresolvable' },
    });
  });

  it('fails closed with unresolvable provenance on a host-mismatched pin', async () => {
    accounts = [account({ accountId: 'ghe.corp:7', host: 'ghe.corp' })];
    projects.setProject(
      'project-1',
      makeProject({ integrationAccounts: { github: { kind: 'account', accountId: 'ghe.corp:7' } } })
    );

    await expect(resolve('project-1', 'github', { kind: 'project' })).resolves.toMatchObject({
      value: null,
      provenance: { kind: 'unresolvable' },
    });
  });

  it('throws a plain invariant error for a missing durable Project', async () => {
    await expect(resolve('project-1', 'github', { kind: 'project' })).rejects.toThrow(
      'Project project-1 does not exist.'
    );
  });

  it('propagates resolution failures instead of re-encoding them', async () => {
    projects.setProject('project-1', makeProject());
    projects.getStoredGitSettings.mockRejectedValueOnce(new Error('settings failed'));

    await expect(resolve('project-1', 'github', { kind: 'project' })).rejects.toThrow(
      'settings failed'
    );
  });

  it('resolves project and explicit resource contexts independently', async () => {
    const enterprise = account({ accountId: 'ghe.corp:7', host: 'ghe.corp' });
    accounts = [account({ isDefault: true }), enterprise];
    projects.setProject(
      'project-1',
      makeProject(
        { baseRemote: 'upstream' },
        {
          remotes: [
            ...GITHUB_FACTS.remotes,
            { name: 'upstream', host: 'ghe.corp', headBranch: 'main', branches: ['main'] },
          ],
          localBranches: [],
        }
      )
    );
    const project = await resolve('project-1', 'github', { kind: 'project' });
    expect(project.value).toEqual(enterprise);
    projects.getRepoFacts.mockClear();
    const resource = await resolve('project-1', 'github', {
      kind: 'url',
      url: 'git@github.com:team/repo.git',
    });
    expect(resource.value).toEqual(accounts[0]);
    expect(projects.getRepoFacts).not.toHaveBeenCalled();
    expect(resource.accounts).toEqual(accounts);
    expect(resource.contextKey).toBe(project.contextKey);
  });

  it('resolves a non-repository provider without reading Git settings or repository facts', async () => {
    accounts = [account({ providerId: 'linear', accountId: 'linear-1', isDefault: true })];
    projects.setProject(
      'project-1',
      makeProject({ integrationAccounts: { github: { kind: 'none' } } })
    );
    const resolution = await resolve('project-1', 'linear');
    expect(resolution.value).toEqual(accounts[0]);
    expect(projects.getStoredGitSettings).not.toHaveBeenCalled();
    expect(projects.getRepoFacts).not.toHaveBeenCalled();
  });

  it('includes changed stored choices and inventory in the account context key', async () => {
    accounts = [account({ isDefault: true })];
    projects.setProject('project-1', makeProject());
    const inferred = await resolve('project-1', 'github', { kind: 'project' });
    projects.setProject(
      'project-1',
      makeProject({ integrationAccounts: { github: { kind: 'none' } } })
    );
    const disabled = await resolve('project-1', 'github', { kind: 'project' });
    expect(disabled.contextKey).not.toBe(inferred.contextKey);
    accounts = [];
    const removed = await resolve('project-1', 'github', { kind: 'project' });
    expect(removed.contextKey).not.toBe(disabled.contextKey);
    expect(removed.accounts).toEqual([]);
  });
});
