import type {
  OperationPredictedStage,
  OperationPrediction,
} from '@emdash/core/primitives/operations/api';

export type PredictionObservationRow = {
  observedStatus?: string | null;
  lastObservedAt?: string | null;
};

/**
 * Compiles the desktop's non-authoritative preview of a `removeWorktree` verb
 * from registry state. Rendered dimmed in the queued phase; the host's
 * expansion replaces it wholesale once the verb is accepted.
 */
export function compileRemoveWorktreePrediction(input: {
  now: number;
  workspacePath: string;
  branchName?: string;
  deleteBranch: boolean;
  observed?: PredictionObservationRow | null;
}): OperationPrediction {
  const observedPresent = input.observed?.observedStatus === 'present';
  const stages: OperationPredictedStage[] = [
    {
      id: 'kill-sessions',
      label: `Stop sessions under ${input.workspacePath}`,
      targetPath: input.workspacePath,
      basis: 'assumed',
    },
    {
      id: `remove-worktree:${input.workspacePath}`,
      label: `Remove worktree ${input.workspacePath}`,
      targetPath: input.workspacePath,
      basis: observedPresent ? 'registry' : 'assumed',
    },
  ];
  if (input.deleteBranch && input.branchName) {
    stages.push({
      id: `delete-branch:${input.branchName}`,
      label: `Delete branch ${input.branchName}`,
      basis: observedPresent ? 'registry' : 'assumed',
    });
  }
  return {
    compiledAt: input.now,
    observedAsOf: parseObservedAsOf(input.observed),
    stages,
  };
}

/**
 * Prediction for `createWorktree`: always assumed — the artifact does not
 * exist yet, so no registry row can vouch for the expansion.
 */
export function compileCreateWorktreePrediction(input: {
  now: number;
  workspacePath: string;
  branchName: string;
}): OperationPrediction {
  return {
    compiledAt: input.now,
    observedAsOf: null,
    stages: [
      {
        id: 'verify-repository',
        label: 'Verify repository',
        basis: 'assumed',
      },
      {
        id: `create-worktree:${input.workspacePath}`,
        label: `Create worktree ${input.workspacePath} on ${input.branchName}`,
        targetPath: input.workspacePath,
        basis: 'assumed',
      },
    ],
  };
}

export function compileRemoveRepositoryPrediction(input: {
  now: number;
  repoPath: string;
  worktrees: readonly { path: string; observed?: PredictionObservationRow | null }[];
}): OperationPrediction {
  const stages: OperationPredictedStage[] = [
    {
      id: 'kill-sessions',
      label: `Stop sessions under ${input.repoPath}`,
      targetPath: input.repoPath,
      basis: 'assumed',
    },
    ...input.worktrees.map(
      (worktree): OperationPredictedStage => ({
        id: `remove-worktree:${worktree.path}`,
        label: `Remove worktree ${worktree.path}`,
        targetPath: worktree.path,
        basis: worktree.observed?.observedStatus === 'present' ? 'registry' : 'assumed',
      })
    ),
    {
      id: `remove-repository:${input.repoPath}`,
      label: `Remove repository ${input.repoPath}`,
      targetPath: input.repoPath,
      basis: 'registry',
    },
  ];
  const observedAsOf = input.worktrees
    .map((worktree) => parseObservedAsOf(worktree.observed))
    .filter((value): value is number => value !== null)
    .reduce<number | null>(
      (oldest, value) => (oldest === null || value < oldest ? value : oldest),
      null
    );
  return { compiledAt: input.now, observedAsOf, stages };
}

function parseObservedAsOf(observed: PredictionObservationRow | null | undefined): number | null {
  if (!observed?.lastObservedAt) return null;
  const parsed = Date.parse(observed.lastObservedAt);
  return Number.isNaN(parsed) ? null : parsed;
}
