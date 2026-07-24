import type { Result } from '@emdash/shared';
import type { Disposable } from '@emdash/shared/concurrency';
import { log } from '@emdash/shared/logger';
import type { PullRequestsRuntimeClient } from '@core/services/pull-requests/api';

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
  onProjectOpened(handler: (projectId: string) => void): () => void;
  onProjectClosed(handler: (projectId: string) => void): () => void;
  onProjectSettingsChanged(handler: (projectId: string) => void): () => void;
  onTaskProvisioned(
    handler: (event: { projectId: string; branchName: string | undefined }) => void
  ): () => void;
  subscribeToProjectRemotes(projectId: string, handler: () => void): (() => void) | undefined;
  resolveProjectRepositoryUrls(projectId: string): Promise<string[]>;
  resolveProjectAuthContext(
    projectId: string
  ): Promise<Result<{ accountId?: string }, { message: string }>>;
};

export class PullRequestsRegistration implements Disposable {
  private readonly projectRepositoryUrls = new Map<string, string[]>();
  private readonly repositoryUnsubscribes = new Map<string, () => void>();
  private unsubscribes: Array<() => void> = [];

  constructor(private readonly options: PullRequestsRegistrationOptions) {}

  initialize(): void {
    if (this.unsubscribes.length > 0) return;
    this.unsubscribes = [
      this.options.onProjectOpened((projectId) => {
        void this.onProjectOpened(projectId);
      }),
      this.options.onProjectClosed((projectId) => {
        void this.onProjectClosed(projectId);
      }),
      this.options.onTaskProvisioned(({ projectId, branchName }) => {
        void this.onTaskProvisioned(projectId, branchName).catch((error) => {
          log.warn('PullRequestsRegistration: failed to refresh a provisioned task', {
            projectId,
            error: String(error),
          });
        });
      }),
      this.options.onProjectSettingsChanged((projectId) => {
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

    const authContext = await this.options.resolveProjectAuthContext(projectId);
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
    const unsubscribe = this.options.subscribeToProjectRemotes(projectId, () => {
      void this.refreshProject(projectId).catch((error) => {
        log.warn('PullRequestsRegistration: failed to refresh changed remotes', {
          projectId,
          error: String(error),
        });
      });
    });
    if (unsubscribe) this.repositoryUnsubscribes.set(projectId, unsubscribe);
  }

  private async resolveRepositoryUrls(projectId: string): Promise<string[]> {
    try {
      return await this.options.resolveProjectRepositoryUrls(projectId);
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
