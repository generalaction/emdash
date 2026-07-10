import { gitRepositoryContract, type RepositorySelector } from '@emdash/core/git';
import {
  type GroupMutationEnvelope,
  MutationResultCache,
  type LeasedLiveModelProvider,
  type LiveMutationResult,
  type MutationData,
  type MutationError,
  type MutationInput,
} from '@emdash/wire';
import type { RepositoryHandle } from '../allocation/handles';
import type { GitRuntime } from '../git-runtime';
import {
  acquireHandleSource,
  liveResult,
  withHandleMutation,
  type UntypedMutationEnvelope,
} from './live-model-support';

type RepositoryModel = typeof gitRepositoryContract.model;
type RepositoryMutationName = Extract<keyof RepositoryModel['mutations'], string>;
type RepositoryMutationResult<Name extends RepositoryMutationName> = LiveMutationResult<
  MutationData<RepositoryModel['mutations'][Name]>,
  MutationError<RepositoryModel['mutations'][Name]>
>;

export function createRepositoryLiveModelProvider(
  runtime: GitRuntime,
  contract: RepositoryModel = gitRepositoryContract.model
): LeasedLiveModelProvider<RepositoryModel> {
  const cache = new MutationResultCache();
  return {
    kind: 'leasedLiveModelProvider',
    contract,
    acquireState(key, name) {
      return acquireHandleSource(runtime.acquireRepository(key), (handle) => handle.state(name));
    },
    async runMutation<Name extends RepositoryMutationName>(
      name: Name,
      envelope: GroupMutationEnvelope<RepositoryModel, Name>
    ): Promise<RepositoryMutationResult<Name>> {
      const execute = async (): Promise<LiveMutationResult<unknown, unknown>> =>
        withHandleMutation<RepositoryHandle, unknown, unknown>(
          runtime.acquireRepository(envelope.key),
          async (handle) => runRepositoryMutation(contract, handle, name, envelope)
        );
      const result = await cache.run<unknown, unknown>(envelope.mutationId, execute);
      return result as RepositoryMutationResult<Name>;
    },
    async dispose(): Promise<void> {
      cache.clear();
    },
  };
}

async function runRepositoryMutation(
  contract: RepositoryModel,
  handle: RepositoryHandle,
  name: RepositoryMutationName,
  envelope: UntypedMutationEnvelope<RepositorySelector>
) {
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
      return assertNever(name);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unknown repository mutation '${String(value)}'`);
}
