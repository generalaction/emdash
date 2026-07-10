import { gitCheckoutContract, type CheckoutSelector } from '@emdash/core/git';
import type { Result } from '@emdash/shared';
import {
  type GroupMutationEnvelope,
  MutationResultCache,
  type LeasedLiveModelProvider,
  type LiveMutationResult,
  type MutationData,
  type MutationError,
  type MutationInput,
} from '@emdash/wire';
import type { CheckoutHandle } from '../allocation/handles';
import type { GitRuntime } from '../git-runtime';
import {
  acquireHandleSource,
  liveResult,
  withHandleMutation,
  type UntypedMutationEnvelope,
} from './live-model-support';

type CheckoutModel = typeof gitCheckoutContract.model;
type CheckoutMutationName = Extract<keyof CheckoutModel['mutations'], string>;
type CheckoutMutationResult<Name extends CheckoutMutationName> = LiveMutationResult<
  MutationData<CheckoutModel['mutations'][Name]>,
  MutationError<CheckoutModel['mutations'][Name]>
>;

export function createCheckoutLiveModelProvider(
  runtime: GitRuntime,
  contract: CheckoutModel = gitCheckoutContract.model
): LeasedLiveModelProvider<CheckoutModel> {
  const cache = new MutationResultCache();
  return {
    kind: 'leasedLiveModelProvider',
    contract,
    acquireState(key, name) {
      return acquireHandleSource(runtime.acquireCheckout(key), (handle) => handle.state(name));
    },
    async runMutation<Name extends CheckoutMutationName>(
      name: Name,
      envelope: GroupMutationEnvelope<CheckoutModel, Name>
    ): Promise<CheckoutMutationResult<Name>> {
      const execute = async (): Promise<LiveMutationResult<unknown, unknown>> =>
        withHandleMutation<CheckoutHandle, unknown, unknown>(
          runtime.acquireCheckout(envelope.key),
          async (handle) => runCheckoutMutation(contract, handle, name, envelope)
        );
      const result = await cache.run<unknown, unknown>(envelope.mutationId, execute);
      return result as CheckoutMutationResult<Name>;
    },
    async dispose(): Promise<void> {
      cache.clear();
    },
  };
}

async function runCheckoutMutation(
  contract: CheckoutModel,
  handle: CheckoutHandle,
  name: CheckoutMutationName,
  envelope: UntypedMutationEnvelope<CheckoutSelector>
) {
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
      return assertNever(name);
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

function assertNever(value: never): never {
  throw new Error(`Unknown checkout mutation '${String(value)}'`);
}
