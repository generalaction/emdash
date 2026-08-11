import { err, ok } from '@emdash/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ProjectGitHubAuthContextResolver,
  type ProjectGitHubAuthContextError,
} from '@core/features/github/api/node/services/project-github-auth-context-resolver';
import type { GitHubAccountSummary } from '@core/primitives/github/api';
import type {
  RepoFacts,
  StoredProjectGitSettings,
} from '@core/primitives/project-settings/api';

type FakeProject = {
  settings: {
    getStoredGitSettings(): Promise<StoredProjectGitSettings>;
    getDefaultWorktreeDirectory(): Promise<string>;
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

class FakeLogger {
  warn = vi.fn();
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
      getDefaultWorktreeDirectory: vi.fn().mockResolvedValue('/worktrees'),
    },
    repoFacts: {
      get: vi.fn().mockResolvedValue(facts),
      dispose: vi.fn(),
    },
  };
}

describe('ProjectGitHubAuthContextResolver', () => {
  let projects: FakeProjectLookup;
  let logger: FakeLogger;
  let accounts: GitHubAccountSummary[];
  let resolver: ProjectGitHubAuthContextResolver;

  beforeEach(() => {
    projects = new FakeProjectLookup();
    logger = new FakeLogger();
    accounts = [];
    resolver = new ProjectGitHubAuthContextResolver({
      projects,
      listAccounts: async () => accounts,
      logger,
    });
  });

  it('resolves a pinned account through the blessed resolver', async () => {
    accounts = [account()];
    projects.setProject(
      'project-1',
      makeProject({ githubAccount: { kind: 'account', accountId: 'github.com:42' } })
    );

    await expect(resolver.resolve('project-1')).resolves.toEqual(
      ok({ accountId: 'github.com:42' })
    );
  });

  it('infers the host-matching account when no account is pinned', async () => {
    accounts = [account()];
    projects.setProject('project-1', makeProject({}));

    await expect(resolver.resolve('project-1')).resolves.toEqual(
      ok({ accountId: 'github.com:42' })
    );
  });

  it('reports unconfigured when inference finds no host-matching account', async () => {
    accounts = [account({ accountId: 'ghe.corp:7', host: 'ghe.corp' })];
    projects.setProject('project-1', makeProject({}));

    await expect(resolver.resolve('project-1')).resolves.toEqual(
      err<ProjectGitHubAuthContextError>({
        type: 'unconfigured',
        projectId: 'project-1',
        message: 'No connected GitHub account matches this project.',
      })
    );
  });

  it('reports disabled for an explicit stored none', async () => {
    accounts = [account()];
    projects.setProject('project-1', makeProject({ githubAccount: { kind: 'none' } }));

    await expect(resolver.resolve('project-1')).resolves.toEqual(
      err<ProjectGitHubAuthContextError>({
        type: 'disabled',
        projectId: 'project-1',
        message: 'GitHub API is disabled for this project.',
      })
    );
  });

  it('fails closed on a dangling account pin instead of another identity', async () => {
    accounts = [account()];
    projects.setProject(
      'project-1',
      makeProject({ githubAccount: { kind: 'account', accountId: 'github.com:999' } })
    );

    await expect(resolver.resolve('project-1')).resolves.toEqual(
      err<ProjectGitHubAuthContextError>({
        type: 'account_selection_failed',
        projectId: 'project-1',
        message:
          'The pinned GitHub account no longer exists or does not match the repository host.',
      })
    );
  });

  it('fails closed on a host-mismatched account pin', async () => {
    accounts = [account({ accountId: 'ghe.corp:7', host: 'ghe.corp' })];
    projects.setProject(
      'project-1',
      makeProject({ githubAccount: { kind: 'account', accountId: 'ghe.corp:7' } })
    );

    await expect(resolver.resolve('project-1')).resolves.toEqual(
      err<ProjectGitHubAuthContextError>({
        type: 'account_selection_failed',
        projectId: 'project-1',
        message:
          'The pinned GitHub account no longer exists or does not match the repository host.',
      })
    );
  });

  it('fails when the project is not mounted instead of silently falling back', async () => {
    await expect(resolver.resolve('project-1')).resolves.toEqual(
      err<ProjectGitHubAuthContextError>({
        type: 'project_not_found',
        projectId: 'project-1',
        message: 'Project project-1 is not mounted.',
      })
    );
  });

  it('fails when account selection cannot be resolved instead of silently falling back', async () => {
    const project = makeProject();
    vi.mocked(project.settings.getStoredGitSettings).mockRejectedValue(
      new Error('settings failed')
    );
    projects.setProject('project-1', project);

    await expect(resolver.resolve('project-1')).resolves.toEqual(
      err<ProjectGitHubAuthContextError>({
        type: 'account_selection_failed',
        projectId: 'project-1',
        message: 'settings failed',
      })
    );
    expect(logger.warn).toHaveBeenCalledWith('Failed to resolve project GitHub account selection', {
      projectId: 'project-1',
      error: 'settings failed',
    });
  });
});
