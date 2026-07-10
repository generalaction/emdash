import type { gitRepositoryContract, GitContract } from '@emdash/core/git';
import type { ContractImpl, LeasedLiveModelProvider } from '@emdash/wire';
import type { GitRuntime } from '../git-runtime';
import { withLease, withLeaseValue, toJobError } from './lease';

type RepositoryEndpoints = NonNullable<ContractImpl<GitContract>['repository']>;
type RepositoryModel = typeof gitRepositoryContract.model;

export function createRepositoryEndpoints(
  runtime: GitRuntime,
  model: LeasedLiveModelProvider<RepositoryModel>
): RepositoryEndpoints {
  return {
    model,
    listWorktrees: (input) =>
      withLeaseValue(runtime.acquireRepository(input), (handle) =>
        handle.query((repository) => repository.listWorktrees())
      ),
    getDefaultBranch: (input) =>
      withLeaseValue(runtime.acquireRepository(input), (handle) =>
        handle.query((repository) => repository.getDefaultBranch(input.remote))
      ),
    readBlobAtRef: (input) =>
      withLeaseValue(runtime.acquireRepository(input), (handle) =>
        handle.query((repository) => repository.readBlobAtRef(input.ref, input.filePath))
      ),
    fetch: {
      run: (input, context) =>
        withLease(runtime.acquireRepository(input), (handle) =>
          handle.runJob(
            'fetch',
            (repository) =>
              repository.fetch(input.remote, {
                signal: context.signal,
                onProgress: context.progress,
              }),
            { objectTransfer: true }
          )
        ),
      toError: toJobError,
    },
    publishBranch: {
      run: (input, context) =>
        withLease(runtime.acquireRepository(input), (handle) =>
          handle.runJob('publishBranch', (repository) =>
            repository.publishBranch(input.branchName, input.remote, {
              signal: context.signal,
              onProgress: context.progress,
            })
          )
        ),
      toError: toJobError,
    },
    fetchPrForReview: {
      run: (input, context) =>
        withLease(runtime.acquireRepository(input), (handle) =>
          handle.runJob(
            'fetchPrForReview',
            (repository) =>
              repository.fetchPrForReview(input.options, {
                signal: context.signal,
                onProgress: context.progress,
              }),
            { objectTransfer: true }
          )
        ),
      toError: toJobError,
    },
  };
}
