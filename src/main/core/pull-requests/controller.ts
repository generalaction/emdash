import { RequestError } from '@octokit/request-error';
import { GitHubApiAuthErrorException } from '@main/core/github/services/octokit-provider';
import { providerRepositoryService } from '@main/core/repository/provider-repository-service';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import { createRPCController } from '@shared/ipc/rpc';
import type {
  ListPrOptions,
  PullRequestComment,
  PullRequestError,
  PullRequestFile,
} from '@shared/pull-requests';
import { parseRepositoryRef } from '@shared/repository-ref';
import { err, ok } from '@shared/result';
import { prQueryService } from './pr-query-service';
import { prSyncEngine } from './pr-sync-engine';

export const pullRequestController = createRPCController({
  // ── DB-cached reads ────────────────────────────────────────────────────────

  listPullRequests: async (projectId: string, options?: ListPrOptions) => {
    try {
      const prs = await prQueryService.listPullRequests(projectId, options);
      return ok({ prs, totalCount: prs.length });
    } catch (error) {
      log.error('Failed to list pull requests:', error);
      return err<PullRequestError>({
        type: 'list_failed',
        message: error instanceof Error ? error.message : 'Unable to list pull requests',
      });
    }
  },

  getFilterOptions: async (projectId: string) => {
    try {
      const options = await prQueryService.getFilterOptions(projectId);
      return ok(options);
    } catch (error) {
      log.error('Failed to get PR filter options:', error);
      return err<PullRequestError>({
        type: 'filter_options_failed',
        message: error instanceof Error ? error.message : 'Unable to get filter options',
      });
    }
  },

  getPullRequestsForTask: async (projectId: string, taskId: string) => {
    try {
      const capability = await providerRepositoryService.resolveProject(projectId);
      if (!capability.success) {
        return ok({ prs: [], taskBranch: null });
      }

      const { tasks } = await import('@main/db/schema');
      const { eq } = await import('drizzle-orm');
      const { db } = await import('@main/db/client');
      const [taskRow] = await db
        .select({ taskBranch: tasks.taskBranch })
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .limit(1);

      if (!taskRow?.taskBranch) {
        return ok({ prs: [], taskBranch: null });
      }

      const prs = await prQueryService.getTaskPullRequests(
        projectId,
        taskRow.taskBranch,
        capability.data.repositoryUrl
      );
      return ok({ prs, taskBranch: taskRow.taskBranch });
    } catch (error) {
      log.error('Failed to get pull requests for task:', error);
      return err<PullRequestError>({
        type: 'task_pull_requests_failed',
        message: error instanceof Error ? error.message : 'Unable to get task pull requests',
      });
    }
  },

  // ── Sync triggers ──────────────────────────────────────────────────────────

  forceFullSyncPullRequests: async (projectId: string) => {
    try {
      const capability = await providerRepositoryService.resolveProject(projectId);
      if (!capability.success) {
        return err<PullRequestError>({ type: 'remote_not_ready', status: capability.error.type });
      }
      prSyncEngine.forceFullSync(capability.data.repositoryUrl);
      return ok();
    } catch (error) {
      log.error('Failed to force full sync:', error);
      return err<PullRequestError>({
        type: 'sync_failed',
        message: error instanceof Error ? error.message : 'Unable to force sync',
      });
    }
  },

  syncPullRequests: async (projectId: string) => {
    try {
      log.info('PrController: syncPullRequests called', { projectId });
      const capability = await providerRepositoryService.resolveProject(projectId);
      if (!capability.success) {
        log.warn('PrController: remote not ready, skipping sync', {
          projectId,
          status: capability.error.type,
        });
        return err<PullRequestError>({ type: 'remote_not_ready', status: capability.error.type });
      }
      log.info('PrController: triggering sync', {
        projectId,
        repositoryUrl: capability.data.repositoryUrl,
      });
      prSyncEngine.sync(capability.data.repositoryUrl);
      return ok();
    } catch (error) {
      log.error('Failed to trigger sync:', error);
      return err<PullRequestError>({
        type: 'sync_failed',
        message: error instanceof Error ? error.message : 'Unable to sync',
      });
    }
  },

  refreshPullRequest: async (repositoryUrl: string, prNumber: number) => {
    try {
      const pr = await prSyncEngine.syncSingle(repositoryUrl, prNumber);
      return ok({ pr });
    } catch (error) {
      log.error('Failed to refresh pull request:', error);
      return err<PullRequestError>({
        type: 'refresh_failed',
        message: error instanceof Error ? error.message : 'Unable to refresh pull request',
      });
    }
  },

  syncChecks: async (pullRequestUrl: string, headRefOid: string) => {
    try {
      const hasRunning = await prSyncEngine.syncChecks(pullRequestUrl, headRefOid);
      return ok({ hasRunning });
    } catch (error) {
      log.error('Failed to sync checks:', error);
      return err<PullRequestError>({
        type: 'checks_failed',
        message: error instanceof Error ? error.message : 'Unable to sync checks',
      });
    }
  },

  cancelSync: (repositoryUrl: string) => {
    prSyncEngine.cancel(repositoryUrl);
    return ok();
  },

  // ── Mutations ──────────────────────────────────────────────────────────────

  createPullRequest: async (params: {
    repositoryUrl: string;
    headRepositoryUrl?: string;
    head: string;
    base: string;
    title: string;
    body?: string;
    draft: boolean;
  }) => {
    try {
      if (params.headRepositoryUrl) {
        const baseRef = parseRepositoryRef(params.repositoryUrl);
        const headRef = parseRepositoryRef(params.headRepositoryUrl);
        if (baseRef && headRef && baseRef.host !== headRef.host) {
          return err<PullRequestError>({
            type: 'cross_host_pr',
            baseHost: baseRef.host,
            headHost: headRef.host,
          });
        }
      }

      const result = await prSyncEngine.createPullRequest(params);
      if (!result.success) {
        return err<PullRequestError>({ type: 'invalid_repository', input: result.error.input });
      }
      // Sync the newly created PR into the DB
      void prSyncEngine.syncSingle(params.repositoryUrl, result.data.number);
      telemetryService.capture('pr_created', { is_draft: params.draft });
      return ok({ url: result.data.url, number: result.data.number });
    } catch (error) {
      log.error('Failed to create pull request:', error);
      telemetryService.capture('pr_creation_failed', {
        error_type: error instanceof Error ? error.name || 'error' : 'unknown_error',
      });
      if (error instanceof GitHubApiAuthErrorException) {
        return err<PullRequestError>({
          type: 'ghes_auth_required',
          host: error.authError.host,
          hint: error.authError.hint ?? 'Connect GitHub from account settings.',
        });
      }
      const ghErrors =
        error instanceof RequestError &&
        Array.isArray((error.response?.data as { errors?: unknown[] } | undefined)?.errors)
          ? (error.response!.data as { errors: { message?: string }[] }).errors
          : undefined;
      const message =
        ghErrors?.[0]?.message ??
        (error instanceof Error ? error.message : 'Unable to create pull request');
      return err<PullRequestError>({ type: 'create_failed', message });
    }
  },

  mergePullRequest: async (
    repositoryUrl: string,
    prNumber: number,
    options: { strategy: 'merge' | 'squash' | 'rebase'; commitHeadOid?: string }
  ) => {
    try {
      const result = await prSyncEngine.mergePullRequest(repositoryUrl, prNumber, options);
      if (!result.success) {
        return err<PullRequestError>({ type: 'invalid_repository', input: result.error.input });
      }
      // Refresh the merged PR
      void prSyncEngine.syncSingle(repositoryUrl, prNumber);
      return ok({ sha: result.data.sha, merged: result.data.merged });
    } catch (error) {
      log.error('Failed to merge pull request:', error);
      return err<PullRequestError>({
        type: 'merge_failed',
        message: error instanceof Error ? error.message : 'Unable to merge pull request',
      });
    }
  },

  markReadyForReview: async (repositoryUrl: string, prNumber: number) => {
    try {
      const result = await prSyncEngine.markReadyForReview(repositoryUrl, prNumber);
      if (!result.success) {
        return err<PullRequestError>({ type: 'invalid_repository', input: result.error.input });
      }
      void prSyncEngine.syncSingle(repositoryUrl, prNumber);
      return ok();
    } catch (error) {
      log.error('Failed to mark pull request ready for review:', error);
      return err<PullRequestError>({
        type: 'mark_ready_failed',
        message: error instanceof Error ? error.message : 'Unable to mark PR ready for review',
      });
    }
  },

  // ── Pass-through reads ─────────────────────────────────────────────────────

  getPullRequestFiles: async (repositoryUrl: string, prNumber: number) => {
    try {
      const result = await prSyncEngine.getPullRequestFiles(repositoryUrl, prNumber);
      if (!result.success) {
        return err<PullRequestError>({ type: 'invalid_repository', input: result.error.input });
      }
      const files: PullRequestFile[] = result.data;
      return ok({ files });
    } catch (error) {
      log.error('Failed to get pull request files:', error);
      return err<PullRequestError>({
        type: 'files_failed',
        message: error instanceof Error ? error.message : 'Unable to get pull request files',
      });
    }
  },

  getPullRequestComments: async (repositoryUrl: string, prNumber: number) => {
    try {
      const result = await prSyncEngine.getPullRequestComments(repositoryUrl, prNumber);
      if (!result.success) {
        return err<PullRequestError>({ type: 'invalid_repository', input: result.error.input });
      }
      const comments: PullRequestComment[] = result.data;
      return ok({ comments });
    } catch (error) {
      log.error('Failed to get pull request comments:', error);
      return err<PullRequestError>({
        type: 'comments_failed',
        message: error instanceof Error ? error.message : 'Unable to get pull request comments',
      });
    }
  },
});
