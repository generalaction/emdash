import { createRPCController } from '@shared/ipc/rpc';
import type { ListPrOptions } from '@shared/pull-requests';
import { parseNameWithOwner } from '@main/core/github/services/utils';
import { projectManager } from '@main/core/projects/project-manager';
import { log } from '@main/lib/logger';
import { capture } from '@main/lib/telemetry';
import { prService } from './pr-service';

export const pullRequestController = createRPCController({
  getNameWithOwner: async (projectId: string) => {
    const project = projectManager.getProject(projectId);
    if (!project) return { status: 'no_remote' as const };
    const remoteState = await project.getRemoteState();
    if (!remoteState.hasRemote) return { status: 'no_remote' as const };
    if (!remoteState.selectedRemoteUrl) return { status: 'unsupported_remote' as const };

    const nameWithOwner = parseNameWithOwner(remoteState.selectedRemoteUrl);
    if (!nameWithOwner) return { status: 'unsupported_remote' as const };

    return { status: 'ready' as const, nameWithOwner };
  },

  // ── DB-cached reads ────────────────────────────────────────────────────
  listPullRequests: async (
    projectId: string,
    nameWithOwner: string,
    options?: ListPrOptions,
    invalidate = false
  ) => {
    try {
      const { prs, syncing } = await prService.listPullRequests(
        projectId,
        nameWithOwner,
        options,
        invalidate
      );
      return { success: true, prs, totalCount: prs.length, syncing };
    } catch (error) {
      log.error('Failed to list pull requests:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unable to list pull requests',
      };
    }
  },

  getFilterOptions: async (nameWithOwner: string) => {
    try {
      const options = await prService.getFilterOptions(nameWithOwner);
      return { success: true, ...options };
    } catch (error) {
      log.error('Failed to get PR filter options:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unable to get filter options',
      };
    }
  },

  getPullRequest: async (nameWithOwner: string, prNumber: number, invalidate = false) => {
    try {
      const pr = await prService.getPullRequest(nameWithOwner, prNumber, invalidate);
      if (!pr) return { success: false, error: 'Pull request not found' };
      return { success: true, pr };
    } catch (error) {
      log.error('Failed to get pull request:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unable to get pull request',
      };
    }
  },

  getPullRequestsForTask: async (projectId: string, taskId: string, invalidate = false) => {
    return prService.getPullRequestsForTask(projectId, taskId, invalidate);
  },

  // ── Mutations ──────────────────────────────────────────────────────────
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
      capture('pr_created', { is_draft: params.draft });
      return { success: true, url: result.url, number: result.number };
    } catch (error) {
      log.error('Failed to create pull request:', error);
      capture('pr_creation_failed', {
        error_type: error instanceof Error ? error.name || 'error' : 'unknown_error',
      });
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
      return { success: true, sha: result.sha, merged: result.merged };
    } catch (error) {
      log.error('Failed to merge pull request:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unable to merge pull request',
      };
    }
  },

  markReadyForReview: async (nameWithOwner: string, prNumber: number) => {
    try {
      await prService.markReadyForReview(nameWithOwner, prNumber);
      return { success: true };
    } catch (error) {
      log.error('Failed to mark pull request ready for review:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unable to mark PR ready for review',
      };
    }
  },

  // ── Pass-through reads ─────────────────────────────────────────────────
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

  // ── Pass-through mutations ─────────────────────────────────────────────
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

  // ── Bootstrap sync ─────────────────────────────────────────────────────
  syncPullRequests: async (projectId: string, nameWithOwner: string) => {
    try {
      await prService.syncPullRequests(projectId, nameWithOwner);
      return { success: true };
    } catch (error) {
      log.error('Failed to sync pull requests:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unable to sync pull requests',
      };
    }
  },
});
