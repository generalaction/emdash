import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectSettings } from '@shared/project-settings';
import { err, ok } from '@shared/result';
import {
  ProjectGitHubAuthContextResolver,
  type ProjectGitHubAuthContextError,
} from './project-github-auth-context-resolver';

type FakeProject = {
  settings: { get(): Promise<ProjectSettings> };
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

function makeProject(settings: ProjectSettings = {}): FakeProject {
  return {
    settings: { get: vi.fn().mockResolvedValue(settings) },
  };
}

describe('ProjectGitHubAuthContextResolver', () => {
  let projects: FakeProjectLookup;
  let logger: FakeLogger;
  let resolver: ProjectGitHubAuthContextResolver;

  beforeEach(() => {
    projects = new FakeProjectLookup();
    logger = new FakeLogger();
    resolver = new ProjectGitHubAuthContextResolver({
      projects,
      logger,
    });
  });

  it('resolves the selected account from project settings for a mounted project', async () => {
    const project = makeProject({ githubAccountId: ' github.com:42 ' });
    projects.setProject('project-1', project);

    await expect(resolver.resolve('project-1')).resolves.toEqual(
      ok({ accountId: 'github.com:42' })
    );
    expect(project.settings.get).toHaveBeenCalled();
  });

  it('fails when the project settings have no selected GitHub account', async () => {
    projects.setProject('project-1', makeProject({}));

    await expect(resolver.resolve('project-1')).resolves.toEqual(
      err<ProjectGitHubAuthContextError>({
        type: 'no_account_selected',
        projectId: 'project-1',
        message: 'No GitHub account selected for project.',
      })
    );
  });

  it('fails when the project settings explicitly clear the selected GitHub account', async () => {
    projects.setProject('project-1', makeProject({ githubAccountId: null }));

    await expect(resolver.resolve('project-1')).resolves.toEqual(
      err<ProjectGitHubAuthContextError>({
        type: 'no_account_selected',
        projectId: 'project-1',
        message: 'No GitHub account selected for project.',
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
    vi.mocked(project.settings.get).mockRejectedValue(new Error('settings failed'));
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
