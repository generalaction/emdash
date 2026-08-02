import { posix, win32 } from 'node:path';
import { err, ok, type Result } from '@main/lib/result';
import {
  loopPhaseHandoffSchema,
  loopPhaseRetryHandoffSchema,
  loopPhaseStateV2Schema,
  loopStageResultSchema,
  type LoopPhaseHandoff,
  type LoopPhaseRetryHandoff,
  type LoopPhaseState,
  type LoopStageResult,
} from '@shared/core/loops/loop-phase-state';
import {
  CLEAN_ROOM_E2E_MAX_ATTEMPTS,
  loopCommitSchema,
  loopSessionAttemptSchema,
  loopSessionTargetSchema,
  loopStateV2Schema,
  loopVerificationWorkspaceStateSchema,
  type LoopSessionAttempt,
  type LoopSessionTarget,
  type LoopStateV2,
  type LoopVerificationWorkspaceState,
} from '@shared/core/loops/loop-state';
import { redactPersistedText, validTimestamp } from './clean-room-e2e-boundary';

export type E2EProgressError = {
  type?: string;
  kind?: string;
  message: string;
};

export type E2EDurableProgress = {
  loopState: LoopStateV2;
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
      /** Atomically replaces the complete append-only ledger from the CAS expected snapshot. */
      kind: 'session-attempts';
      next: readonly LoopSessionAttempt[];
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
  /** Reads both durable values from one authoritative snapshot. */
  read(input: {
    loopId: string;
    phaseId: string;
  }): Promise<Result<E2EDurableProgress, E2EProgressError>>;
  /** Compare-and-swap both durable states in one transaction, then return the committed value. */
  commit(input: {
    loopId: string;
    phaseId: string;
    expected: E2EDurableProgress;
    transition: E2EProgressTransition;
  }): Promise<Result<E2EDurableProgress, E2EProgressError>>;
};

export function copyE2EDurableProgress(progress: E2EDurableProgress): E2EDurableProgress {
  const loopState = loopStateV2Schema.parse(progress.loopState);
  if (!validLoopStatePersistenceBoundary(progress.loopState, loopState)) {
    throw new TypeError('Loop progress contains non-canonical persisted authority.');
  }
  const phaseState =
    progress.phaseState === null ? null : loopPhaseStateV2Schema.parse(progress.phaseState);
  if (!validPhaseStatePersistenceBoundary(progress.phaseState, phaseState)) {
    throw new TypeError('Phase progress contains non-canonical persisted authority.');
  }
  return {
    loopState,
    phaseState,
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
    // copyE2EDurableProgress is already the strict persistence boundary. Avoid reparsing the
    // complete append-only ledger before applying the one bounded transition.
    const current = copyE2EDurableProgress(expected);
    switch (transition.kind) {
      case 'workspace': {
        const verification =
          transition.verification === null
            ? null
            : loopVerificationWorkspaceStateSchema.parse(transition.verification);
        const workspaceError = validateWorkspaceTransition(current, verification);
        if (workspaceError) return invalid(workspaceError);
        const e2eAttemptsConsumed = consumedAttemptsAfterWorkspaceTransition(current, verification);
        if (!e2eAttemptsConsumed.success) return e2eAttemptsConsumed;
        return parseProgress({
          loopState: {
            ...current.loopState,
            e2eAttemptsConsumed: e2eAttemptsConsumed.data,
            verification,
          },
          phaseState: current.phaseState,
        });
      }
      case 'session-attempt': {
        const next = loopSessionAttemptSchema.parse(transition.next);
        if (!hasCanonicalAttemptFields(transition.next, next) || !validAttemptState(next)) {
          return invalid('Session attempt authority is non-canonical or internally inconsistent.');
        }
        const attempts = [...current.loopState.sessionAttempts];
        if (transition.previous === undefined) {
          if (
            next.status !== 'starting' ||
            (next.purpose !== 'e2e' && next.purpose !== 'browser-verification') ||
            next.phaseId === undefined ||
            next.verificationRunId === undefined ||
            next.checkpointBefore === undefined ||
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
          if (
            !hasCanonicalAttemptFields(transition.previous, previous) ||
            !validAttemptState(previous)
          ) {
            return invalid('Session attempt predecessor is non-canonical or inconsistent.');
          }
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
      case 'session-attempts': {
        const rawNext = transition.next;
        if (!Array.isArray(rawNext) || rawNext.length > 1_024) {
          return invalid('Session attempt batch exceeds the bounded durable ledger.');
        }
        const next = rawNext.map((attempt) => loopSessionAttemptSchema.parse(attempt));
        if (
          next.some(
            (attempt, index) =>
              !hasCanonicalAttemptFields(rawNext[index], attempt) || !validAttemptState(attempt)
          )
        ) {
          return invalid(
            'Session attempt batch authority is non-canonical or internally inconsistent.'
          );
        }

        const previous = current.loopState.sessionAttempts;
        if (next.length < previous.length) {
          return invalid('Session attempt batch cannot truncate the durable ledger.');
        }
        for (let index = 0; index < previous.length; index += 1) {
          const prior = previous[index]!;
          const candidate = next[index]!;
          if (
            prior.attemptId !== candidate.attemptId ||
            prior.conversationId !== candidate.conversationId ||
            (JSON.stringify(prior) !== JSON.stringify(candidate) &&
              !validAttemptReplacement(prior, candidate))
          ) {
            return invalid(
              'Session attempt batch must preserve its exact prefix and legal lifecycle.'
            );
          }
        }

        const knownAttemptIds = new Set(previous.map((attempt) => attempt.attemptId));
        const knownConversationIds = new Set(previous.map((attempt) => attempt.conversationId));
        for (const appended of next.slice(previous.length)) {
          if (
            appended.status !== 'starting' ||
            (appended.purpose !== 'e2e' && appended.purpose !== 'browser-verification') ||
            appended.phaseId === undefined ||
            appended.verificationRunId === undefined ||
            appended.checkpointBefore === undefined ||
            knownAttemptIds.has(appended.attemptId) ||
            knownConversationIds.has(appended.conversationId)
          ) {
            return invalid(
              'Session attempt batch append must contain only fresh starting identities.'
            );
          }
          knownAttemptIds.add(appended.attemptId);
          knownConversationIds.add(appended.conversationId);
        }
        return parseProgress({
          loopState: { ...current.loopState, sessionAttempts: next },
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
          !hasCanonicalAttemptFields(transition.completedAttempt, completed) ||
          !validAttemptState(completed)
        ) {
          return invalid('Checkpoint advancement contains invalid completed-attempt authority.');
        }
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
          return invalid('Checkpoint advancement cannot append absent session authority.');
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
        if (
          current.loopState.verification !== null ||
          current.loopState.sessionAttempts.some(
            (attempt) => !isTerminalAttempt(attempt) || !validAttemptState(attempt)
          )
        ) {
          return invalid('Terminal progress requires quiescent workspace and session authority.');
        }
        const handoff =
          transition.handoff === null ? null : loopPhaseHandoffSchema.parse(transition.handoff);
        const result = loopStageResultSchema.parse(transition.result);
        const phaseState = phaseForCheckpoint(current.phaseState, transition.checkpointCommit);
        if (phaseState.result !== null) {
          return invalid('Terminal progress cannot overwrite an existing phase result.');
        }
        const latestAuthorityTimestamp = latestDurableTimestamp(current, handoff);
        if (
          latestAuthorityTimestamp !== undefined &&
          Date.parse(result.completedAt) < Date.parse(latestAuthorityTimestamp)
        ) {
          return invalid('Terminal completion time cannot precede durable lifecycle authority.');
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
  const loopState = loopStateV2Schema.safeParse(progress.loopState);
  const phaseState =
    progress.phaseState === null
      ? { success: true as const, data: null }
      : loopPhaseStateV2Schema.safeParse(progress.phaseState);
  if (
    !loopState.success ||
    !phaseState.success ||
    !validLoopStatePersistenceBoundary(progress.loopState, loopState.data) ||
    !validPhaseStatePersistenceBoundary(progress.phaseState, phaseState.data)
  ) {
    return invalid('E2E progress transition produced invalid durable state.');
  }
  if (loopState.data.sessionAttempts.some((attempt) => !validAttemptState(attempt))) {
    return invalid('Durable session attempt state is internally inconsistent.');
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
  if (Date.parse(next.cleanup.updatedAt) < Date.parse(previous.cleanup.updatedAt)) {
    return 'Workspace cleanup time cannot move backward.';
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
  const replayAuthorityChanged = previous.replayedThroughCommit !== next.replayedThroughCommit;
  const establishingReplayAuthority =
    previous.status === 'preparing' &&
    next.status === 'ready' &&
    previous.replayedThroughCommit === undefined &&
    next.replayedThroughCommit !== undefined;
  const enteringCorrectionIntegration =
    previous.status === 'running' && next.status === 'integrating-fix';
  if (
    (enteringCorrectionIntegration && !replayAuthorityChanged) ||
    (!establishingReplayAuthority && !enteringCorrectionIntegration && replayAuthorityChanged)
  ) {
    return 'Replayed checkpoint authority changes exactly once on correction integration.';
  }
  return undefined;
}

function consumedAttemptsAfterWorkspaceTransition(
  current: E2EDurableProgress,
  next: LoopVerificationWorkspaceState | null
): Result<number, E2EProgressError> {
  const previous = current.loopState.verification;
  const durableRuns = countDurableOuterE2ERuns(current.loopState.sessionAttempts);
  const persisted = current.loopState.e2eAttemptsConsumed;
  if (previous === null) {
    if (next === null || next.status !== 'preparing') {
      return invalid('A new E2E budget charge requires one preparing workspace run.');
    }
    const consumed = Math.max(persisted, durableRuns) + 1;
    if (consumed > CLEAN_ROOM_E2E_MAX_ATTEMPTS || next.attempt !== consumed) {
      return invalid('Workspace preparation does not match the fixed durable E2E attempt budget.');
    }
    return ok(consumed);
  }
  return ok(Math.max(persisted, durableRuns, previous.attempt));
}

function countDurableOuterE2ERuns(attempts: readonly LoopSessionAttempt[]): number {
  const runs = new Set<string>();
  for (const attempt of attempts) {
    if (attempt.purpose !== 'e2e') continue;
    runs.add(attempt.verificationRunId ?? `attempt:${attempt.attemptId}`);
  }
  return runs.size;
}

function latestDurableTimestamp(
  current: E2EDurableProgress,
  terminalHandoff: LoopPhaseHandoff | null
): string | undefined {
  const timestamps: string[] = [];
  const add = (value: string | undefined): void => {
    if (value !== undefined && validTimestamp(value)) timestamps.push(value);
  };
  for (const attempt of current.loopState.sessionAttempts) {
    add(attempt.startedAt);
    add(attempt.finishedAt);
  }
  if (current.loopState.verification) add(current.loopState.verification.cleanup.updatedAt);
  if (current.phaseState?.handoff) addHandoffTimestamps(current.phaseState.handoff, add);
  for (const retry of current.phaseState?.retryHandoffs ?? []) {
    addHandoffTimestamps(retry.handoff, add);
  }
  if (terminalHandoff) addHandoffTimestamps(terminalHandoff, add);
  return timestamps.reduce<string | undefined>((latest, value) => {
    if (latest === undefined || Date.parse(value) > Date.parse(latest)) return value;
    return latest;
  }, undefined);
}

function addHandoffTimestamps(
  handoff: LoopPhaseHandoff,
  add: (value: string | undefined) => void
): void {
  add(handoff.createdAt);
  for (const artifact of handoff.artifacts) add(artifact.createdAt);
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
        workspace.target !== undefined &&
        workspace.replayedThroughCommit !== undefined &&
        workspace.cleanup.status === 'failed' &&
        validCanonicalFreeText(workspace.cleanup.error)
      );
  }
}

function validWorkspaceStatusTransition(
  previous: LoopVerificationWorkspaceState['status'],
  next: LoopVerificationWorkspaceState['status']
): boolean {
  const allowed: Record<LoopVerificationWorkspaceState['status'], readonly string[]> = {
    preparing: ['ready'],
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
  if (!validAttemptState(previous) || !validAttemptState(next)) return false;
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
  if (next.status === 'starting') return false;
  if (next.status === 'running') {
    return true;
  }
  return isTerminalAttempt(next);
}

function validAttemptState(attempt: LoopSessionAttempt): boolean {
  if (
    !validCanonicalId(attempt.attemptId) ||
    !validCanonicalId(attempt.conversationId) ||
    (attempt.phaseId !== undefined && !validCanonicalId(attempt.phaseId)) ||
    (attempt.verificationRunId !== undefined && !validCanonicalId(attempt.verificationRunId)) ||
    !validCanonicalTimestamp(attempt.startedAt) ||
    (attempt.finishedAt !== undefined &&
      (!validCanonicalTimestamp(attempt.finishedAt) ||
        Date.parse(attempt.finishedAt) < Date.parse(attempt.startedAt)))
  ) {
    return false;
  }
  if (attempt.status === 'starting' || attempt.status === 'running') {
    return (
      attempt.finishedAt === undefined &&
      attempt.checkpointAfter === undefined &&
      attempt.error === undefined
    );
  }
  if (attempt.status === 'completed') {
    return (
      attempt.finishedAt !== undefined &&
      attempt.checkpointAfter !== undefined &&
      attempt.error === undefined
    );
  }
  if (attempt.status === 'failed') {
    return (
      attempt.finishedAt !== undefined &&
      validCanonicalFreeText(attempt.error) &&
      (attempt.checkpointAfter === undefined || attempt.purpose === 'review')
    );
  }
  return (
    attempt.finishedAt !== undefined &&
    attempt.checkpointAfter === undefined &&
    validCanonicalFreeText(attempt.error)
  );
}

function isTerminalAttempt(attempt: LoopSessionAttempt): boolean {
  return (
    attempt.status === 'completed' ||
    attempt.status === 'failed' ||
    attempt.status === 'cancelled' ||
    attempt.status === 'interrupted'
  );
}

function validLoopStatePersistenceBoundary(value: unknown, parsed: LoopStateV2): boolean {
  if (!sameCanonicalJsonValue(value, parsed)) return false;
  if (
    parsed.sessionAttempts.some(
      (attempt) => !validAttemptState(attempt) || !validCanonicalTarget(attempt.target)
    )
  ) {
    return false;
  }
  return (
    parsed.verification === null ||
    (validCanonicalId(parsed.verification.verificationRunId) &&
      validWorkspaceShape(parsed.verification) &&
      (parsed.verification.target === undefined ||
        validCanonicalTarget(parsed.verification.target)))
  );
}

function validPhaseStatePersistenceBoundary(
  value: unknown,
  parsed: LoopPhaseState | null
): boolean {
  return sameCanonicalJsonValue(value, parsed) && redactionPreserved(value);
}

function redactionPreserved(value: unknown): boolean {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === 'string' && redactPersistedText(serialized) === serialized;
  } catch {
    return false;
  }
}

function sameCanonicalJsonValue(value: unknown, parsed: unknown): boolean {
  if (
    value === null ||
    parsed === null ||
    typeof value !== 'object' ||
    typeof parsed !== 'object'
  ) {
    return Object.is(value, parsed);
  }
  if (Array.isArray(value) || Array.isArray(parsed)) {
    return (
      Array.isArray(value) &&
      Array.isArray(parsed) &&
      value.length === parsed.length &&
      value.every((item, index) => sameCanonicalJsonValue(item, parsed[index]))
    );
  }
  const valueKeys = Reflect.ownKeys(value);
  const parsedKeys = Object.keys(parsed);
  if (valueKeys.some((key) => typeof key !== 'string') || valueKeys.length !== parsedKeys.length) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const canonical = parsed as Record<string, unknown>;
  return parsedKeys.every(
    (key) => Object.hasOwn(record, key) && sameCanonicalJsonValue(record[key], canonical[key])
  );
}

function validCanonicalTargetPath(value: string): boolean {
  const canonicalPosix =
    posix.isAbsolute(value) &&
    !value.includes('\\') &&
    posix.normalize(value) === value &&
    (value === '/' || !value.endsWith('/'));
  const canonicalWindows =
    win32.isAbsolute(value) &&
    !value.includes('/') &&
    win32.normalize(value) === value &&
    (/^[A-Za-z]:\\$/.test(value) || !value.endsWith('\\'));
  return canonicalPosix || canonicalWindows;
}

function hasCanonicalAttemptFields(value: unknown, parsed: LoopSessionAttempt): boolean {
  if (!value || typeof value !== 'object') return false;
  const raw = value as Partial<LoopSessionAttempt>;
  return (
    raw.attemptId === parsed.attemptId &&
    raw.conversationId === parsed.conversationId &&
    raw.phaseId === parsed.phaseId &&
    raw.verificationRunId === parsed.verificationRunId &&
    raw.startedAt === parsed.startedAt &&
    raw.finishedAt === parsed.finishedAt &&
    raw.error === parsed.error &&
    hasCanonicalTarget(raw.target, parsed.target)
  );
}

function hasCanonicalTarget(value: unknown, parsed: LoopSessionTarget): boolean {
  if (!value || typeof value !== 'object') return false;
  const raw = value as Partial<LoopSessionTarget>;
  if (!raw.machine || typeof raw.machine !== 'object') return false;
  return (
    raw.workspaceId === parsed.workspaceId &&
    raw.path === parsed.path &&
    raw.machine.kind === parsed.machine.kind &&
    (parsed.machine.kind === 'local' ||
      (raw.machine.kind === 'ssh' && raw.machine.connectionId === parsed.machine.connectionId))
  );
}

function validCanonicalId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 256 &&
    value === value.trim() &&
    redactPersistedText(value) === value
  );
}

function validCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return false;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) && timestamp.toISOString() === value;
}

function validCanonicalFreeText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 4_096 &&
    value === value.trim() &&
    !value.includes('\0') &&
    redactPersistedText(value) === value
  );
}

function validCanonicalTarget(target: LoopSessionTarget): boolean {
  return (
    validCanonicalId(target.workspaceId) &&
    validCanonicalTargetPath(target.path) &&
    (target.machine.kind === 'local' || validCanonicalId(target.machine.connectionId))
  );
}

function sameTarget(left: LoopSessionTarget, right: LoopSessionTarget): boolean {
  const canonicalLeft = loopSessionTargetSchema.parse(left);
  const canonicalRight = loopSessionTargetSchema.parse(right);
  return JSON.stringify(canonicalLeft) === JSON.stringify(canonicalRight);
}

function invalid(message: string): Result<never, E2EProgressError> {
  return err({ type: 'invalid-progress-transition', message });
}
