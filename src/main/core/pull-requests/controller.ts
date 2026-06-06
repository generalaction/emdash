import { providerRepositoryService } from "@main/core/repository/provider-repository-service";
import { log } from "@main/lib/logger";
import { telemetryService } from "@main/lib/telemetry";
import { createRPCController } from "@shared/ipc/rpc";
import type {
  ListPrOptions,
  PullRequestComment,
  PullRequestError,
  PullRequestFile,
  PullRequestMergeOptions,
} from "@shared/pull-requests";
import { isGitHubDotComHost, parseRepositoryRef } from "@shared/repository-ref";
import { err, ok } from "@shared/result";
import { prQueryService } from "./pr-query-service";
import { prSyncEngine } from "./pr-sync-engine";
import { type PrSyncEngineError } from "./pr-sync-errors";
import {
  resolveProjectPullRequestAuthContext,
  resolveProjectPullRequestContext,
} from "./project-pull-request-context";

type PrControllerFailureType =
  | "create_failed"
  | "merge_failed"
  | "mark_ready_failed"
  | "files_failed"
  | "comments_failed"
  | "refresh_failed"
  | "checks_failed";

type CreatePullRequestParams = {
  repositoryUrl: string;
  headRepositoryUrl?: string;
  head: string;
  base: string;
  title: string;
  body?: string;
  draft: boolean;
};

type MergePullRequestOptions = {
  strategy: "merge" | "squash" | "rebase";
  commitHeadOid?: string;
};

function mapPrSyncEngineError(
  error: PrSyncEngineError,
  fallbackType: PrControllerFailureType,
): PullRequestError {
  switch (error.type) {
    case "invalid-repository-ref":
      return { type: "invalid_repository", input: error.input };
    case "auth_required":
      return isGitHubDotComHost(error.host)
        ? {
            type: "github_auth_required",
            host: error.host,
            hint: error.hint ?? "Connect GitHub from account settings.",
          }
        : {
            type: "ghes_auth_required",
            host: error.host,
            hint: error.hint ?? `Run: gh auth login --hostname ${error.host}`,
          };
    case "account_not_found":
      return {
        type: "github_account_not_found",
        host: error.host,
        accountId: error.accountId,
        message: error.message,
      };
    case "account_host_mismatch":
      return {
        type: "github_account_host_mismatch",
        host: error.host,
        accountId: error.accountId,
        accountHost: error.accountHost,
        message: error.message,
      };
    case "token_missing":
      return {
        type: "github_token_missing",
        host: error.host,
        accountId: error.accountId,
        message: error.message,
      };
    case "not_found_or_no_access":
      return {
        type: "github_not_found_or_no_access",
        host: error.host,
        message: error.message,
      };
    case "sso_required":
      return {
        type: "github_sso_required",
        host: error.host,
        message: error.message,
        ssoUrl: error.ssoUrl,
      };
    case "rate_limited":
      return {
        type: "github_rate_limited",
        host: error.host,
        message: error.message,
        resetAt: error.resetAt,
      };
    case "forbidden":
      return {
        type: "github_forbidden",
        host: error.host,
        message: error.message,
      };
    case "host_unreachable":
      return {
        type: "host_unreachable",
        host: error.host,
        reason: error.reason,
      };
    case "api_error":
      return { type: fallbackType, message: error.message };
  }
}

export const pullRequestController = createRPCController({
  // ── DB-cached reads ────────────────────────────────────────────────────────

  listPullRequests: async (projectId: string, options?: ListPrOptions) => {
    try {
      const prs = await prQueryService.listPullRequests(projectId, options);
      return ok({ prs, totalCount: prs.length });
    } catch (error) {
      log.error("Failed to list pull requests:", error);
      return err<PullRequestError>({
        type: "list_failed",
        message:
          error instanceof Error
            ? error.message
            : "Unable to list pull requests",
      });
    }
  },

  getFilterOptions: async (projectId: string) => {
    try {
      const options = await prQueryService.getFilterOptions(projectId);
      return ok(options);
    } catch (error) {
      log.error("Failed to get PR filter options:", error);
      return err<PullRequestError>({
        type: "filter_options_failed",
        message:
          error instanceof Error
            ? error.message
            : "Unable to get filter options",
      });
    }
  },

  getPullRequestsForTask: async (projectId: string, taskId: string) => {
    try {
      const capability =
        await providerRepositoryService.resolveProject(projectId);
      if (!capability.success) {
        return ok({ prs: [], branchName: null });
      }

      const { tasks, workspaces } = await import("@main/db/schema");
      const { eq } = await import("drizzle-orm");
      const { db } = await import("@main/db/client");
      const [taskRow] = await db
        .select({ workspaceId: tasks.workspaceId })
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .limit(1);

      if (!taskRow?.workspaceId) {
        return ok({ prs: [], branchName: null });
      }

      const [wsRow] = await db
        .select({ branchName: workspaces.branchName })
        .from(workspaces)
        .where(eq(workspaces.id, taskRow.workspaceId))
        .limit(1);

      if (!wsRow?.branchName) {
        return ok({ prs: [], branchName: null });
      }

      const prs = await prQueryService.getTaskPullRequests(
        projectId,
        wsRow.branchName,
        capability.data.repositoryUrl,
      );
      return ok({ prs, branchName: wsRow.branchName });
    } catch (error) {
      log.error("Failed to get pull requests for task:", error);
      return err<PullRequestError>({
        type: "task_pull_requests_failed",
        message:
          error instanceof Error
            ? error.message
            : "Unable to get task pull requests",
      });
    }
  },

  // ── Sync triggers ──────────────────────────────────────────────────────────

  forceFullSyncPullRequests: async (projectId: string) => {
    try {
      const context = await resolveProjectPullRequestContext(projectId);
      if (!context.success) return err(context.error);

      prSyncEngine.forceFullSync(
        context.data.repositoryUrl,
        context.data.authContext,
      );
      return ok();
    } catch (error) {
      log.error("Failed to force full sync:", error);
      return err<PullRequestError>({
        type: "sync_failed",
        message:
          error instanceof Error ? error.message : "Unable to force sync",
      });
    }
  },

  syncPullRequests: async (projectId: string) => {
    try {
      log.info("PrController: syncPullRequests called", { projectId });
      const context = await resolveProjectPullRequestContext(projectId);
      if (!context.success) {
        log.warn(
          "PrController: project GitHub context not ready, skipping sync",
          {
            projectId,
            errorType: context.error.type,
            error:
              "message" in context.error ? context.error.message : undefined,
          },
        );
        return err(context.error);
      }
      log.info("PrController: triggering sync", {
        projectId,
        repositoryUrl: context.data.repositoryUrl,
      });
      prSyncEngine.sync(context.data.repositoryUrl, context.data.authContext);
      return ok();
    } catch (error) {
      log.error("Failed to trigger sync:", error);
      return err<PullRequestError>({
        type: "sync_failed",
        message: error instanceof Error ? error.message : "Unable to sync",
      });
    }
  },

  refreshPullRequest: async (
    projectId: string,
    repositoryUrl: string,
    prNumber: number,
  ) => {
    try {
      const authContext = await resolveProjectPullRequestAuthContext(projectId);
      if (!authContext.success) return err(authContext.error);

      const result = await prSyncEngine.syncSingle(
        repositoryUrl,
        prNumber,
        authContext.data,
      );
      if (!result.success) {
        return err<PullRequestError>(
          mapPrSyncEngineError(result.error, "refresh_failed"),
        );
      }
      return ok({ pr: result.data });
    } catch (error) {
      log.error("Failed to refresh pull request:", error);
      return err<PullRequestError>({
        type: "refresh_failed",
        message:
          error instanceof Error
            ? error.message
            : "Unable to refresh pull request",
      });
    }
  },

  syncChecks: async (
    projectId: string,
    pullRequestUrl: string,
    headRefOid: string,
  ) => {
    try {
      const authContext = await resolveProjectPullRequestAuthContext(projectId);
      if (!authContext.success) return err(authContext.error);

      const result = await prSyncEngine.syncChecks(
        pullRequestUrl,
        headRefOid,
        authContext.data,
      );
      if (!result.success) {
        return err<PullRequestError>(
          mapPrSyncEngineError(result.error, "checks_failed"),
        );
      }
      return ok({ hasRunning: result.data });
    } catch (error) {
      log.error("Failed to sync checks:", error);
      return err<PullRequestError>({
        type: "checks_failed",
        message:
          error instanceof Error ? error.message : "Unable to sync checks",
      });
    }
  },

  cancelSync: (repositoryUrl: string) => {
    prSyncEngine.cancel(repositoryUrl);
    return ok();
  },

  // ── Mutations ──────────────────────────────────────────────────────────────

  createPullRequest: async (
    projectId: string,
    params: CreatePullRequestParams,
  ) => {
    try {
      if (params.headRepositoryUrl) {
        const baseRef = parseRepositoryRef(params.repositoryUrl);
        const headRef = parseRepositoryRef(params.headRepositoryUrl);
        if (baseRef && headRef && baseRef.host !== headRef.host) {
          return err<PullRequestError>({
            type: "cross_host_pr",
            baseHost: baseRef.host,
            headHost: headRef.host,
          });
        }
      }

      const authContext = await resolveProjectPullRequestAuthContext(projectId);
      if (!authContext.success) return err(authContext.error);

      const result = await prSyncEngine.createPullRequest(
        params,
        authContext.data,
      );
      if (!result.success) {
        telemetryService.capture("pr_creation_failed", {
          error_type: result.error.type,
        });
        return err<PullRequestError>(
          mapPrSyncEngineError(result.error, "create_failed"),
        );
      }
      // Sync the newly created PR into the DB
      void prSyncEngine.syncSingle(
        params.repositoryUrl,
        result.data.number,
        authContext.data,
      );
      telemetryService.capture("pr_created", { is_draft: params.draft });
      return ok({ url: result.data.url, number: result.data.number });
    } catch (error) {
      log.error("Failed to create pull request:", error);
      telemetryService.capture("pr_creation_failed", {
        error_type:
          error instanceof Error ? error.name || "error" : "unknown_error",
      });
      const message =
        error instanceof Error
          ? error.message
          : "Unable to create pull request";
      return err<PullRequestError>({ type: "create_failed", message });
    }
  },

  mergePullRequest: async (
    projectId: string,
    repositoryUrl: string,
    prNumber: number,
    options: MergePullRequestOptions,
  ) => {
    try {
      const authContext = await resolveProjectPullRequestAuthContext(projectId);
      if (!authContext.success) return err(authContext.error);

      const result = await prSyncEngine.mergePullRequest(
        repositoryUrl,
        prNumber,
        options,
        authContext.data,
      );
      if (!result.success) {
        return err<PullRequestError>(
          mapPrSyncEngineError(result.error, "merge_failed"),
        );
      }
      // Refresh the merged PR
      void prSyncEngine.syncSingle(repositoryUrl, prNumber, authContext.data);
      return ok({ sha: result.data.sha, merged: result.data.merged });
    } catch (error) {
      log.error("Failed to merge pull request:", error);
      return err<PullRequestError>({
        type: "merge_failed",
        message:
          error instanceof Error
            ? error.message
            : "Unable to merge pull request",
      });
    }
  },

  markReadyForReview: async (
    projectId: string,
    repositoryUrl: string,
    prNumber: number,
  ) => {
    try {
      const authContext = await resolveProjectPullRequestAuthContext(projectId);
      if (!authContext.success) return err(authContext.error);

      const result = await prSyncEngine.markReadyForReview(
        repositoryUrl,
        prNumber,
        authContext.data,
      );
      if (!result.success) {
        return err<PullRequestError>(
          mapPrSyncEngineError(result.error, "mark_ready_failed"),
        );
      }
      void prSyncEngine.syncSingle(repositoryUrl, prNumber, authContext.data);
      return ok();
    } catch (error) {
      log.error("Failed to mark pull request ready for review:", error);
      return err<PullRequestError>({
        type: "mark_ready_failed",
        message:
          error instanceof Error
            ? error.message
            : "Unable to mark PR ready for review",
      });
    }
  },

  // ── Pass-through reads ─────────────────────────────────────────────────────

  getPullRequestFiles: async (
    projectId: string,
    repositoryUrl: string,
    prNumber: number,
  ) => {
    try {
      const authContext = await resolveProjectPullRequestAuthContext(projectId);
      if (!authContext.success) return err(authContext.error);

      const result = await prSyncEngine.getPullRequestFiles(
        repositoryUrl,
        prNumber,
        authContext.data,
      );
      if (!result.success) {
        return err<PullRequestError>(
          mapPrSyncEngineError(result.error, "files_failed"),
        );
      }
      const files: PullRequestFile[] = result.data;
      return ok({ files });
    } catch (error) {
      log.error("Failed to get pull request files:", error);
      return err<PullRequestError>({
        type: "files_failed",
        message:
          error instanceof Error
            ? error.message
            : "Unable to get pull request files",
      });
    }
  },

  getPullRequestComments: async (
    projectId: string,
    repositoryUrl: string,
    prNumber: number,
  ) => {
    try {
      const authContext = await resolveProjectPullRequestAuthContext(projectId);
      if (!authContext.success) return err(authContext.error);

      const result = await prSyncEngine.getPullRequestComments(
        repositoryUrl,
        prNumber,
        authContext.data,
      );
      if (!result.success) {
        return err<PullRequestError>(
          mapPrSyncEngineError(result.error, "comments_failed"),
        );
      }
      const comments: PullRequestComment[] = result.data;
      return ok({ comments });
    } catch (error) {
      log.error("Failed to get pull request comments:", error);
      return err<PullRequestError>({
        type: "comments_failed",
        message:
          error instanceof Error
            ? error.message
            : "Unable to get pull request comments",
      });
    }
  },
});
