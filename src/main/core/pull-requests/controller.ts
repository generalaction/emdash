import { createRPCController } from '@shared/ipc/rpc';
import type { ListPrOptions, PullRequestFile } from '@shared/pull-requests';
import { log } from '@main/lib/logger';
import { capture } from '@main/lib/telemetry';
import { prQueryService } from './pr-query-service';
import { prSyncEngine } from './pr-service';

export const pullRequestController = createRPCController({
  // ── DB-cached reads ────────────────────────────────────────────────────────

  listPullRequests: async (projectId: string, options?: ListPrOptions) => {
    try {
      const prs = await prQueryService.listPullRequests(projectId, options);
      return { success: true as const, prs, totalCount: prs.length };
    } catch (error) {
      log.error('Failed to list pull requests:', error);
      return {
        success: false as const,
        error: error instanceof Error ? error.message : 'Unable to list pull requests',
      };
    }
  },

  getFilterOptions: async (projectId: string) => {
    try {
      const options = await prQueryService.getFilterOptions(projectId);
      return { success: true as const, ...options };
    } catch (error) {
      log.error('Failed to get PR filter options:', error);
      return {
        success: false as const,
        error: error instanceof Error ? error.message : 'Unable to get filter options',
      };
    }
  },

  getPullRequestsForTask: async (projectId: string, taskId: string) => {
    try {
      const capability = await prQueryService.getProjectRemoteInfo(projectId);
      if (capability.status !== 'ready') {
        return { success: true as const, prs: [], taskBranch: null };
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
        return { success: true as const, prs: [], taskBranch: null };
      }

      const prs = await prQueryService.getTaskPullRequests(
        projectId,
        taskRow.taskBranch,
        capability.repositoryUrl
      );
      return { success: true as const, prs, taskBranch: taskRow.taskBranch };
    } catch (error) {
      log.error('Failed to get pull requests for task:', error);
      return {
        success: false as const,
        error: error instanceof Error ? error.message : 'Unable to get task pull requests',
      };
    }
  },

  // ── Sync triggers ──────────────────────────────────────────────────────────

  syncPullRequests: async (projectId: string) => {
    try {
      const capability = await prQueryService.getProjectRemoteInfo(projectId);
      if (capability.status !== 'ready') {
        return { success: false as const, error: `Remote not ready: ${capability.status}` };
      }
      prSyncEngine.forceFullSync(capability.repositoryUrl);
      return { success: true as const };
    } catch (error) {
      log.error('Failed to trigger sync:', error);
      return {
        success: false as const,
        error: error instanceof Error ? error.message : 'Unable to sync',
      };
    }
  },

  triggerIncrementalSync: async (projectId: string) => {
    try {
      log.info('PrController: triggerIncrementalSync called', { projectId });
      const capability = await prQueryService.getProjectRemoteInfo(projectId);
      if (capability.status !== 'ready') {
        log.warn('PrController: remote not ready, skipping incremental sync', {
          projectId,
          status: capability.status,
        });
        return { success: false as const, error: `Remote not ready: ${capability.status}` };
      }
      log.info('PrController: triggering incremental sync', {
        projectId,
        repositoryUrl: capability.repositoryUrl,
      });
      prSyncEngine.sync(capability.repositoryUrl);
      return { success: true as const };
    } catch (error) {
      log.error('Failed to trigger incremental sync:', error);
      return {
        success: false as const,
        error: error instanceof Error ? error.message : 'Unable to sync',
      };
    }
  },

  refreshPullRequest: async (repositoryUrl: string, prNumber: number) => {
    try {
      const pr = await prSyncEngine.syncSingle(repositoryUrl, prNumber);
      return { success: true as const, pr };
    } catch (error) {
      log.error('Failed to refresh pull request:', error);
      return {
        success: false as const,
        error: error instanceof Error ? error.message : 'Unable to refresh pull request',
      };
    }
  },

  syncChecks: async (pullRequestUrl: string, headRefOid: string) => {
    try {
      const hasRunning = await prSyncEngine.syncChecks(pullRequestUrl, headRefOid);
      return { success: true as const, hasRunning };
    } catch (error) {
      log.error('Failed to sync checks:', error);
      return {
        success: false as const,
        error: error instanceof Error ? error.message : 'Unable to sync checks',
      };
    }
  },

  cancelSync: (repositoryUrl: string) => {
    prSyncEngine.cancel(repositoryUrl);
    return { success: true as const };
  },

  // ── Mutations ──────────────────────────────────────────────────────────────

  createPullRequest: async (params: {
    repositoryUrl: string;
    head: string;
    base: string;
    title: string;
    body?: string;
    draft: boolean;
  }) => {
    try {
      const result = await prSyncEngine.createPullRequest(params);
      // Sync the newly created PR into the DB
      void prSyncEngine.syncSingle(params.repositoryUrl, result.number);
      capture('pr_created', { is_draft: params.draft });
      return { success: true as const, url: result.url, number: result.number };
    } catch (error) {
      log.error('Failed to create pull request:', error);
      capture('pr_creation_failed', {
        error_type: error instanceof Error ? error.name || 'error' : 'unknown_error',
      });
      return {
        success: false as const,
        error: error instanceof Error ? error.message : 'Unable to create pull request',
      };
    }
  },

  mergePullRequest: async (
    repositoryUrl: string,
    prNumber: number,
    options: { strategy: 'merge' | 'squash' | 'rebase'; commitHeadOid?: string }
  ) => {
    try {
      const result = await prSyncEngine.mergePullRequest(repositoryUrl, prNumber, options);
      // Refresh the merged PR
      void prSyncEngine.syncSingle(repositoryUrl, prNumber);
      return { success: true as const, sha: result.sha, merged: result.merged };
    } catch (error) {
      log.error('Failed to merge pull request:', error);
      return {
        success: false as const,
        error: error instanceof Error ? error.message : 'Unable to merge pull request',
      };
    }
  },

  markReadyForReview: async (repositoryUrl: string, prNumber: number) => {
    try {
      await prSyncEngine.markReadyForReview(repositoryUrl, prNumber);
      void prSyncEngine.syncSingle(repositoryUrl, prNumber);
      return { success: true as const };
    } catch (error) {
      log.error('Failed to mark pull request ready for review:', error);
      return {
        success: false as const,
        error: error instanceof Error ? error.message : 'Unable to mark PR ready for review',
      };
    }
  },

  // ── Pass-through reads ─────────────────────────────────────────────────────

  getPullRequestFiles: async (repositoryUrl: string, prNumber: number) => {
    try {
      const files: PullRequestFile[] = await prSyncEngine.getPullRequestFiles(
        repositoryUrl,
        prNumber
      );
      return { success: true as const, files };
    } catch (error) {
      log.error('Failed to get pull request files:', error);
      return {
        success: false as const,
        error: error instanceof Error ? error.message : 'Unable to get pull request files',
      };
    }
  },
});
