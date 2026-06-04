import { beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '@shared/result';
import {
  ProjectGitHubAuthContextResolver,
  type ProjectGitHubAuthContextError,
} from './project-github-auth-context-resolver';

type FakeProject = {
  settings: { get(): Promise<Record<string, unknown>> };
  ctx: { exec(): Promise<{ stdout: string; stderr: string }> };
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

class FakeAccountSelectionResolver {
  resolve = vi.fn();
}

class FakeLogger {
  warn = vi.fn();
}

function makeProject(): FakeProject {
  return {
    settings: { get: async () => ({}) },
    ctx: { exec: async () => ({ stdout: '', stderr: '' }) },
  };
}

describe('ProjectGitHubAuthContextResolver', () => {
  let projects: FakeProjectLookup;
  let accountSelectionResolver: FakeAccountSelectionResolver;
  let logger: FakeLogger;
  let resolver: ProjectGitHubAuthContextResolver;

  beforeEach(() => {
    projects = new FakeProjectLookup();
    accountSelectionResolver = new FakeAccountSelectionResolver();
    logger = new FakeLogger();
    resolver = new ProjectGitHubAuthContextResolver({
      projects,
      accountSelectionResolver,
      logger,
    });
  });

  it('resolves account selection for a mounted project', async () => {
    const project = makeProject();
    projects.setProject('project-1', project);
    accountSelectionResolver.resolve.mockResolvedValue({
      accountId: 'github.com:42',
      source: 'project-settings',
    });

    await expect(resolver.resolve('project-1')).resolves.toEqual(
      ok({ accountId: 'github.com:42' })
    );
    expect(accountSelectionResolver.resolve).toHaveBeenCalledWith(project);
  });

  it('keeps explicit default-account selections distinct from resolution failure', async () => {
    projects.setProject('project-1', makeProject());
    accountSelectionResolver.resolve.mockResolvedValue({
      accountId: null,
      source: 'project-settings',
    });

    await expect(resolver.resolve('project-1')).resolves.toEqual(ok({ accountId: null }));
  });

  it('fails when the project is not mounted instead of silently falling back', async () => {
    await expect(resolver.resolve('project-1')).resolves.toEqual(
      err<ProjectGitHubAuthContextError>({
        type: 'project_not_found',
        projectId: 'project-1',
        message: 'Project project-1 is not mounted.',
      })
    );
    expect(accountSelectionResolver.resolve).not.toHaveBeenCalled();
  });

  it('fails when account selection cannot be resolved instead of silently falling back', async () => {
    projects.setProject('project-1', makeProject());
    accountSelectionResolver.resolve.mockRejectedValue(new Error('git config failed'));

    await expect(resolver.resolve('project-1')).resolves.toEqual(
      err<ProjectGitHubAuthContextError>({
        type: 'account_selection_failed',
        projectId: 'project-1',
        message: 'git config failed',
      })
    );
    expect(logger.warn).toHaveBeenCalledWith('Failed to resolve project GitHub account selection', {
      projectId: 'project-1',
      error: 'git config failed',
    });
  });
});
