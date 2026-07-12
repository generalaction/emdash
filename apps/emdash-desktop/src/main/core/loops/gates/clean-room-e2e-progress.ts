import { err, ok, type Result } from '@main/lib/result';
import {
  loopPhaseHandoffSchema,
  loopPhaseStateV1Schema,
  loopStageResultSchema,
  type LoopPhaseHandoff,
  type LoopPhaseState,
  type LoopStageResult,
} from '@shared/core/loops/loop-phase-state';
import {
  loopCommitSchema,
  loopSessionAttemptSchema,
  loopStateV1Schema,
  loopVerificationWorkspaceStateSchema,
  type LoopSessionAttempt,
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
      progress.phaseState === null ? null : loopPhaseStateV1Schema.parse(progress.phaseState),
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
    const current = copyE2EDurableProgress(expected);
    switch (transition.kind) {
      case 'workspace': {
        const verification =
          transition.verification === null
            ? null
            : loopVerificationWorkspaceStateSchema.parse(transition.verification);
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
            next.attemptId !== previous.attemptId ||
            next.conversationId !== previous.conversationId
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
        if (
          completed.status !== 'completed' ||
          completed.checkpointBefore !== transition.previousHead ||
          completed.checkpointAfter !== transition.featureHead ||
          completed.finishedAt === undefined
        ) {
          return invalid('Checkpoint advancement requires its exact completed E2E attempt.');
        }
        const attempts = [...current.loopState.sessionAttempts];
        const index = attempts.findIndex(
          (attempt) =>
            attempt.attemptId === completed.attemptId &&
            attempt.conversationId === completed.conversationId
        );
        if (index < 0) attempts.push(completed);
        else attempts[index] = completed;
        return parseProgress({
          loopState: {
            ...current.loopState,
            expectedFeatureHead: transition.featureHead,
            checkpointCommit: transition.featureHead,
            sessionAttempts: attempts,
          },
          phaseState: current.phaseState,
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
        return parseProgress({
          loopState: current.loopState,
          phaseState: {
            version: '1',
            checkpointCommit: transition.checkpointCommit,
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
      : loopPhaseStateV1Schema.safeParse(progress.phaseState);
  if (!loopState.success || !phaseState.success) {
    return invalid('E2E progress transition produced invalid durable state.');
  }
  return ok({ loopState: loopState.data, phaseState: phaseState.data });
}

function invalid(message: string): Result<never, E2EProgressError> {
  return err({ type: 'invalid-progress-transition', message });
}
