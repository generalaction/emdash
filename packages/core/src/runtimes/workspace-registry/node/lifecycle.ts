import type {
  CreateWorktreeInput,
  WorkspaceLifecycle,
  WorkspaceLifecycleStep,
  WorkspaceLifecycleStepId,
} from '../api/schemas';
import type { CreateWorktreeExecutionResult } from './create-worktree';

/**
 * Canonical display/storage order of lifecycle steps. Upserts keep the steps array
 * sorted by this order so the Activity timeline never needs to sort.
 */
export const LIFECYCLE_STEP_ORDER: readonly WorkspaceLifecycleStepId[] = [
  'adopt-worktree',
  'fetch-remote-base',
  'create-worktree',
  'copy-artifacts',
  'push-branch',
  'fetch-refs',
  'prepare',
  'setup',
  'run',
];

/** The steps the runtime replays when left pending/running (restart, next activation). */
export const BACKGROUND_STEP_IDS = ['copy-artifacts', 'push-branch', 'fetch-refs'] as const;
export type BackgroundStepId = (typeof BACKGROUND_STEP_IDS)[number];

/** Activation-script steps: reset wholesale at each activation, never accumulated. */
export const SCRIPT_STEP_IDS: ReadonlySet<WorkspaceLifecycleStepId> = new Set([
  'prepare',
  'setup',
  'run',
]);

export function getLifecycleStep(
  lifecycle: WorkspaceLifecycle | null,
  id: WorkspaceLifecycleStepId
): WorkspaceLifecycleStep | null {
  return lifecycle?.steps.find((step) => step.id === id) ?? null;
}

/** Replaces (or inserts, in canonical order) one step; never mutates the input. */
export function withLifecycleStep(
  lifecycle: WorkspaceLifecycle,
  step: WorkspaceLifecycleStep
): WorkspaceLifecycle {
  const existing = lifecycle.steps.some((entry) => entry.id === step.id);
  const steps = existing
    ? lifecycle.steps.map((entry) => (entry.id === step.id ? step : entry))
    : sortSteps([...lifecycle.steps, step]);
  return { ...lifecycle, steps };
}

export function sortSteps(steps: WorkspaceLifecycleStep[]): WorkspaceLifecycleStep[] {
  return [...steps].sort(
    (a, b) => LIFECYCLE_STEP_ORDER.indexOf(a.id) - LIFECYCLE_STEP_ORDER.indexOf(b.id)
  );
}

/** Pending/running steps are incomplete and replay; terminal statuses never re-run. */
export function isIncompleteStep(step: WorkspaceLifecycleStep | null): boolean {
  return step !== null && (step.status === 'pending' || step.status === 'running');
}

/**
 * Maps a foreground pipeline stage onto the lifecycle step it belongs to. Inspect,
 * add-worktree, and verify are all part of materializing the worktree; only an actual
 * base fetch surfaces as its own step.
 */
export function stepIdForStage(stage: string): WorkspaceLifecycleStepId {
  return stage === 'resolve-base' || stage === 'fetch-base' ? 'fetch-remote-base' : 'create-worktree';
}

export type CreationStageTimeline = Array<{ stage: string; at: number }>;

/**
 * Builds the durable lifecycle section for a settled foreground creation pipeline.
 * Conditional steps that never applied are absent: adopt and create are alternatives,
 * fetch-remote-base appears only when a base fetch actually ran, copy-artifacts only
 * for a freshly created worktree, push-branch only when a push was requested.
 */
export function buildCreationLifecycle(
  input: CreateWorktreeInput,
  result: CreateWorktreeExecutionResult,
  stages: CreationStageTimeline,
  now: number
): WorkspaceLifecycle {
  const stageAt = (stage: string): number | null =>
    stages.find((entry) => entry.stage === stage)?.at ?? null;
  const fetchedBase = stageAt('fetch-base') !== null;
  const steps: WorkspaceLifecycleStep[] = [];

  if (result.status === 'failed') {
    const failedStepId = stepIdForStage(result.stage);
    if (fetchedBase && failedStepId !== 'fetch-remote-base') {
      steps.push({
        id: 'fetch-remote-base',
        status: 'succeeded',
        startedAt: stageAt('fetch-base'),
        finishedAt: stageAt('add-worktree') ?? now,
        params: { base: input.baseRef },
      });
    }
    steps.push({
      id: failedStepId,
      status: 'failed',
      startedAt:
        failedStepId === 'fetch-remote-base'
          ? (stageAt('resolve-base') ?? stageAt('inspect'))
          : (stageAt('inspect') ?? now),
      finishedAt: now,
      message: result.message,
      params:
        failedStepId === 'fetch-remote-base'
          ? { base: input.baseRef }
          : { path: input.path, branch: input.branch },
    });
    return { steps, preservePatterns: input.preservePatterns };
  }

  if (!result.createdWorktree) {
    steps.push({
      id: 'adopt-worktree',
      status: 'succeeded',
      startedAt: stageAt('inspect') ?? now,
      finishedAt: now,
      params: { branch: input.branch, path: result.finalPath },
    });
  } else {
    if (fetchedBase) {
      steps.push({
        id: 'fetch-remote-base',
        status: 'succeeded',
        startedAt: stageAt('fetch-base'),
        finishedAt: stageAt('add-worktree') ?? now,
        params: { base: input.baseRef },
      });
    }
    steps.push({
      id: 'create-worktree',
      status: 'succeeded',
      startedAt: stageAt('add-worktree') ?? stageAt('inspect') ?? now,
      finishedAt: now,
      params: {
        path: result.finalPath,
        branch: input.branch,
        branchCreated: result.createdBranch,
      },
    });
    steps.push({
      id: 'copy-artifacts',
      status: 'pending',
      startedAt: null,
      finishedAt: null,
      params: {},
    });
  }

  if (input.pushBranch) {
    steps.push({
      id: 'push-branch',
      status: 'pending',
      startedAt: null,
      finishedAt: null,
      params: { branch: input.branch },
    });
  }
  steps.push({
    id: 'fetch-refs',
    status: 'pending',
    startedAt: null,
    finishedAt: null,
    params: { base: input.baseRef },
  });

  return { steps, preservePatterns: input.preservePatterns };
}
