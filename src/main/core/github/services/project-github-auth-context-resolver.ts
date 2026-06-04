import type { GitHubAccountSelectionProject } from '@main/core/github/services/github-account-selection-resolver';
import type { GitHubApiAuthContext } from '@main/core/github/services/github-api-auth-service';
import { err, ok, type Result } from '@shared/result';

export type ProjectGitHubAuthContextError =
  | {
      type: 'project_not_found';
      projectId: string;
      message: string;
    }
  | {
      type: 'account_selection_failed';
      projectId: string;
      message: string;
    };

type ProjectLookup = {
  getProject(projectId: string): GitHubAccountSelectionProject | undefined;
};

type AccountSelectionResolver = {
  resolve(project: GitHubAccountSelectionProject): Promise<{ accountId: string | null }>;
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
      accountSelectionResolver: AccountSelectionResolver;
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
      const selection = await this.deps.accountSelectionResolver.resolve(project);
      return ok({ accountId: selection.accountId });
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
