import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createProjectGitHubAccountResolver,
  type ProjectGitHubAccountResolver,
} from '@core/features/github/api/node/services/project-github-account-resolver';
import type { GitHubAccountSummary } from '@core/primitives/github/api';
import type {
  PlacementContext,
  RepoFacts,
  StoredProjectGitSettings,
} from '@core/primitives/project-settings/api';

type FakeProject = {
  settings: {
    getStoredGitSettings(): Promise<StoredProjectGitSettings>;
    getPlacementContext(): Promise<PlacementContext>;
  };
  repoFacts: {
    get(): Promise<RepoFacts | null>;
    dispose(): Promise<void>;
  };
};

class FakeProjectLookup {
  private readonly projects = new Map<string, FakeProject>();

  setProject(projectId: string, project: FakeProject): void {
    this.projects.set(projectId, project);
  }

  getProject(projectId: string): FakeProject | undefined {
    return this.projects.get(projectId);
  }
}

const GITHUB_FACTS: RepoFacts = {
  remotes: [{ name: 'origin', host: 'github.com', headBranch: 'main', branches: ['main'] }],
  localBranches: ['main'],
};

function account(overrides: Partial<GitHubAccountSummary> = {}): GitHubAccountSummary {
  return {
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
  stored: StoredProjectGitSettings = {},
  facts: RepoFacts | null = GITHUB_FACTS
): FakeProject {
  return {
    settings: {
      getStoredGitSettings: vi.fn().mockResolvedValue(stored),
      getPlacementContext: vi.fn().mockResolvedValue({
        hostWorktreeRoot: null,
        builtInWorktreeRoot: '/home/me/emdash/worktrees',
        homeDirectory: '/home/me',
        hostTmux: null,
        appDefaultTmux: false,
      }),
    },
    repoFacts: {
      get: vi.fn().mockResolvedValue(facts),
      dispose: vi.fn(),
    },
  };
}

describe('createProjectGitHubAccountResolver', () => {
  let projects: FakeProjectLookup;
  let accounts: GitHubAccountSummary[];
  let resolve: ProjectGitHubAccountResolver;

  beforeEach(() => {
    projects = new FakeProjectLookup();
    accounts = [];
    resolve = createProjectGitHubAccountResolver({
      projects,
      listAccounts: async () => accounts,
    });
  });

  it('resolves a pinned account with set provenance', async () => {
    accounts = [account()];
    projects.setProject(
      'project-1',
      makeProject({ githubAccount: { kind: 'account', accountId: 'github.com:42' } })
    );

    await expect(resolve('project-1')).resolves.toEqual({
      value: accounts[0],
      provenance: { kind: 'set' },
    });
  });

  it('infers the host-matching account when no account is pinned', async () => {
    accounts = [account()];
    projects.setProject('project-1', makeProject({}));

    await expect(resolve('project-1')).resolves.toEqual({
      value: accounts[0],
      provenance: { kind: 'inferred', from: 'only host-matching account' },
    });
  });

  it('resolves null with inferred provenance when inference finds nothing', async () => {
    accounts = [account({ accountId: 'ghe.corp:7', host: 'ghe.corp' })];
    projects.setProject('project-1', makeProject({}));

    await expect(resolve('project-1')).resolves.toEqual({
      value: null,
      provenance: { kind: 'inferred', from: 'no host-matching account' },
    });
  });

  it('resolves null with set provenance for an explicit stored none', async () => {
    accounts = [account()];
    projects.setProject('project-1', makeProject({ githubAccount: { kind: 'none' } }));

    await expect(resolve('project-1')).resolves.toEqual({
      value: null,
      provenance: { kind: 'set' },
    });
  });

  it('fails closed with unresolvable provenance on a dangling account pin', async () => {
    accounts = [account()];
    projects.setProject(
      'project-1',
      makeProject({ githubAccount: { kind: 'account', accountId: 'github.com:999' } })
    );

    await expect(resolve('project-1')).resolves.toEqual({
      value: null,
      provenance: { kind: 'unresolvable' },
    });
  });

  it('fails closed with unresolvable provenance on a host-mismatched pin', async () => {
    accounts = [account({ accountId: 'ghe.corp:7', host: 'ghe.corp' })];
    projects.setProject(
      'project-1',
      makeProject({ githubAccount: { kind: 'account', accountId: 'ghe.corp:7' } })
    );

    await expect(resolve('project-1')).resolves.toEqual({
      value: null,
      provenance: { kind: 'unresolvable' },
    });
  });

  it('throws a plain invariant error for an unmounted project', async () => {
    await expect(resolve('project-1')).rejects.toThrow('Project project-1 is not mounted.');
  });

  it('propagates resolution failures instead of re-encoding them', async () => {
    const project = makeProject();
    vi.mocked(project.settings.getStoredGitSettings).mockRejectedValue(
      new Error('settings failed')
    );
    projects.setProject('project-1', project);

    await expect(resolve('project-1')).rejects.toThrow('settings failed');
  });
});
