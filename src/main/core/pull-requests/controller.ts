import { createRPCController } from '@shared/ipc/rpc';
import type { PullRequest } from '@shared/pull-requests';
import { prService } from '@main/core/github/services/pr-service';
import { parseNameWithOwner } from '@main/core/github/services/utils';
import { projectManager } from '@main/core/projects/project-manager';
import { resolveTask } from '@main/core/projects/utils';
import { log } from '@main/lib/logger';
import { err, ok } from '@main/lib/result';
import { pullRequestProvider } from './pr-provider';

type TaskPrsPayload = {
  prs: PullRequest[];
  nameWithOwner: string | null;
  taskBranch: string | null;
};

export const pullRequestController = createRPCController({
  // ── Sync (GitHub → DB) ─────────────────────────────────────────────
  syncPullRequests: async (nameWithOwner: string) => {
    try {
      const sinceUpdatedAt = await pullRequestProvider.getLatestUpdatedAt(nameWithOwner);
      const prs = await prService.syncPullRequests(nameWithOwner, sinceUpdatedAt);
      if (prs.length > 0) {
        await pullRequestProvider.upsertPullRequests(prs);
      }
      return { success: true };
    } catch (error) {
      log.error('Failed to sync pull requests:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unable to sync pull requests',
      };
    }
  },

  // ── List / Detail ──────────────────────────────────────────────────
  listPullRequests: async (nameWithOwner: string) => {
    try {
      const prs = await pullRequestProvider.listPullRequests(nameWithOwner);
      return { success: true, prs, totalCount: prs.length };
    } catch (error) {
      log.error('Failed to list pull requests:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unable to list pull requests',
      };
    }
  },

  getPullRequestDetails: async (nameWithOwner: string, prNumber: number) => {
    try {
      const detail = await prService.getPullRequestDetails(nameWithOwner, prNumber);
      if (!detail) return { success: false, error: 'Pull request not found' };
      const pr = await pullRequestProvider.upsertPullRequest(detail);
      return { success: true, pr };
    } catch (error) {
      log.error('Failed to get pull request details:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unable to get pull request',
      };
    }
  },

  // ── Mutations ──────────────────────────────────────────────────────
  createPullRequest: async (params: {
    nameWithOwner: string;
    head: string;
    base: string;
    title: string;
    body?: string;
    draft: boolean;
  }) => {
    try {
      const result = await prService.createPullRequest(params);
      // Fetch the newly created PR to sync to DB
      const detail = await prService.getPullRequestDetails(params.nameWithOwner, result.number);
      if (detail) {
        await pullRequestProvider.upsertPullRequest(detail);
      }
      return { success: true, url: result.url, number: result.number };
    } catch (error) {
      log.error('Failed to create pull request:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unable to create pull request',
      };
    }
  },

  mergePullRequest: async (
    nameWithOwner: string,
    prNumber: number,
    options: { strategy: 'merge' | 'squash' | 'rebase'; commitHeadOid?: string }
  ) => {
    try {
      const result = await prService.mergePullRequest(nameWithOwner, prNumber, options);
      // Fetch updated PR state to sync to DB
      const detail = await prService.getPullRequestDetails(nameWithOwner, prNumber);
      if (detail) {
        await pullRequestProvider.upsertPullRequest(detail);
      }
      return { success: true, sha: result.sha, merged: result.merged };
    } catch (error) {
      log.error('Failed to merge pull request:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unable to merge pull request',
      };
    }
  },

  // ── Pass-through (no DB caching) ──────────────────────────────────
  getCheckRuns: async (nameWithOwner: string, prNumber: number) => {
    try {
      const checks = await prService.getCheckRuns(nameWithOwner, prNumber);
      return { success: true, checks };
    } catch (error) {
      log.error('Failed to get check runs:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unable to get check runs',
      };
    }
  },

  getPrComments: async (nameWithOwner: string, prNumber: number) => {
    try {
      const result = await prService.getPrComments(nameWithOwner, prNumber);
      return { success: true, ...result };
    } catch (error) {
      log.error('Failed to get PR comments:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unable to get PR comments',
      };
    }
  },

  addPrComment: async (nameWithOwner: string, prNumber: number, body: string) => {
    try {
      const result = await prService.addPrComment(nameWithOwner, prNumber, body);
      return { success: true, id: result.id };
    } catch (error) {
      log.error('Failed to add PR comment:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unable to add comment',
      };
    }
  },

  getPullRequestFiles: async (nameWithOwner: string, prNumber: number) => {
    try {
      const files = await prService.getPullRequestFiles(nameWithOwner, prNumber);
      return { success: true, files };
    } catch (error) {
      log.error('Failed to get pull request files:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unable to get pull request files',
      };
    }
  },

  getPullRequestsForTask: async (projectId: string, taskId: string) => {
    try {
      const project = projectManager.getProject(projectId);
      const env = resolveTask(projectId, taskId);
      if (!project || !env) return err({ type: 'not_found' as const });
      if (!env.taskBranch)
        return ok<TaskPrsPayload>({ prs: [], nameWithOwner: null, taskBranch: null });

      const taskBranch = env.taskBranch;

      const remoteName = await project.settings.getRemote();
      const remotes = await env.git.getRemotes();
      const remoteUrl = remotes.find((r) => r.name === remoteName)?.url;
      const nameWithOwner = remoteUrl ? parseNameWithOwner(remoteUrl) : null;
      if (!nameWithOwner) {
        // No parseable GitHub remote — still surface the branch so the UI can show the Create PR button
        return ok<TaskPrsPayload>({ prs: [], nameWithOwner: null, taskBranch });
      }

      const prs = await prService.getPullRequestsByBranch(nameWithOwner, taskBranch);
      if (prs.length > 0) await pullRequestProvider.upsertPullRequests(prs);
      return ok<TaskPrsPayload>({ prs, nameWithOwner, taskBranch });
    } catch (error) {
      log.error('Failed to get pull requests for task:', error);
      // Best-effort: re-resolve the task branch so the Create PR button stays visible
      const env2 = resolveTask(projectId, taskId);
      return ok<TaskPrsPayload>({
        prs: [],
        nameWithOwner: null,
        taskBranch: env2?.taskBranch ?? null,
      });
    }
  },
});
