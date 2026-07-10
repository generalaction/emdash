import {
  denormalizeDiffTarget,
  gitContract,
  toGitCommandError,
  type FetchError,
  type FetchPrForReviewError,
  type GitCommandError,
  type GitContract,
  type PullError,
  type PushError,
  type SyncError,
} from '@emdash/core/git';
import { err, ok, type PendingLease, type Result } from '@emdash/shared';
import type { ContractImpl } from '@emdash/wire';
import type { GitRuntime } from '../git-runtime';
import type { CheckoutHandle, RepositoryHandle } from '../live/allocation-graph';
import {
  createCheckoutLiveModelProvider,
  createFileDiffLiveModelProvider,
  createRepositoryLiveModelProvider,
} from './live-model-provider';

/** Thin transport adapter. Lease ownership follows each state, call, mutation, and job lifetime. */
export class GitWireAdapter {
  readonly implementation: ContractImpl<GitContract>;

  private readonly repositoryProvider;
  private readonly checkoutProvider;
  private readonly fileDiffProvider;

  constructor(runtime: GitRuntime, contract: GitContract = gitContract) {
    this.repositoryProvider = createRepositoryLiveModelProvider(runtime, contract.repository.model);
    this.checkoutProvider = createCheckoutLiveModelProvider(runtime, contract.checkout.model);
    this.fileDiffProvider = createFileDiffLiveModelProvider(runtime, contract.checkout.fileDiff);

    this.implementation = {
      inspectPath: (input) => runtime.provisioner.inspectPath(input.path),
      ensureRepository: (input) => runtime.provisioner.ensureRepository(input.path, input.options),
      cloneRepository: {
        run: (input, context) =>
          runtime.provisioner.cloneRepository(input.repositoryUrl, input.targetPath, {
            signal: context.signal,
            onProgress: context.progress,
          }),
        toError: toJobError,
      },
      repository: {
        model: this.repositoryProvider,
        listWorktrees: (input) =>
          withRepositoryValue(runtime, input, (handle) =>
            handle.query((repository) => repository.listWorktrees())
          ),
        getDefaultBranch: (input) =>
          withRepositoryValue(runtime, input, (handle) =>
            handle.query((repository) => repository.getDefaultBranch(input.remote))
          ),
        readBlobAtRef: (input) =>
          withRepositoryValue(runtime, input, (handle) =>
            handle.query((repository) => repository.readBlobAtRef(input.ref, input.filePath))
          ),
        fetch: {
          run: (input, context) =>
            withRepositoryJob<void, FetchError>(runtime, input, (handle) =>
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
            withRepositoryJob<{ output: string }, PushError>(runtime, input, (handle) =>
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
            withRepositoryJob<void, FetchPrForReviewError>(runtime, input, (handle) =>
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
      },
      checkout: {
        model: this.checkoutProvider,
        fileDiff: this.fileDiffProvider,
        getFileDiff: (input) =>
          withCheckoutResult(runtime, input, (handle) =>
            handle.query((checkout) =>
              checkout.getFileDiff(
                input.path,
                input.target ? denormalizeDiffTarget(input.target) : undefined
              )
            )
          ),
        getChangedFiles: (input) =>
          withCheckoutValue(runtime, input, (handle) =>
            handle.query((checkout) =>
              checkout.getChangedFiles(denormalizeDiffTarget(input.target))
            )
          ),
        getConflictVersions: (input) =>
          withCheckoutResult(runtime, input, (handle) =>
            handle.query((checkout) => checkout.getConflictVersions(input.path))
          ),
        getFileAtRef: (input) =>
          withCheckoutValue(runtime, input, (handle) =>
            handle.query((checkout) => checkout.getFileAtRef(input.filePath, input.ref))
          ),
        getFileAtIndex: (input) =>
          withCheckoutValue(runtime, input, (handle) =>
            handle.query((checkout) => checkout.getFileAtIndex(input.filePath))
          ),
        getImageAtRef: (input) =>
          withCheckoutValue(runtime, input, (handle) =>
            handle.query((checkout) => checkout.getImageAtRef(input.filePath, input.ref))
          ),
        getImageAtIndex: (input) =>
          withCheckoutValue(runtime, input, (handle) =>
            handle.query((checkout) => checkout.getImageAtIndex(input.filePath))
          ),
        getLog: (input) =>
          withCheckoutValue(runtime, input, (handle) =>
            handle.query((checkout) => checkout.getLog(input.options))
          ),
        getCommit: (input) =>
          withCheckoutValue(runtime, input, (handle) =>
            handle.query((checkout) => checkout.getCommit(input.hash))
          ),
        getCommitFiles: (input) =>
          withCheckoutValue(runtime, input, (handle) =>
            handle.query((checkout) => checkout.getCommitFiles(input.hash))
          ),
        blame: (input) =>
          withCheckoutResult(runtime, input, (handle) =>
            handle.query((checkout) => checkout.blame(input.path, input.ref))
          ),
        push: {
          run: (input, context) =>
            withCheckoutJob<{ output: string }, PushError>(runtime, input, (handle) =>
              handle.runJob('push', (checkout) =>
                checkout.push(input.options, {
                  signal: context.signal,
                  onProgress: context.progress,
                })
              )
            ),
          toError: toJobError,
        },
        pull: {
          run: (input, context) =>
            withCheckoutJob<{ output: string }, PullError>(runtime, input, (handle) =>
              handle.runJob(
                'pull',
                (checkout) =>
                  checkout.pull({ signal: context.signal, onProgress: context.progress }),
                { objectTransfer: true }
              )
            ),
          toError: toJobError,
        },
        sync: {
          run: (input, context) =>
            withCheckoutJob<{ output: string }, SyncError>(runtime, input, (handle) =>
              handle.runJob(
                'sync',
                (checkout) =>
                  checkout.sync({ signal: context.signal, onProgress: context.progress }),
                { objectTransfer: true }
              )
            ),
          toError: toJobError,
        },
      },
    };
  }

  async dispose(): Promise<void> {
    await Promise.all([
      this.repositoryProvider.dispose(),
      this.checkoutProvider.dispose(),
      this.fileDiffProvider.dispose(),
    ]);
  }
}

async function withRepositoryValue<T>(
  runtime: GitRuntime,
  selector: { repository: { path: string } },
  run: (handle: RepositoryHandle) => Promise<T>
): Promise<Result<T, GitCommandError>> {
  return withLeaseValue(runtime.acquireRepository({ repository: selector.repository }), run);
}

async function withCheckoutValue<T>(
  runtime: GitRuntime,
  selector: { checkout: { path: string } },
  run: (handle: CheckoutHandle) => Promise<T>
): Promise<Result<T, GitCommandError>> {
  return withLeaseValue(runtime.acquireCheckout({ checkout: selector.checkout }), run);
}

async function withCheckoutResult<T>(
  runtime: GitRuntime,
  selector: { checkout: { path: string } },
  run: (handle: CheckoutHandle) => Promise<Result<T, GitCommandError>>
): Promise<Result<T, GitCommandError>> {
  const lease = runtime.acquireCheckout({ checkout: selector.checkout });
  try {
    return await run(await lease.ready());
  } catch (error) {
    return err(toGitCommandError(error));
  } finally {
    await lease.release();
  }
}

async function withLeaseValue<T, Handle>(
  lease: PendingLease<Handle>,
  run: (handle: Handle) => Promise<T>
): Promise<Result<T, GitCommandError>> {
  try {
    return ok(await run(await lease.ready()));
  } catch (error) {
    return err(toGitCommandError(error));
  } finally {
    await lease.release();
  }
}

async function withRepositoryJob<T, E>(
  runtime: GitRuntime,
  selector: { repository: { path: string } },
  run: (handle: RepositoryHandle) => Promise<Result<T, E>>
): Promise<Result<T, E>> {
  return withJobLease(runtime.acquireRepository({ repository: selector.repository }), run);
}

async function withCheckoutJob<T, E>(
  runtime: GitRuntime,
  selector: { checkout: { path: string } },
  run: (handle: CheckoutHandle) => Promise<Result<T, E>>
): Promise<Result<T, E>> {
  return withJobLease(runtime.acquireCheckout({ checkout: selector.checkout }), run);
}

async function withJobLease<T, E, Handle>(
  lease: PendingLease<Handle>,
  run: (handle: Handle) => Promise<Result<T, E>>
): Promise<Result<T, E>> {
  try {
    return await run(await lease.ready());
  } catch (error) {
    return err(toGitCommandError(error) as E);
  } finally {
    await lease.release();
  }
}

function toJobError<E>(error: unknown): E {
  if (error && typeof error === 'object' && 'type' in error) return error as E;
  return toGitCommandError(error) as E;
}
