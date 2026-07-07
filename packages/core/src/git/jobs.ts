import type { Result } from '@emdash/shared';
import { LiveJobServer } from '../live/job';
import type {
  CloneRepositoryError,
  FetchError,
  FetchPrForReviewError,
  PullError,
  PushError,
  SyncError,
} from './api/errors';
import type {
  CloneRepositoryJobInput,
  FetchJobInput,
  FetchPrForReviewJobInput,
  GitSyncProgress,
  GitTransferProgress,
  PublishBranchJobInput,
  PullJobInput,
  PushJobInput,
  SyncJobInput,
} from './api/jobs';
import type { GitRepositoryInfo } from './api/queries';
import type { IGitCheckout } from './checkout/types';
import { toGitCommandError } from './errors';
import type { IGitRepository } from './repository/types';
import type { IGitRuntime } from './types';

export type GitResourceAccessor = {
  repository(repositoryRoot: string): Promise<IGitRepository>;
  checkout(checkoutPath: string): Promise<IGitCheckout>;
};

export function createGitSessionJobs(runtime: IGitRuntime, resources: GitResourceAccessor) {
  const cloneRepository = new LiveJobServer<
    CloneRepositoryJobInput,
    GitTransferProgress,
    GitRepositoryInfo,
    CloneRepositoryError
  >(
    async (input, ctx) =>
      unwrap(
        await runtime.cloneRepository(input.repositoryUrl, input.targetPath, {
          signal: ctx.signal,
          onProgress: ctx.progress,
        })
      ),
    toJobError
  );

  const fetch = new LiveJobServer<FetchJobInput, GitTransferProgress, void, FetchError>(
    async (input, ctx) => {
      const repo = await resources.repository(input.repositoryRoot);
      return unwrap(
        await repo.fetch(input.remote, { signal: ctx.signal, onProgress: ctx.progress })
      );
    },
    toJobError
  );

  const publishBranch = new LiveJobServer<
    PublishBranchJobInput,
    GitTransferProgress,
    { output: string },
    PushError
  >(
    async (input, ctx) => {
      const repo = await resources.repository(input.repositoryRoot);
      return unwrap(
        await repo.publishBranch(input.branchName, input.remote, {
          signal: ctx.signal,
          onProgress: ctx.progress,
        })
      );
    },
    toJobError
  );

  const fetchPrForReview = new LiveJobServer<
    FetchPrForReviewJobInput,
    GitTransferProgress,
    void,
    FetchPrForReviewError
  >(
    async (input, ctx) => {
      const repo = await resources.repository(input.repositoryRoot);
      return unwrap(
        await repo.fetchPrForReview(input.options, {
          signal: ctx.signal,
          onProgress: ctx.progress,
        })
      );
    },
    toJobError
  );

  const push = new LiveJobServer<PushJobInput, GitTransferProgress, { output: string }, PushError>(
    async (input, ctx) => {
      const co = await resources.checkout(input.checkoutPath);
      return unwrap(
        await co.push(input.options, { signal: ctx.signal, onProgress: ctx.progress })
      );
    },
    toJobError
  );

  const pull = new LiveJobServer<PullJobInput, GitTransferProgress, { output: string }, PullError>(
    async (input, ctx) => {
      const co = await resources.checkout(input.checkoutPath);
      return unwrap(await co.pull({ signal: ctx.signal, onProgress: ctx.progress }));
    },
    toJobError
  );

  const sync = new LiveJobServer<SyncJobInput, GitSyncProgress, { output: string }, SyncError>(
    async (input, ctx) => {
      const co = await resources.checkout(input.checkoutPath);
      return unwrap(await co.sync({ signal: ctx.signal, onProgress: ctx.progress }));
    },
    toJobError
  );

  const servers = { cloneRepository, fetch, publishBranch, fetchPrForReview, push, pull, sync };
  return {
    ...servers,
    dispose() {
      for (const s of Object.values(servers)) s.dispose();
    },
  };
}

export type GitSessionJobs = ReturnType<typeof createGitSessionJobs>;

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.success) throw result.error;
  return result.data;
}

function toJobError<E>(error: unknown): E {
  if (error && typeof error === 'object' && 'type' in error) return error as E;
  return toGitCommandError(error) as E;
}
