import type { Disposable } from '@emdash/shared/concurrency';
import { githubRepositoryResolver } from '@main/core/github/services/github-repository-resolver';
import { resolveProjectGitHubAuthContext } from '@main/core/github/services/project-github-auth-context';
import { projectManager } from '@main/core/projects/project-manager';
import { projectSettingsService } from '@main/core/projects/settings/project-settings-service';
import { taskSessionManager } from '@main/core/tasks/task-session-manager';
import { log } from '@main/lib/logger';
import type { PullRequestsRuntimeClient } from './desktop-workers';
import { getPullRequestsRuntimeClient } from './desktop-workers';

type PullRequestsRegistrationClient = Pick<
  PullRequestsRuntimeClient,
  | 'registerRepository'
  | 'unregisterRepository'
  | 'cancelSync'
  | 'getPullRequestsForBranch'
  | 'syncSingle'
>;

type PullRequestsRegistrationOptions = {
  getClient: () => Promise<PullRequestsRegistrationClient>;
};

export class PullRequestsRegistration implements Disposable {
  private readonly projectRepositoryUrls = new Map<string, string[]>();
  private readonly repositoryUnsubscribes = new Map<string, () => void>();
  private unsubscribes: Array<() => void> = [];

  constructor(
    private readonly options: PullRequestsRegistrationOptions = {
      getClient: getPullRequestsRuntimeClient,
    }
  ) {}

  initialize(): void {
    if (this.unsubscribes.length > 0) return;
    this.unsubscribes = [
      projectManager.on('projectOpened', (projectId) => this.onProjectOpened(projectId)),
      projectManager.on('projectClosed', (projectId) => this.onProjectClosed(projectId)),
      taskSessionManager.hooks.on('task:provisioned', ({ projectId, branchName }) => {
        void this.onTaskProvisioned(projectId, branchName).catch((error) => {
          log.warn('PullRequestsRegistration: failed to refresh a provisioned task', {
            projectId,
            error: String(error),
          });
        });
      }),
      projectSettingsService.on('project-settings:changed', ({ projectId }) => {
        void this.refreshProject(projectId).catch((error) => {
          log.warn('PullRequestsRegistration: failed to refresh project settings', {
            projectId,
            error: String(error),
          });
        });
      }),
    ];
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    this.unsubscribes = [];
    for (const unsubscribe of this.repositoryUnsubscribes.values()) unsubscribe();
    this.repositoryUnsubscribes.clear();
    this.projectRepositoryUrls.clear();
  }

  async onProjectOpened(projectId: string): Promise<void> {
    await this.refreshProject(projectId);
    this.subscribeToRepository(projectId);
  }

  async onProjectClosed(projectId: string): Promise<void> {
    this.repositoryUnsubscribes.get(projectId)?.();
    this.repositoryUnsubscribes.delete(projectId);
    const removedUrls = this.projectRepositoryUrls.get(projectId) ?? [];
    this.projectRepositoryUrls.delete(projectId);
    await this.cancelUnreferenced(removedUrls);
  }

  async refreshProject(projectId: string): Promise<void> {
    const previousUrls = this.projectRepositoryUrls.get(projectId) ?? [];
    const repositoryUrls = await this.resolveRepositoryUrls(projectId);
    this.projectRepositoryUrls.set(projectId, repositoryUrls);

    const authContext = await resolveProjectGitHubAuthContext(projectId);
    const accountId = authContext.success ? authContext.data.accountId : undefined;
    if (!authContext.success) {
      log.warn('PullRequestsRegistration: failed to resolve project GitHub account', {
        projectId,
        error: authContext.error.message,
      });
    }

    const client = await this.options.getClient();
    for (const repositoryUrl of repositoryUrls) {
      const result = await client.registerRepository({ repositoryUrl, accountId });
      if (!result.success) {
        log.warn('PullRequestsRegistration: failed to register repository', {
          projectId,
          repositoryUrl,
          error: result.error,
        });
      }
    }

    const current = new Set(repositoryUrls);
    await this.cancelUnreferenced(previousUrls.filter((url) => !current.has(url)));
  }

  async onTaskProvisioned(projectId: string, branchName: string | undefined): Promise<void> {
    if (!branchName) return;
    const repositoryUrls =
      this.projectRepositoryUrls.get(projectId) ?? (await this.resolveRepositoryUrls(projectId));
    const client = await this.options.getClient();
    for (const repositoryUrl of repositoryUrls) {
      const result = await client.getPullRequestsForBranch({ repositoryUrl, branch: branchName });
      if (!result.success) continue;
      for (const pullRequest of result.data.prs) {
        const number = pullRequest.identifier
          ? Number.parseInt(pullRequest.identifier.replace('#', ''), 10)
          : Number.NaN;
        if (Number.isNaN(number)) continue;
        await client.syncSingle({ repositoryUrl, number });
      }
    }
  }

  async deleteProjectData(projectId: string): Promise<void> {
    const repositoryUrls =
      this.projectRepositoryUrls.get(projectId) ?? (await this.resolveRepositoryUrls(projectId));
    this.projectRepositoryUrls.delete(projectId);
    const client = await this.options.getClient();
    for (const repositoryUrl of repositoryUrls) {
      if (this.isReferenced(repositoryUrl)) continue;
      const result = await client.unregisterRepository({ repositoryUrl });
      if (!result.success) {
        log.warn('PullRequestsRegistration: failed to unregister deleted project repository', {
          projectId,
          repositoryUrl,
          error: result.error,
        });
      }
    }
  }

  private subscribeToRepository(projectId: string): void {
    if (this.repositoryUnsubscribes.has(projectId)) return;
    const project = projectManager.getProject(projectId);
    if (!project) return;
    this.repositoryUnsubscribes.set(
      projectId,
      project.gitRepository.subscribeRemotes(() => {
        void this.refreshProject(projectId).catch((error) => {
          log.warn('PullRequestsRegistration: failed to refresh changed remotes', {
            projectId,
            error: String(error),
          });
        });
      })
    );
  }

  private async resolveRepositoryUrls(projectId: string): Promise<string[]> {
    const project = projectManager.getProject(projectId);
    if (!project) return [];
    try {
      const remotes = (
        await project.git.repository.model.state(project.repository, 'remotes').snapshot()
      ).data.remotes;
      const resolved = await Promise.all(
        remotes.map(async (remote) => await githubRepositoryResolver.resolve(remote.url))
      );
      return [
        ...new Set(
          resolved.flatMap((repository) =>
            repository.success ? [repository.data.repositoryUrl] : []
          )
        ),
      ];
    } catch (error) {
      log.warn('PullRequestsRegistration: failed to resolve project remotes', {
        projectId,
        error: String(error),
      });
      return [];
    }
  }

  private async cancelUnreferenced(repositoryUrls: string[]): Promise<void> {
    if (repositoryUrls.length === 0) return;
    const client = await this.options.getClient();
    for (const repositoryUrl of repositoryUrls) {
      if (this.isReferenced(repositoryUrl)) continue;
      await client.cancelSync({ repositoryUrl });
    }
  }

  private isReferenced(repositoryUrl: string): boolean {
    return [...this.projectRepositoryUrls.values()].some((urls) => urls.includes(repositoryUrl));
  }
}

export const pullRequestsRegistration = new PullRequestsRegistration();
