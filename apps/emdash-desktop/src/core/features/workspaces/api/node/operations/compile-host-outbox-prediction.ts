import { expandOperationStagePlan } from '@emdash/core/primitives/operations/api';
import type {
  OperationPredictedStage,
  OperationPrediction,
} from '@emdash/core/primitives/operations/api';
import {
  createWorktreeStagePlan,
  removeRepositoryStagePlan,
  removeWorktreeStagePlan,
} from '@emdash/core/runtimes/workspace-host/api';

export type PredictionObservationRow = {
  observedStatus?: string | null;
  lastObservedAt?: string | null;
};

export function compileRemoveWorktreePrediction(input: {
  now: number;
  workspacePath: string;
  branchName?: string;
  deleteBranch: boolean;
  teardownScript?: string;
  observed?: PredictionObservationRow | null;
}): OperationPrediction {
  const observedPresent = input.observed?.observedStatus === 'present';
  const stages = expandOperationStagePlan(removeWorktreeStagePlan, {
    workspacePath: input.workspacePath,
    deleteBranch: input.deleteBranch,
    branchName: input.branchName,
    teardownScript: input.teardownScript,
  }).map(
    (stage): OperationPredictedStage => ({
      id: stage.id,
      label: stage.label,
      targetPath: stage.targetPath,
      basis: stage.executor === 'kill-sessions' || !observedPresent ? 'assumed' : 'registry',
    })
  );
  return {
    compiledAt: input.now,
    observedAsOf: parseObservedAsOf(input.observed),
    stages,
  };
}

/** A create preview assumes the target does not exist; host inspection remains authoritative. */
export function compileCreateWorktreePrediction(input: {
  now: number;
  workspacePath: string;
  branchName: string;
  fetch?: boolean;
  preservePatterns?: readonly string[];
}): OperationPrediction {
  const stages = expandOperationStagePlan(createWorktreeStagePlan, {
    workspacePath: input.workspacePath,
    fetch: input.fetch ?? false,
    existing: false,
    preservePatterns: input.preservePatterns ?? [],
  }).map(
    (stage): OperationPredictedStage => ({
      id: stage.id,
      label: stage.label,
      targetPath: stage.targetPath,
      basis: 'assumed',
    })
  );
  return { compiledAt: input.now, observedAsOf: null, stages };
}

export function compileRemoveRepositoryPrediction(input: {
  now: number;
  repoPath: string;
  worktrees: readonly { path: string; observed?: PredictionObservationRow | null }[];
}): OperationPrediction {
  const observationByPath = new Map(input.worktrees.map((row) => [row.path, row.observed]));
  const stages = expandOperationStagePlan(removeRepositoryStagePlan, {
    repoPath: input.repoPath,
    worktreePaths: input.worktrees.map((row) => row.path),
    repositoryMissing: false,
  }).map(
    (stage): OperationPredictedStage => ({
      id: stage.id,
      label: stage.label,
      targetPath: stage.targetPath,
      basis:
        stage.executor === 'remove-repository' ||
        (stage.executor === 'remove-worktree' &&
          observationByPath.get(stage.targetPath ?? '')?.observedStatus === 'present')
          ? 'registry'
          : 'assumed',
    })
  );
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
