import { err, ok, type Result } from '@emdash/shared';
import type { GitHubApiAuthContext } from '@core/features/github/api/node/services/github-api-auth-service';
import {
  resolveProjectEffectiveSettings,
  type ProjectEffectiveSettingsSource,
  type RepoFactsSource,
} from '@core/features/projects/api/node/settings/effective-settings';
import type { GitHubAccountSummary } from '@core/primitives/github/api';

export type ProjectGitHubAuthContextError =
  | {
      type: 'project_not_found';
      projectId: string;
      message: string;
    }
  | {
      type: 'unconfigured';
      projectId: string;
      message: string;
    }
  | {
      type: 'disabled';
      projectId: string;
      message: string;
    }
  | {
      type: 'account_selection_failed';
      projectId: string;
      message: string;
    };

type ProjectGitHubAuthContextProject = {
  settings: ProjectEffectiveSettingsSource;
  repoFacts: RepoFactsSource;
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

/**
 * Resolves the GitHub account a project's API calls run as, through the
 * blessed resolver (spec: github-git-settings §2): an explicit pin or the
 * host-matching inference. A dangling or host-mismatched pin fails closed —
 * the flow errors instead of proceeding as a different identity.
 */
export class ProjectGitHubAuthContextResolver {
  constructor(
    private readonly deps: {
      projects: ProjectLookup;
      listAccounts(): Promise<GitHubAccountSummary[]>;
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
      const effective = await resolveProjectEffectiveSettings({
        settings: project.settings,
        repoFacts: project.repoFacts,
        accounts: await this.deps.listAccounts(),
        projectId,
      });
      const account = effective.githubAccount;
      if (account.value !== null) {
        return ok({ accountId: account.value.accountId });
      }
      if (account.provenance.kind === 'set') {
        return err({
          type: 'disabled',
          projectId,
          message: 'GitHub API is disabled for this project.',
        });
      }
      if (account.provenance.kind === 'unresolvable') {
        return err({
          type: 'account_selection_failed',
          projectId,
          message:
            'The pinned GitHub account no longer exists or does not match the repository host.',
        });
      }
      return err({
        type: 'unconfigured',
        projectId,
        message: 'No connected GitHub account matches this project.',
      });
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
