import { gitRepositoryContract, type gitCheckoutContract } from '@emdash/core/git';
import type { CheckoutId, RepositoryId } from '../identity/types';
import type { GitEffect, GitEffectPlan } from './effects';

type RepositoryMutationOperation = Extract<
  keyof typeof gitRepositoryContract.model.mutations,
  string
>;
export type RepositoryOperation =
  | RepositoryMutationOperation
  | 'fetch'
  | 'publishBranch'
  | 'fetchPrForReview';

type CheckoutMutationOperation = Extract<keyof typeof gitCheckoutContract.model.mutations, string>;
export type CheckoutOperation = CheckoutMutationOperation | 'push' | 'pull' | 'sync';

export type GitOperation = RepositoryOperation | CheckoutOperation;

export type GitEffectContext = Readonly<{
  repositoryId: RepositoryId;
  checkoutId?: CheckoutId;
  activeCheckoutIds?: readonly CheckoutId[];
  paths?: 'all' | readonly string[];
}>;

export function effectPlanFor(
  operation: GitOperation,
  context: GitEffectContext,
  outcome: 'success' | 'failure'
): GitEffectPlan {
  const repository = repositoryEffects(context.repositoryId);
  if (isRepositoryOperation(operation)) {
    return repositoryPlan(operation, repository, context.activeCheckoutIds ?? [], outcome);
  }
  if (!context.checkoutId) throw new Error(`Checkout effect '${operation}' requires checkoutId`);
  return checkoutPlan(operation, repository, context.checkoutId, context.paths ?? 'all', outcome);
}

function repositoryPlan(
  operation: RepositoryOperation,
  repository: ReturnType<typeof repositoryEffects>,
  activeCheckoutIds: readonly CheckoutId[],
  outcome: 'success' | 'failure'
): GitEffectPlan {
  const checkoutHistory = activeCheckoutIds.flatMap((checkoutId): GitEffect[] => [
    { kind: 'checkout-status', checkoutId },
    { kind: 'checkout-head', checkoutId },
  ]);

  if (outcome === 'failure') {
    if (operation === 'fetch' || operation === 'fetchPrForReview') {
      return plan([], [repository.refs, repository.remotes], []);
    }
    return plan([], [], []);
  }

  switch (operation) {
    case 'createBranch':
    case 'deleteBranch':
    case 'renameBranch':
    case 'setUpstream':
    case 'createTag':
    case 'deleteTag':
      return plan([], [repository.refs], checkoutHistory);
    case 'addRemote':
    case 'removeRemote':
      return plan([], [repository.remotes, repository.refs], []);
    case 'stashDrop':
      return plan([], [repository.stashes], []);
    case 'addWorktree':
      return plan([], [repository.worktrees], [repository.refs]);
    case 'removeWorktree':
    case 'pruneWorktrees':
      return plan([], [repository.worktrees], []);
    case 'fetch':
      return plan([], [repository.refs], checkoutHistory);
    case 'publishBranch':
      return plan([], [], [repository.refs]);
    case 'fetchPrForReview':
      return plan([], [repository.refs, repository.remotes], checkoutHistory);
  }
}

function checkoutPlan(
  operation: CheckoutOperation,
  repository: ReturnType<typeof repositoryEffects>,
  checkoutId: CheckoutId,
  paths: 'all' | readonly string[],
  outcome: 'success' | 'failure'
): GitEffectPlan {
  const status: GitEffect = { kind: 'checkout-status', checkoutId };
  const head: GitEffect = { kind: 'checkout-head', checkoutId };
  const diff: GitEffect = { kind: 'file-diff', checkoutId, paths };

  if (outcome === 'failure') {
    if (isConflictOperation(operation)) return plan([], [status, head, diff], []);
    if (operation === 'pull' || operation === 'sync') {
      return plan([], [status, head, diff], [repository.refs]);
    }
    return plan([], [], []);
  }

  switch (operation) {
    case 'stage':
    case 'unstage':
    case 'stageAll':
    case 'unstageAll':
      return plan([status], [diff], []);
    case 'revert':
    case 'revertAll':
    case 'clean':
    case 'stageHunk':
    case 'unstageHunk':
    case 'discardHunk':
      return plan([], [status, diff], []);
    case 'commit':
    case 'switch':
    case 'reset':
    case 'merge':
    case 'mergeContinue':
    case 'mergeAbort':
    case 'rebase':
    case 'rebaseContinue':
    case 'rebaseAbort':
    case 'rebaseSkip':
    case 'cherryPick':
    case 'revertCommit':
      return plan([], [status, head, diff], [repository.refs]);
    case 'stashPush':
    case 'stashApply':
    case 'stashPop':
      return plan([], [status, diff], [repository.stashes]);
    case 'push':
      return plan([], [], [repository.refs]);
    case 'pull':
    case 'sync':
      return plan([], [status, head, diff], [repository.refs]);
  }
}

function repositoryEffects(repositoryId: RepositoryId) {
  return {
    refs: { kind: 'repository-refs', repositoryId } as const,
    remotes: { kind: 'repository-remotes', repositoryId } as const,
    stashes: { kind: 'repository-stashes', repositoryId } as const,
    worktrees: { kind: 'repository-worktrees', repositoryId } as const,
  };
}

function plan(
  settle: readonly GitEffect[],
  eager: readonly GitEffect[],
  background: readonly GitEffect[]
): GitEffectPlan {
  return { settle, eager, background };
}

function isRepositoryOperation(operation: GitOperation): operation is RepositoryOperation {
  return repositoryOperations.has(operation);
}

function isConflictOperation(operation: CheckoutOperation): boolean {
  return conflictOperations.has(operation);
}

const repositoryOperations = new Set<GitOperation>([
  ...(Object.keys(gitRepositoryContract.model.mutations) as RepositoryMutationOperation[]),
  'fetch',
  'publishBranch',
  'fetchPrForReview',
]);

const conflictOperations = new Set<CheckoutOperation>([
  'commit',
  'switch',
  'reset',
  'merge',
  'mergeContinue',
  'mergeAbort',
  'rebase',
  'rebaseContinue',
  'rebaseAbort',
  'rebaseSkip',
  'cherryPick',
  'revertCommit',
]);
