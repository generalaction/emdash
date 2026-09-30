import type { ProjectManagerStore } from '@core/features/projects/api/browser/stores/project-manager';
import { asAvailableProject } from '@core/features/projects/api/browser/stores/project-selectors';
import { gitRepositoryStoreToken } from '@core/features/source-control/contributions/browser/project-stores';
import {
  getPullRequestsRuntimeClient,
  type PullRequestsRuntimeClient,
} from '@core/services/pull-requests/api/client';
import { normalizeRepositoryUrl } from '@core/services/pull-requests/api/repository';

type BrowserLifecycle = {
  window: Pick<Window, 'addEventListener' | 'removeEventListener'>;
};

/** Catch up after reconnect; activation and periodic freshness belong to the PR worker. */
export class PullRequestRefreshController {
  private cleanup: (() => void) | undefined;

  constructor(
    private readonly projects: Pick<ProjectManagerStore, 'projects'>,
    private readonly getClient: () => Promise<
      Pick<PullRequestsRuntimeClient, 'refreshRepository'>
    > = getPullRequestsRuntimeClient,
    private readonly browser: BrowserLifecycle | undefined = typeof window === 'undefined'
      ? undefined
      : { window }
  ) {}

  activate(): void {
    if (this.cleanup) return;
    let disposed = false;
    const revalidate = (repositoryUrls: readonly string[]) => {
      if (disposed || repositoryUrls.length === 0) return;
      void this.getClient()
        .then(async (client) => {
          if (disposed) return;
          await Promise.all(
            repositoryUrls.map((repositoryUrl) =>
              client.refreshRepository({ repositoryUrl, policy: 'if-stale' })
            )
          );
        })
        .catch(() => {
          // The worker retains errors and retries on its fixed interval.
        });
    };
    const onOnline = () => revalidate(this.repositoryUrls());
    this.browser?.window.addEventListener('online', onOnline);
    this.cleanup = () => {
      disposed = true;
      this.browser?.window.removeEventListener('online', onOnline);
    };
  }

  dispose(): void {
    this.cleanup?.();
    this.cleanup = undefined;
  }

  private repositoryUrl(projectId: string): string | null {
    const project = asAvailableProject(this.projects.projects.get(projectId));
    const url = project?.get(gitRepositoryStoreToken).pullRequestRepositoryUrl;
    return url ? normalizeRepositoryUrl(url) : null;
  }

  private repositoryUrls(): string[] {
    const urls = [...this.projects.projects.keys()].flatMap((projectId) => {
      const url = this.repositoryUrl(projectId);
      return url ? [url] : [];
    });
    return [...new Set(urls)].sort();
  }
}
