import {
  gitCheckoutContract,
  gitRepositoryContract,
  type BoundFileDiffKey,
  type CheckoutSelector,
  type GitCommandError,
  type RepositorySelector,
} from '@emdash/core/git';
import {
  err,
  ok,
  toPendingLease,
  type Lease,
  type PendingLease,
  type Result,
} from '@emdash/shared';
import {
  MutationResultCache,
  type LeasedLiveModelProvider,
  type LiveCursorEntry,
  type LiveModelDef,
  type LiveMutationResult,
  type LiveSource,
  type MutationInput,
} from '@emdash/wire';
import type { GitRuntime } from '../git-runtime';
import type { CheckoutHandle, RepositoryHandle } from '../live/allocation-graph';
import type { GitExecution } from '../live/repository-mount';

type RepositoryModel = typeof gitRepositoryContract.model;
type CheckoutModel = typeof gitCheckoutContract.model;
type FileDiffModel = typeof gitCheckoutContract.fileDiff;

type UntypedEnvelope<Key> = { key: Key; input: unknown; mutationId: string };

export function createRepositoryLiveModelProvider(
  runtime: GitRuntime,
  contract: RepositoryModel = gitRepositoryContract.model
): LeasedLiveModelProvider<RepositoryModel> {
  const cache = new MutationResultCache();
  const provider = {
    kind: 'leasedLiveModelProvider' as const,
    contract,
    acquireState(key: RepositorySelector, name: string): PendingLease<LiveSource> {
      return acquireHandleSource(runtime.acquireRepository(key), (handle) =>
        handle.state(name as Parameters<RepositoryHandle['state']>[0])
      );
    },
    runMutation(name: string, envelope: UntypedEnvelope<RepositorySelector>) {
      return cache.run(envelope.mutationId, () =>
        withHandleMutation(runtime.acquireRepository(envelope.key), (handle) =>
          runRepositoryMutation(contract, handle, name, envelope)
        )
      );
    },
    async dispose(): Promise<void> {
      cache.clear();
    },
  };
  return provider as unknown as LeasedLiveModelProvider<RepositoryModel>;
}

export function createCheckoutLiveModelProvider(
  runtime: GitRuntime,
  contract: CheckoutModel = gitCheckoutContract.model
): LeasedLiveModelProvider<CheckoutModel> {
  const cache = new MutationResultCache();
  const provider = {
    kind: 'leasedLiveModelProvider' as const,
    contract,
    acquireState(key: CheckoutSelector, name: string): PendingLease<LiveSource> {
      return acquireHandleSource(runtime.acquireCheckout(key), (handle) =>
        handle.state(name as Parameters<CheckoutHandle['state']>[0])
      );
    },
    runMutation(name: string, envelope: UntypedEnvelope<CheckoutSelector>) {
      return cache.run(envelope.mutationId, () =>
        withHandleMutation(runtime.acquireCheckout(envelope.key), (handle) =>
          runCheckoutMutation(contract, handle, name, envelope)
        )
      );
    },
    async dispose(): Promise<void> {
      cache.clear();
    },
  };
  return provider as unknown as LeasedLiveModelProvider<CheckoutModel>;
}

export function createFileDiffLiveModelProvider(
  runtime: GitRuntime,
  contract: FileDiffModel = gitCheckoutContract.fileDiff
): LeasedLiveModelProvider<FileDiffModel> {
  const provider = {
    kind: 'leasedLiveModelProvider' as const,
    contract,
    acquireState(
      key: CheckoutSelector & BoundFileDiffKey,
      _name: string
    ): PendingLease<LiveSource> {
      const handleLease = runtime.acquireCheckout({ checkout: key.checkout });
      return toPendingLease(
        (async (): Promise<Lease<LiveSource>> => {
          try {
            const handle = await handleLease.ready();
            const stateLease = handle.acquireFileDiffStaleness({
              filePath: key.filePath,
              target: key.target,
            });
            try {
              const source = await stateLease.ready();
              return {
                value: source,
                release: async () => {
                  await stateLease.release();
                  await handleLease.release();
                },
              };
            } catch (error) {
              await stateLease.release();
              throw error;
            }
          } catch (error) {
            await handleLease.release();
            throw error;
          }
        })()
      );
    },
    async runMutation(): Promise<never> {
      throw new Error('git.checkout.fileDiff has no mutations');
    },
    async dispose(): Promise<void> {},
  };
  return provider as unknown as LeasedLiveModelProvider<FileDiffModel>;
}

async function runRepositoryMutation(
  contract: RepositoryModel,
  handle: RepositoryHandle,
  name: string,
  envelope: UntypedEnvelope<RepositorySelector>
): Promise<LiveMutationResult<unknown, unknown>> {
  const mutationId = envelope.mutationId;
  switch (name) {
    case 'createBranch': {
      const input = envelope.input as MutationInput<RepositoryModel['mutations']['createBranch']>;
      return liveResult(
        await handle.mutate(
          'createBranch',
          mutationId,
          (repository) => repository.createBranch(input.options),
          { objectTransfer: input.options.syncWithRemote === true }
        ),
        contract,
        envelope.key
      );
    }
    case 'deleteBranch': {
      const input = envelope.input as MutationInput<RepositoryModel['mutations']['deleteBranch']>;
      return liveResult(
        await handle.mutate('deleteBranch', mutationId, (repository) =>
          repository.deleteBranch(input.branch, input.force)
        ),
        contract,
        envelope.key
      );
    }
    case 'renameBranch': {
      const input = envelope.input as MutationInput<RepositoryModel['mutations']['renameBranch']>;
      return liveResult(
        await handle.mutate('renameBranch', mutationId, (repository) =>
          repository.renameBranch(input.oldName, input.newName)
        ),
        contract,
        envelope.key
      );
    }
    case 'setUpstream': {
      const input = envelope.input as MutationInput<RepositoryModel['mutations']['setUpstream']>;
      return liveResult(
        await handle.mutate('setUpstream', mutationId, (repository) =>
          repository.setUpstream(input.branch, input.upstream)
        ),
        contract,
        envelope.key
      );
    }
    case 'createTag': {
      const input = envelope.input as MutationInput<RepositoryModel['mutations']['createTag']>;
      return liveResult(
        await handle.mutate('createTag', mutationId, (repository) =>
          repository.createTag(input.options)
        ),
        contract,
        envelope.key
      );
    }
    case 'deleteTag': {
      const input = envelope.input as MutationInput<RepositoryModel['mutations']['deleteTag']>;
      return liveResult(
        await handle.mutate('deleteTag', mutationId, (repository) =>
          repository.deleteTag(input.name)
        ),
        contract,
        envelope.key
      );
    }
    case 'addRemote': {
      const input = envelope.input as MutationInput<RepositoryModel['mutations']['addRemote']>;
      return liveResult(
        await handle.mutate('addRemote', mutationId, (repository) =>
          repository.addRemote(input.name, input.url)
        ),
        contract,
        envelope.key
      );
    }
    case 'removeRemote': {
      const input = envelope.input as MutationInput<RepositoryModel['mutations']['removeRemote']>;
      return liveResult(
        await handle.mutate('removeRemote', mutationId, (repository) =>
          repository.removeRemote(input.name)
        ),
        contract,
        envelope.key
      );
    }
    case 'stashDrop': {
      const input = envelope.input as MutationInput<RepositoryModel['mutations']['stashDrop']>;
      return liveResult(
        await handle.mutate('stashDrop', mutationId, (repository) =>
          repository.stashDrop(input.stashIndex)
        ),
        contract,
        envelope.key
      );
    }
    case 'addWorktree': {
      const input = envelope.input as MutationInput<RepositoryModel['mutations']['addWorktree']>;
      return liveResult(
        await handle.mutate('addWorktree', mutationId, (repository) =>
          repository.addWorktree(input.options)
        ),
        contract,
        envelope.key
      );
    }
    case 'removeWorktree': {
      const input = envelope.input as MutationInput<RepositoryModel['mutations']['removeWorktree']>;
      return liveResult(
        await handle.mutate('removeWorktree', mutationId, (repository) =>
          repository.removeWorktree(input.worktreePath, input.force)
        ),
        contract,
        envelope.key
      );
    }
    case 'pruneWorktrees':
      return liveResult(
        await handle.mutate('pruneWorktrees', mutationId, (repository) =>
          repository.pruneWorktrees()
        ),
        contract,
        envelope.key
      );
    default:
      throw new Error(`Unknown repository mutation '${name}'`);
  }
}

async function runCheckoutMutation(
  contract: CheckoutModel,
  handle: CheckoutHandle,
  name: string,
  envelope: UntypedEnvelope<CheckoutSelector>
): Promise<LiveMutationResult<unknown, unknown>> {
  const mutationId = envelope.mutationId;
  switch (name) {
    case 'stage': {
      const input = envelope.input as MutationInput<CheckoutModel['mutations']['stage']>;
      return checkoutResult(
        handle,
        contract,
        envelope.key,
        'stage',
        input.paths,
        mutationId,
        (git) => git.stage(input.paths)
      );
    }
    case 'unstage': {
      const input = envelope.input as MutationInput<CheckoutModel['mutations']['unstage']>;
      return checkoutResult(
        handle,
        contract,
        envelope.key,
        'unstage',
        input.paths,
        mutationId,
        (git) => git.unstage(input.paths)
      );
    }
    case 'stageAll':
      return checkoutResult(handle, contract, envelope.key, 'stageAll', 'all', mutationId, (git) =>
        git.stageAll()
      );
    case 'unstageAll':
      return checkoutResult(
        handle,
        contract,
        envelope.key,
        'unstageAll',
        'all',
        mutationId,
        (git) => git.unstageAll()
      );
    case 'revert': {
      const input = envelope.input as MutationInput<CheckoutModel['mutations']['revert']>;
      return checkoutResult(
        handle,
        contract,
        envelope.key,
        'revert',
        input.paths,
        mutationId,
        (git) => git.revert(input.paths)
      );
    }
    case 'revertAll':
      return checkoutResult(handle, contract, envelope.key, 'revertAll', 'all', mutationId, (git) =>
        git.revertAll()
      );
    case 'clean': {
      const input = envelope.input as MutationInput<CheckoutModel['mutations']['clean']>;
      return checkoutResult(
        handle,
        contract,
        envelope.key,
        'clean',
        input.paths ?? 'all',
        mutationId,
        (git) => git.clean({ paths: input.paths, force: input.force })
      );
    }
    case 'stageHunk':
    case 'unstageHunk':
    case 'discardHunk': {
      const input = envelope.input as MutationInput<CheckoutModel['mutations']['stageHunk']>;
      return checkoutResult(handle, contract, envelope.key, name, [input.path], mutationId, (git) =>
        git[name](input.path, input.hunkHeader)
      );
    }
    case 'commit': {
      const input = envelope.input as MutationInput<CheckoutModel['mutations']['commit']>;
      return checkoutResult(handle, contract, envelope.key, 'commit', 'all', mutationId, (git) =>
        git.commit(input.message, input.options)
      );
    }
    case 'switch': {
      const input = envelope.input as MutationInput<CheckoutModel['mutations']['switch']>;
      return checkoutResult(handle, contract, envelope.key, 'switch', 'all', mutationId, (git) =>
        git.switch(input.options)
      );
    }
    case 'reset': {
      const input = envelope.input as MutationInput<CheckoutModel['mutations']['reset']>;
      return checkoutResult(handle, contract, envelope.key, 'reset', 'all', mutationId, (git) =>
        git.reset(input.ref, input.mode)
      );
    }
    case 'merge': {
      const input = envelope.input as MutationInput<CheckoutModel['mutations']['merge']>;
      return checkoutResult(handle, contract, envelope.key, 'merge', 'all', mutationId, (git) =>
        git.merge(input.options)
      );
    }
    case 'mergeContinue': {
      const input = envelope.input as MutationInput<CheckoutModel['mutations']['mergeContinue']>;
      return checkoutResult(
        handle,
        contract,
        envelope.key,
        'mergeContinue',
        'all',
        mutationId,
        (git) => git.mergeContinue(input.message)
      );
    }
    case 'mergeAbort':
      return checkoutResult(
        handle,
        contract,
        envelope.key,
        'mergeAbort',
        'all',
        mutationId,
        (git) => git.mergeAbort()
      );
    case 'rebase': {
      const input = envelope.input as MutationInput<CheckoutModel['mutations']['rebase']>;
      return checkoutResult(handle, contract, envelope.key, 'rebase', 'all', mutationId, (git) =>
        git.rebase(input.options)
      );
    }
    case 'rebaseContinue':
      return checkoutResult(
        handle,
        contract,
        envelope.key,
        'rebaseContinue',
        'all',
        mutationId,
        (git) => git.rebaseContinue()
      );
    case 'rebaseAbort':
      return checkoutResult(
        handle,
        contract,
        envelope.key,
        'rebaseAbort',
        'all',
        mutationId,
        (git) => git.rebaseAbort()
      );
    case 'rebaseSkip':
      return checkoutResult(
        handle,
        contract,
        envelope.key,
        'rebaseSkip',
        'all',
        mutationId,
        (git) => git.rebaseSkip()
      );
    case 'cherryPick': {
      const input = envelope.input as MutationInput<CheckoutModel['mutations']['cherryPick']>;
      return checkoutResult(
        handle,
        contract,
        envelope.key,
        'cherryPick',
        'all',
        mutationId,
        (git) => git.cherryPick(input.commits, input.noCommit)
      );
    }
    case 'revertCommit': {
      const input = envelope.input as MutationInput<CheckoutModel['mutations']['revertCommit']>;
      return checkoutResult(
        handle,
        contract,
        envelope.key,
        'revertCommit',
        'all',
        mutationId,
        (git) => git.revertCommit(input.commit, input.noCommit)
      );
    }
    case 'stashPush': {
      const input = envelope.input as MutationInput<CheckoutModel['mutations']['stashPush']>;
      return checkoutResult(handle, contract, envelope.key, 'stashPush', 'all', mutationId, (git) =>
        git.stashPush(input.options)
      );
    }
    case 'stashApply': {
      const input = envelope.input as MutationInput<CheckoutModel['mutations']['stashApply']>;
      return checkoutResult(
        handle,
        contract,
        envelope.key,
        'stashApply',
        'all',
        mutationId,
        (git) => git.stashApply(input.stashIndex)
      );
    }
    case 'stashPop': {
      const input = envelope.input as MutationInput<CheckoutModel['mutations']['stashPop']>;
      return checkoutResult(handle, contract, envelope.key, 'stashPop', 'all', mutationId, (git) =>
        git.stashPop(input.stashIndex)
      );
    }
    default:
      throw new Error(`Unknown checkout mutation '${name}'`);
  }
}

async function checkoutResult<T, E>(
  handle: CheckoutHandle,
  contract: CheckoutModel,
  key: CheckoutSelector,
  operation: Parameters<CheckoutHandle['mutate']>[0],
  paths: 'all' | readonly string[],
  mutationId: string,
  run: (checkout: Parameters<Parameters<CheckoutHandle['mutate']>[3]>[0]) => Promise<Result<T, E>>
): Promise<LiveMutationResult<T, E>> {
  return liveResult(await handle.mutate(operation, paths, mutationId, run), contract, key);
}

function liveResult<T, E>(
  execution: GitExecution<T, E>,
  contract: LiveModelDef,
  key: unknown
): LiveMutationResult<T, E> {
  if (!execution.result.success) return err(execution.result.error);
  const cursors: LiveCursorEntry[] = [];
  for (const settled of execution.settled) {
    const state = contract.states[settled.name];
    if (!state) continue;
    cursors.push({ model: state.id, key, cursor: settled.cursor });
  }
  return ok({ data: execution.result.data, cursors });
}

function acquireHandleSource<T>(
  handleLease: PendingLease<T>,
  source: (handle: T) => Promise<LiveSource>
): PendingLease<LiveSource> {
  return toPendingLease(
    (async (): Promise<Lease<LiveSource>> => {
      try {
        const handle = await handleLease.ready();
        return { value: await source(handle), release: () => handleLease.release() };
      } catch (error) {
        await handleLease.release();
        throw error;
      }
    })()
  );
}

async function withHandleMutation<T, D, E>(
  lease: PendingLease<T>,
  run: (handle: T) => Promise<LiveMutationResult<D, E>>
): Promise<LiveMutationResult<D, E | GitCommandError>> {
  try {
    return await run(await lease.ready());
  } catch (error) {
    return err(toGitError(error));
  } finally {
    await lease.release();
  }
}

function toGitError(error: unknown): GitCommandError {
  if (error && typeof error === 'object' && 'resolution' in error) {
    const resolution = (error as { resolution?: { message?: unknown } }).resolution;
    if (typeof resolution?.message === 'string') {
      return { type: 'git_error', message: resolution.message };
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return { type: 'git_error', message };
}
