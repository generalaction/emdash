import { err, ok, type Result } from '@main/lib/result';
import {
  loopPhaseHandoffSchema,
  loopPhaseRetryHandoffSchema,
  loopPhaseStateInputSchema,
  loopPhaseStateV2Schema,
  loopStageResultSchema,
  type LoopPhaseHandoff,
  type LoopPhaseRetryHandoff,
  type LoopPhaseState,
  type LoopStageResult,
} from '@shared/core/loops/loop-phase-state';
import {
  loopCommitSchema,
  loopSessionAttemptSchema,
  loopSessionTargetSchema,
  loopStateV1Schema,
  loopVerificationWorkspaceStateSchema,
  type LoopSessionAttempt,
  type LoopSessionTarget,
  type LoopState,
  type LoopVerificationWorkspaceState,
} from '@shared/core/loops/loop-state';

export type E2EProgressError = {
  type?: string;
  kind?: string;
  message: string;
};

export type E2EDurableProgress = {
  loopState: LoopState;
  phaseState: LoopPhaseState | null;
};

export type E2EProgressTransition =
  | {
      kind: 'workspace';
      verification: LoopVerificationWorkspaceState | null;
    }
  | {
      kind: 'session-attempt';
      previous?: LoopSessionAttempt;
      next: LoopSessionAttempt;
    }
  | {
      kind: 'checkpoint-advanced';
      previousHead: string;
      featureHead: string;
      completedAttempt: LoopSessionAttempt;
      retryHandoffs: readonly LoopPhaseRetryHandoff[];
    }
  | {
      kind: 'retry-handoffs';
      checkpointCommit: string;
      retryHandoffs: readonly LoopPhaseRetryHandoff[];
    }
  | {
      kind: 'terminal';
      checkpointCommit: string;
      handoff: LoopPhaseHandoff | null;
      result: LoopStageResult;
    };

export type E2EProgressPort = {
  /** Compare-and-swap both durable states in one transaction, then return the committed value. */
  commit(input: {
    loopId: string;
    phaseId: string;
    expected: E2EDurableProgress;
    transition: E2EProgressTransition;
  }): Promise<Result<E2EDurableProgress, E2EProgressError>>;
};

export function copyE2EDurableProgress(progress: E2EDurableProgress): E2EDurableProgress {
  return {
    loopState: loopStateV1Schema.parse(progress.loopState),
    phaseState:
      progress.phaseState === null ? null : loopPhaseStateInputSchema.parse(progress.phaseState),
  };
}

export function sameE2EDurableProgress(
  left: E2EDurableProgress,
  right: E2EDurableProgress
): boolean {
  try {
    return (
      JSON.stringify(copyE2EDurableProgress(left)) === JSON.stringify(copyE2EDurableProgress(right))
    );
  } catch {
    return false;
  }
}

/** Lane E owns the transition rules; persistence adapters only perform transactional CAS I/O. */
export function reduceE2EProgress(
  expected: E2EDurableProgress,
  transition: E2EProgressTransition
): Result<E2EDurableProgress, E2EProgressError> {
  try {
    const copied = copyE2EDurableProgress(expected);
    const validated = parseProgress(copied);
    if (!validated.success) return validated;
    const current = validated.data;
    switch (transition.kind) {
      case 'workspace': {
        const verification =
          transition.verification === null
            ? null
            : loopVerificationWorkspaceStateSchema.parse(transition.verification);
        const workspaceError = validateWorkspaceTransition(current, verification);
        if (workspaceError) return invalid(workspaceError);
        return parseProgress({
          loopState: { ...current.loopState, verification },
          phaseState: current.phaseState,
        });
      }
      case 'session-attempt': {
        const next = loopSessionAttemptSchema.parse(transition.next);
        const attempts = [...current.loopState.sessionAttempts];
        if (transition.previous === undefined) {
          if (
            attempts.some(
              (attempt) =>
                attempt.attemptId === next.attemptId ||
                attempt.conversationId === next.conversationId
            )
          ) {
            return invalid('A session-attempt append must use fresh durable identities.');
          }
          attempts.push(next);
        } else {
          const previous = loopSessionAttemptSchema.parse(transition.previous);
          const index = attempts.findIndex(
            (attempt) =>
              attempt.attemptId === previous.attemptId &&
              attempt.conversationId === previous.conversationId
          );
          if (
            index < 0 ||
            JSON.stringify(attempts[index]) !== JSON.stringify(previous) ||
            !validAttemptReplacement(previous, next)
          ) {
            return invalid('A session-attempt replacement must match its exact prior value.');
          }
          attempts[index] = next;
        }
        return parseProgress({
          loopState: { ...current.loopState, sessionAttempts: attempts },
          phaseState: current.phaseState,
        });
      }
      case 'checkpoint-advanced': {
        if (
          !loopCommitSchema.safeParse(transition.previousHead).success ||
          !loopCommitSchema.safeParse(transition.featureHead).success ||
          current.loopState.expectedFeatureHead !== transition.previousHead ||
          current.loopState.checkpointCommit !== transition.previousHead ||
          transition.featureHead === transition.previousHead
        ) {
          return invalid('Checkpoint advancement does not match current durable authority.');
        }
        const completed = loopSessionAttemptSchema.parse(transition.completedAttempt);
        const retryHandoffs = parseRetryHandoffs(transition.retryHandoffs);
        const verification = current.loopState.verification;
        if (
          completed.status !== 'completed' ||
          completed.checkpointBefore !== transition.previousHead ||
          completed.checkpointAfter !== transition.featureHead ||
          completed.finishedAt === undefined ||
          completed.purpose !== 'e2e' ||
          completed.phaseId === undefined ||
          verification === null ||
          verification.status !== 'integrating-fix' ||
          completed.verificationRunId !== verification.verificationRunId ||
          verification.target === undefined ||
          !sameTarget(completed.target, verification.target)
        ) {
          return invalid('Checkpoint advancement requires its exact completed E2E attempt.');
        }
        const phaseState = phaseForCheckpoint(current.phaseState, transition.previousHead);
        if (phaseState.result !== null) {
          return invalid('A terminal phase cannot advance its checkpoint.');
        }
        if (!retainsRetryHandoffs(phaseState.retryHandoffs, retryHandoffs, true)) {
          return invalid('Checkpoint advancement cannot truncate or replace retry handoffs.');
        }
        const attempts = [...current.loopState.sessionAttempts];
        const index = attempts.findIndex(
          (attempt) =>
            attempt.attemptId === completed.attemptId &&
            attempt.conversationId === completed.conversationId
        );
        if (index < 0) {
          if (
            attempts.some(
              (attempt) =>
                attempt.attemptId === completed.attemptId ||
                attempt.conversationId === completed.conversationId
            )
          ) {
            return invalid('Checkpoint advancement collided with durable session identity.');
          }
          attempts.push(completed);
        } else {
          const previous = attempts[index];
          if (!previous || !validAttemptReplacement(previous, completed, true)) {
            return invalid('Checkpoint advancement cannot replace stale session authority.');
          }
          attempts[index] = completed;
        }
        return parseProgress({
          loopState: {
            ...current.loopState,
            expectedFeatureHead: transition.featureHead,
            checkpointCommit: transition.featureHead,
            sessionAttempts: attempts,
            verification: {
              ...verification,
              expectedFeatureHead: transition.featureHead,
            },
          },
          phaseState: {
            ...phaseState,
            checkpointCommit: transition.featureHead,
            retryHandoffs,
          },
        });
      }
      case 'retry-handoffs': {
        if (
          !loopCommitSchema.safeParse(transition.checkpointCommit).success ||
          current.loopState.expectedFeatureHead !== transition.checkpointCommit ||
          current.loopState.checkpointCommit !== transition.checkpointCommit
        ) {
          return invalid('Retry handoffs do not match current checkpoint authority.');
        }
        const phaseState = phaseForCheckpoint(current.phaseState, transition.checkpointCommit);
        if (phaseState.result !== null) {
          return invalid('A terminal phase cannot append retry handoffs.');
        }
        const retryHandoffs = parseRetryHandoffs(transition.retryHandoffs);
        if (!retainsRetryHandoffs(phaseState.retryHandoffs, retryHandoffs, false)) {
          return invalid('Retry handoffs must append exactly one item to durable authority.');
        }
        return parseProgress({
          loopState: current.loopState,
          phaseState: { ...phaseState, retryHandoffs },
        });
      }
      case 'terminal': {
        if (
          !loopCommitSchema.safeParse(transition.checkpointCommit).success ||
          current.loopState.expectedFeatureHead !== transition.checkpointCommit ||
          current.loopState.checkpointCommit !== transition.checkpointCommit
        ) {
          return invalid('Terminal progress does not match current checkpoint authority.');
        }
        const handoff =
          transition.handoff === null ? null : loopPhaseHandoffSchema.parse(transition.handoff);
        const result = loopStageResultSchema.parse(transition.result);
        const phaseState = phaseForCheckpoint(current.phaseState, transition.checkpointCommit);
        if (phaseState.result !== null) {
          return invalid('Terminal progress cannot overwrite an existing phase result.');
        }
        return parseProgress({
          loopState: current.loopState,
          phaseState: {
            ...phaseState,
            handoff,
            result,
          },
        });
      }
    }
  } catch {
    return invalid('E2E progress transition was malformed or violated durable invariants.');
  }
}

function parseProgress(progress: E2EDurableProgress): Result<E2EDurableProgress, E2EProgressError> {
  const loopState = loopStateV1Schema.safeParse(progress.loopState);
  const phaseState =
    progress.phaseState === null
      ? { success: true as const, data: null }
      : loopPhaseStateV2Schema.safeParse(progress.phaseState);
  if (!loopState.success || !phaseState.success) {
    return invalid('E2E progress transition produced invalid durable state.');
  }
  if (
    phaseState.data !== null &&
    phaseState.data.checkpointCommit !== null &&
    phaseState.data.checkpointCommit !== loopState.data.checkpointCommit
  ) {
    return invalid('Phase and Loop checkpoint authority must remain consistent.');
  }
  if (phaseState.data?.result !== null && phaseState.data?.checkpointCommit === null) {
    return invalid('A terminal phase result requires checkpoint authority.');
  }
  const verification = loopState.data.verification;
  if (
    verification !== null &&
    (loopState.data.baseCommit === null ||
      loopState.data.expectedFeatureHead === null ||
      loopState.data.checkpointCommit === null ||
      loopState.data.expectedFeatureHead !== loopState.data.checkpointCommit ||
      verification.baseCommit !== loopState.data.baseCommit ||
      verification.expectedFeatureHead !== loopState.data.expectedFeatureHead ||
      !validWorkspaceShape(verification))
  ) {
    return invalid('Workspace progress does not match current Loop authority.');
  }
  return ok({ loopState: loopState.data, phaseState: phaseState.data });
}

function phaseForCheckpoint(
  phaseState: LoopPhaseState | null,
  checkpointCommit: string
): LoopPhaseState {
  if (phaseState === null) {
    return {
      version: '2',
      checkpointCommit,
      handoff: null,
      retryHandoffs: [],
      result: null,
    };
  }
  if (phaseState.checkpointCommit !== null && phaseState.checkpointCommit !== checkpointCommit) {
    throw new Error('Phase checkpoint authority is stale.');
  }
  return phaseState.checkpointCommit === null ? { ...phaseState, checkpointCommit } : phaseState;
}

function parseRetryHandoffs(value: readonly LoopPhaseRetryHandoff[]): LoopPhaseRetryHandoff[] {
  return loopPhaseRetryHandoffSchema.array().max(64).parse(value);
}

function retainsRetryHandoffs(
  current: readonly LoopPhaseRetryHandoff[],
  next: readonly LoopPhaseRetryHandoff[],
  allowUnchanged: boolean
): boolean {
  const added = next.length - current.length;
  return (
    (added === 1 || (allowUnchanged && added === 0)) &&
    current.every((handoff, index) => JSON.stringify(handoff) === JSON.stringify(next[index]))
  );
}

function validateWorkspaceTransition(
  current: E2EDurableProgress,
  next: LoopVerificationWorkspaceState | null
): string | undefined {
  const previous = current.loopState.verification;
  if (next === null) {
    if (
      previous === null ||
      !(
        (previous.status === 'preparing' && previous.cleanup.status === 'pending') ||
        (previous.status === 'destroying' && previous.cleanup.status === 'running')
      )
    ) {
      return 'Workspace authority can clear only after no creation or controlled destruction.';
    }
    return undefined;
  }
  if (current.phaseState?.result !== null && current.phaseState?.result !== undefined) {
    return 'A terminal phase cannot start or update verification workspace authority.';
  }
  if (
    current.loopState.baseCommit === null ||
    current.loopState.expectedFeatureHead === null ||
    current.loopState.checkpointCommit === null ||
    current.loopState.expectedFeatureHead !== current.loopState.checkpointCommit ||
    next.baseCommit !== current.loopState.baseCommit ||
    next.expectedFeatureHead !== current.loopState.expectedFeatureHead ||
    !validWorkspaceShape(next)
  ) {
    return 'Workspace authority does not match the current Loop checkpoint.';
  }
  if (previous === null) {
    if (
      next.status !== 'preparing' ||
      current.loopState.sessionAttempts.some(
        (attempt) => attempt.verificationRunId === next.verificationRunId
      )
    ) {
      return 'A workspace run must begin fresh in the preparing state.';
    }
    return undefined;
  }
  if (
    previous.verificationRunId !== next.verificationRunId ||
    previous.attempt !== next.attempt ||
    previous.baseCommit !== next.baseCommit
  ) {
    return 'An active workspace cannot be replaced by a different verification run.';
  }
  if (!validWorkspaceStatusTransition(previous.status, next.status)) {
    return 'Workspace lifecycle status cannot move backward or skip cleanup authority.';
  }
  if (previous.target !== undefined) {
    if (next.target === undefined || !sameTarget(previous.target, next.target)) {
      return 'An established workspace target is immutable for its verification run.';
    }
  } else if (next.target !== undefined && previous.status !== 'preparing') {
    return 'Workspace target authority can be established only while preparing the run.';
  }
  if (
    previous.replayedThroughCommit !== undefined &&
    next.replayedThroughCommit !== previous.replayedThroughCommit &&
    !(previous.status === 'integrating-fix' && next.status === 'destroying')
  ) {
    return 'Replayed checkpoint authority cannot change outside correction cleanup.';
  }
  return undefined;
}

function validWorkspaceShape(workspace: LoopVerificationWorkspaceState): boolean {
  switch (workspace.status) {
    case 'preparing':
      return (
        workspace.target === undefined &&
        workspace.replayedThroughCommit === undefined &&
        workspace.cleanup.status === 'pending' &&
        workspace.cleanup.error === undefined
      );
    case 'ready':
    case 'running':
    case 'integrating-fix':
      return (
        workspace.target !== undefined &&
        workspace.replayedThroughCommit !== undefined &&
        workspace.cleanup.status === 'pending' &&
        workspace.cleanup.error === undefined
      );
    case 'destroying':
      return (
        workspace.target !== undefined &&
        workspace.replayedThroughCommit !== undefined &&
        workspace.cleanup.status === 'running' &&
        workspace.cleanup.error === undefined
      );
    case 'cleanup-failed':
      return (
        (workspace.target === undefined) === (workspace.replayedThroughCommit === undefined) &&
        workspace.cleanup.status === 'failed' &&
        workspace.cleanup.error !== undefined
      );
  }
}

function validWorkspaceStatusTransition(
  previous: LoopVerificationWorkspaceState['status'],
  next: LoopVerificationWorkspaceState['status']
): boolean {
  const allowed: Record<LoopVerificationWorkspaceState['status'], readonly string[]> = {
    preparing: ['ready', 'cleanup-failed'],
    ready: ['running', 'destroying'],
    running: ['running', 'integrating-fix', 'destroying'],
    'integrating-fix': ['destroying'],
    destroying: ['destroying', 'cleanup-failed'],
    'cleanup-failed': ['cleanup-failed', 'destroying'],
  };
  return allowed[previous].includes(next);
}

function validAttemptReplacement(
  previous: LoopSessionAttempt,
  next: LoopSessionAttempt,
  allowExactCompleted = false
): boolean {
  if (
    previous.attemptId !== next.attemptId ||
    previous.conversationId !== next.conversationId ||
    previous.purpose !== next.purpose ||
    previous.phaseId !== next.phaseId ||
    previous.verificationRunId !== next.verificationRunId ||
    !sameTarget(previous.target, next.target) ||
    previous.checkpointBefore !== next.checkpointBefore ||
    previous.startedAt !== next.startedAt
  ) {
    return false;
  }
  if (allowExactCompleted && JSON.stringify(previous) === JSON.stringify(next)) return true;
  if (previous.status !== 'starting' && previous.status !== 'running') return false;
  if (previous.finishedAt !== undefined || previous.checkpointAfter !== undefined) return false;
  if (next.status === 'starting') return false;
  if (next.status === 'running') {
    return (
      next.finishedAt === undefined &&
      next.checkpointAfter === undefined &&
      next.error === undefined
    );
  }
  return next.finishedAt !== undefined;
}

function sameTarget(left: LoopSessionTarget, right: LoopSessionTarget): boolean {
  const canonicalLeft = loopSessionTargetSchema.parse(left);
  const canonicalRight = loopSessionTargetSchema.parse(right);
  return JSON.stringify(canonicalLeft) === JSON.stringify(canonicalRight);
}

function invalid(message: string): Result<never, E2EProgressError> {
  return err({ type: 'invalid-progress-transition', message });
}
