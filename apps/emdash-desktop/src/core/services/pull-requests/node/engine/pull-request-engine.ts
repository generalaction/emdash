import type { Result } from '@emdash/shared';
import type { Scope } from '@emdash/shared/concurrency';
import type { Logger } from '@emdash/shared/logger';
import type {
  CreateRequestSchedulerOptions,
  RateGate,
  RequestScheduler,
} from '@emdash/shared/requests';
import type { RetrySchedule } from '@emdash/shared/scheduling';
import type { ContractClient } from '@emdash/wire/rpc';
import type { Octokit } from '@octokit/rest';
import type {
  GitPlatformAuthContract,
  PullRequestError,
  PullRequestFile,
  PullRequestMergeOptions,
} from '../../api';
import type { GitPlatformPullRequestRepository } from './providers/git-platform-provider';
import { GitHubProvider } from './providers/github/github-provider';

// Own declaration (not a type alias of GitHubProviderOptions) so em-yrf.4's
// platform-detection work can extend this without touching the github provider module.
export type PullRequestEngineOptions = {
  githubAuth: ContractClient<GitPlatformAuthContract>;
  scope: Scope;
  logger: Logger;
  createOctokit?: (options: { token: string; baseUrl: string }) => Octokit;
  createScheduler?: (options: CreateRequestSchedulerOptions) => RequestScheduler;
  createRateGate?: (resource: 'graphql' | 'rest') => RateGate;
  retrySchedule?: RetrySchedule;
};

/** Delegates to a GitPlatformProvider; always GitHub today, platform detection lands in em-yrf.4. */
export class PullRequestEngine {
  private readonly provider: GitHubProvider;

  constructor(options: PullRequestEngineOptions) {
    this.provider = new GitHubProvider(options);
  }

  openRepository(
    repositoryUrl: string,
    signal: AbortSignal
  ): Promise<Result<GitPlatformPullRequestRepository, PullRequestError>> {
    return this.provider.openRepository(repositoryUrl, signal);
  }

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
  ): Promise<Result<{ url: string; number: number }, PullRequestError>> {
    return this.provider.createPullRequest(input, signal);
  }

  mergePullRequest(
    repositoryUrl: string,
    number: number,
    options: PullRequestMergeOptions,
    signal: AbortSignal
  ): Promise<Result<{ sha: string | null; merged: boolean }, PullRequestError>> {
    return this.provider.mergePullRequest(repositoryUrl, number, options, signal);
  }

  markReadyForReview(
    repositoryUrl: string,
    number: number,
    signal: AbortSignal
  ): Promise<Result<void, PullRequestError>> {
    return this.provider.markReadyForReview(repositoryUrl, number, signal);
  }

  getPullRequestFiles(
    repositoryUrl: string,
    number: number,
    signal: AbortSignal
  ): Promise<Result<PullRequestFile[], PullRequestError>> {
    return this.provider.getPullRequestFiles(repositoryUrl, number, signal);
  }
}
