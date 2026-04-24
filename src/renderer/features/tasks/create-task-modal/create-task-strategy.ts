import type { CreateTaskStrategy } from '@shared/tasks';

type BranchLikeTaskStrategy = Extract<CreateTaskStrategy, { kind: 'new-branch' | 'no-worktree' }>;
type PullRequestTaskStrategy = Extract<CreateTaskStrategy, { kind: 'from-pull-request' }>;

export function resolveBranchLikeTaskStrategy(input: {
  isUnborn: boolean;
  createBranchAndWorktree: boolean;
  taskBranch: string;
  pushBranch: boolean;
}): BranchLikeTaskStrategy {
  if (input.isUnborn || !input.createBranchAndWorktree) {
    return { kind: 'no-worktree' };
  }

  return {
    kind: 'new-branch',
    taskBranch: input.taskBranch,
    pushBranch: input.pushBranch,
  };
}

export function resolvePullRequestTaskStrategy(input: {
  checkoutMode: 'checkout' | 'new-branch';
  prNumber: number;
  headBranch: string;
  headRepositoryUrl: string;
  isFork: boolean;
  taskBranch: string;
  pushBranch: boolean;
}): PullRequestTaskStrategy {
  if (input.checkoutMode === 'checkout') {
    return {
      kind: 'from-pull-request',
      prNumber: input.prNumber,
      headBranch: input.headBranch,
      headRepositoryUrl: input.headRepositoryUrl,
      isFork: input.isFork,
    };
  }

  return {
    kind: 'from-pull-request',
    prNumber: input.prNumber,
    headBranch: input.headBranch,
    headRepositoryUrl: input.headRepositoryUrl,
    isFork: input.isFork,
    taskBranch: input.taskBranch,
    pushBranch: input.pushBranch,
  };
}
