import type { GitHubApiAuthContext } from '@main/core/github/services/github-api-auth-service';
import type { ProjectSettingsProvider } from '@main/core/projects/settings/provider';
import { err, ok, type Result } from '@shared/result';

export type ProjectGitHubAuthContextError =
  | {
      type: 'project_not_found';
      projectId: string;
      message: string;
    }
  | {
      type: 'no_account_selected';
      projectId: string;
      message: string;
    }
  | {
      type: 'account_selection_failed';
      projectId: string;
      message: string;
    };

type ProjectGitHubAuthContextProject = {
  settings: Pick<ProjectSettingsProvider, 'get'>;
};

type ProjectLookup = {
  getProject(projectId: string): ProjectGitHubAuthContextProject | undefined;
};

type WarningLogger = {
  warn(message: string, context: Record<string, unknown>): void;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ProjectGitHubAuthContextResolver {
  constructor(
    private readonly deps: {
      projects: ProjectLookup;
      logger: WarningLogger;
    }
  ) {}

  async resolve(
    projectId: string
  ): Promise<Result<GitHubApiAuthContext, ProjectGitHubAuthContextError>> {
    const project = this.deps.projects.getProject(projectId);
    if (!project) {
      return err({
        type: 'project_not_found',
        projectId,
        message: `Project ${projectId} is not mounted.`,
      });
    }

    try {
      const settings = await project.settings.get();
      const accountId = Object.hasOwn(settings, 'githubAccountId')
        ? settings.githubAccountId?.trim() || null
        : null;
      if (!accountId) {
        return err({
          type: 'no_account_selected',
          projectId,
          message: 'No GitHub account selected for project.',
        });
      }
      return ok({ accountId });
    } catch (error) {
      const message = errorMessage(error);
      this.deps.logger.warn('Failed to resolve project GitHub account selection', {
        projectId,
        error: message,
      });
      return err({
        type: 'account_selection_failed',
        projectId,
        message,
      });
    }
  }
}
