import type { Result } from '@emdash/shared';
import type {
  PullRequestCheck,
  PullRequestComment,
  PullRequestError,
  PullRequestFile,
  PullRequestMergeOptions,
} from '../../../api';
import type { Observed, PullRequestMetadata, PullRequestPage } from '../observation';

/** One authenticated repository context for a single git hosting platform. */
export interface GitPlatformPullRequestRepository {
  readonly identity: string;
  readonly repositoryUrl: string;
  fetchOpenPage(
    cursor: string | null,
    signal: AbortSignal,
    priority?: number
  ): Promise<Result<Observed<PullRequestPage>, PullRequestError>>;
  fetchHistoryPage(
    cursor: string | null,
    signal: AbortSignal,
    priority?: number
  ): Promise<Result<Observed<PullRequestPage>, PullRequestError>>;
  fetchPullRequest(
    number: number,
    signal: AbortSignal,
    priority?: number
  ): Promise<Result<Observed<PullRequestMetadata>, PullRequestError>>;
  fetchChecks(
    number: number,
    signal: AbortSignal
  ): Promise<
    Result<Observed<{ headRefOid: string; checks: PullRequestCheck[] }>, PullRequestError>
  >;
  fetchComments(
    number: number,
    signal: AbortSignal
  ): Promise<Result<Observed<PullRequestComment[]>, PullRequestError>>;
}

/** A single git hosting platform's PR/MR I/O: fetches and mutates, never store or scheduler policy. */
export interface GitPlatformProvider {
  openRepository(
    repositoryUrl: string,
    signal: AbortSignal
  ): Promise<Result<GitPlatformPullRequestRepository, PullRequestError>>;
  createPullRequest(
    input: {
      repositoryUrl: string;
      headRepositoryUrl?: string;
      head: string;
      base: string;
      title: string;
      body?: string;
      draft: boolean;
    },
    signal: AbortSignal
  ): Promise<Result<{ url: string; number: number }, PullRequestError>>;
  mergePullRequest(
    repositoryUrl: string,
    number: number,
    options: PullRequestMergeOptions,
    signal: AbortSignal
  ): Promise<Result<{ sha: string | null; merged: boolean }, PullRequestError>>;
  markReadyForReview(
    repositoryUrl: string,
    number: number,
    signal: AbortSignal
  ): Promise<Result<void, PullRequestError>>;
  getPullRequestFiles(
    repositoryUrl: string,
    number: number,
    signal: AbortSignal
  ): Promise<Result<PullRequestFile[], PullRequestError>>;
}
