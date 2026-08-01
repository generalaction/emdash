import { err, ok, type Result } from '@main/lib/result';
import {
  loopSessionAttemptSchema,
  type LoopSessionAttempt,
  type LoopSessionTarget,
  type LoopVerificationWorkspaceState,
} from '@shared/core/loops/loop-state';
import type { CleanRoomWorkspace } from '../clean-room/clean-room-workspace-service';
import {
  copyEnvironment,
  copyTarget,
  hasCanonicalAttemptFields,
  sameTarget,
  stabilizePlainSuccess,
  validId,
} from './clean-room-e2e-boundary';
import type {
  ActiveAttempt,
  CleanRoomE2EGateDependencies,
  CleanRoomE2EGateError,
  CleanRoomE2EGateStage,
  E2EAttemptAuthority,
  E2EGateDependencyError,
  E2EExecutionBinding,
  E2ESessionInfo,
} from './clean-room-e2e-gate';
import {
  pendingWorkspaceAuthority,
  errorMessage,
  safeDate,
  safeNow,
  stabilizeSessionStart,
  verificationProgress,
  type ControlledDependencyOutcome,
  type SuccessStabilizer,
} from './clean-room-e2e-gate-lifecycle';
import type { NormalizedInput } from './clean-room-e2e-input';
import {
  freshAttemptIdentity,
  hasUsableCancellationIdentity,
  markOuterAttempt,
  sameSessionIdentity,
  tryMakeOuterAttempt,
} from './clean-room-e2e-session-ledger';

export type E2ECancellationRegistry = Map<string, Promise<Result<void, E2EGateDependencyError>>>;

type RequiredDependencies = Pick<
  CleanRoomE2EGateDependencies,
  'createSessionIdentity' | 'now' | 'session'
>;

type FailureFields = Pick<CleanRoomE2EGateError, 'attempt' | 'featureHead' | 'sessionAttempts'> &
  Partial<CleanRoomE2EGateError>;

const MAX_REPORTED_START_IDENTITIES = 64;

type ReservedSessionAuthorities = {
  indexes: Map<string, number>;
  persistenceError?: CleanRoomE2EGateError;
  fullyRepresented: boolean;
};

export type OuterSessionBootstrapOperations = {
  dependencies: RequiredDependencies;
  callControlled<T>(
    input: NormalizedInput,
    label: string,
    operation: () => Promise<Result<T, E2EGateDependencyError>>,
    quiesceAfterStop: (
      operation: Promise<Extract<ControlledDependencyOutcome<T>, { kind: 'completed' }>>
    ) => Promise<Result<void, E2EGateDependencyError>>,
    stabilizeSuccess?: SuccessStabilizer<T>
  ): Promise<Result<T, E2EGateDependencyError>>;
  cancelAllSessions(
    sessions: readonly E2ESessionInfo[],
    authoritativeTarget: LoopSessionTarget,
    cancellationPromises: E2ECancellationRegistry
  ): Promise<
    Array<{
      session: E2ESessionInfo;
      result: Result<void, E2EGateDependencyError>;
    }>
  >;
  cancelSession(
    session: E2ESessionInfo,
    authoritativeTarget: LoopSessionTarget,
    cancellationPromises: E2ECancellationRegistry
  ): Promise<Result<void, E2EGateDependencyError>>;
  cleanup(
    input: NormalizedInput,
    cleanRoom: CleanRoomWorkspace,
    binding: E2EExecutionBinding,
    featureHead: string,
    attempt: number,
    sessionAttempts: readonly LoopSessionAttempt[]
  ): Promise<Result<void, CleanRoomE2EGateError>>;
  cleanupActive(
    input: NormalizedInput,
    active: ActiveAttempt,
    featureHead: string,
    sessionAttempts: readonly LoopSessionAttempt[]
  ): Promise<Result<void, CleanRoomE2EGateError>>;
  commitWorkspaceProgress(
    input: NormalizedInput,
    verification: LoopVerificationWorkspaceState | null,
    featureHead: string,
    attempt: number,
    sessionAttempts: readonly LoopSessionAttempt[]
  ): Promise<Result<void, CleanRoomE2EGateError>>;
  dependencyFailure(
    input: NormalizedInput,
    dependencyError: E2EGateDependencyError,
    stage: CleanRoomE2EGateStage,
    featureHead: string,
    attempt: number,
    sessionAttempts: LoopSessionAttempt[],
    extra?: Partial<CleanRoomE2EGateError>
  ): CleanRoomE2EGateError;
  failure(
    input: NormalizedInput,
    type: string,
    stage: CleanRoomE2EGateStage,
    message: string,
    fields: FailureFields
  ): CleanRoomE2EGateError;
  reserveUnexpectedOuterAttempt(
    input: NormalizedInput,
    session: unknown,
    target: LoopSessionTarget,
    featureHead: string,
    attempt: number,
    startedAt: string,
    sessionAttempts: LoopSessionAttempt[]
  ): Promise<{ index?: number; error?: CleanRoomE2EGateError }>;
  retryUnexpectedStartingProgress(
    input: NormalizedInput,
    featureHead: string,
    attempt: number,
    sessionAttempts: LoopSessionAttempt[],
    prior?: CleanRoomE2EGateError
  ): Promise<Result<void, CleanRoomE2EGateError>>;
  syncSessionProgress(
    input: NormalizedInput,
    featureHead: string,
    attempt: number,
    sessionAttempts: readonly LoopSessionAttempt[]
  ): Promise<Result<void, CleanRoomE2EGateError>>;
  validateSession(
    session: E2ESessionInfo,
    target: LoopSessionTarget,
    taskEnvironment: Readonly<Record<string, string>>,
    input: NormalizedInput,
    verificationRunId: string,
    attempt: number,
    attempts: readonly LoopSessionAttempt[],
    expectedIdentity: { attemptId: string; conversationId: string }
  ): { type: string; message: string } | undefined;
};

export async function bootstrapOuterSession(
  input: NormalizedInput,
  featureHead: string,
  attempt: number,
  verificationRunId: string,
  cleanRoom: CleanRoomWorkspace,
  binding: E2EExecutionBinding,
  authority: E2EAttemptAuthority,
  sessionAttempts: LoopSessionAttempt[],
  cancellationPromises: E2ECancellationRegistry,
  operations: OuterSessionBootstrapOperations
): Promise<Result<ActiveAttempt, CleanRoomE2EGateError>> {
  let sessionIdentity: { attemptId: string; conversationId: string };
  try {
    const allocated = operations.dependencies.createSessionIdentity({
      purpose: 'e2e',
      verificationRunId,
      attempt,
    });
    const stable = stabilizePlainSuccess<{
      attemptId: string;
      conversationId: string;
    }>(allocated);
    if (!stable) throw new TypeError('Invalid E2E session identity');
    sessionIdentity = stable;
  } catch (cause) {
    const cleanup = await operations.cleanup(
      input,
      cleanRoom,
      binding,
      featureHead,
      attempt,
      sessionAttempts
    );
    if (!cleanup.success) return cleanup;
    return err(
      operations.failure(
        input,
        'dependency-rejected',
        'session-start',
        `E2E session identity allocation failed: ${errorMessage(cause)}`,
        {
          featureHead,
          attempt,
          verificationRunId,
          lastWorkspaceDestroyed: true,
          sessionAttempts,
        }
      )
    );
  }
  const startedAt = safeNow(operations.dependencies.now);
  const startingAttempt = loopSessionAttemptSchema.safeParse({
    ...sessionIdentity,
    purpose: 'e2e',
    phaseId: input.phase.id,
    verificationRunId,
    target: copyTarget(cleanRoom.target),
    status: 'starting',
    checkpointBefore: featureHead,
    startedAt,
  });
  if (
    !startingAttempt.success ||
    !validId(sessionIdentity.attemptId) ||
    !validId(sessionIdentity.conversationId) ||
    !freshAttemptIdentity(startingAttempt.data, input, sessionAttempts)
  ) {
    const cleanup = await operations.cleanup(
      input,
      cleanRoom,
      binding,
      featureHead,
      attempt,
      sessionAttempts
    );
    if (!cleanup.success) return cleanup;
    return err(
      operations.failure(
        input,
        'invalid-session-identity',
        'session-start',
        'Allocated E2E session identities were invalid or already durable.',
        {
          featureHead,
          attempt,
          verificationRunId,
          lastWorkspaceDestroyed: true,
          sessionAttempts,
        }
      )
    );
  }
  const preallocatedLedgerIndex = sessionAttempts.push(startingAttempt.data) - 1;
  const startingProgress = await operations.syncSessionProgress(
    input,
    featureHead,
    attempt,
    sessionAttempts
  );
  const runningWorkspaceProgress = startingProgress.success
    ? await operations.commitWorkspaceProgress(
        input,
        verificationProgress({
          currentVerification: input.progress.current.loopState.verification,
          verificationRunId,
          attempt,
          status: 'running',
          baseCommit: input.baseCommit,
          featureHead,
          updatedAt: safeNow(operations.dependencies.now),
          cleanRoom,
        }),
        featureHead,
        attempt,
        sessionAttempts
      )
    : startingProgress;
  if (!runningWorkspaceProgress.success) {
    markOuterAttempt(
      sessionAttempts,
      preallocatedLedgerIndex,
      'interrupted',
      safeDate(operations.dependencies.now),
      { error: runningWorkspaceProgress.error.message }
    );
    const cleanup = await operations.cleanup(
      input,
      cleanRoom,
      binding,
      featureHead,
      attempt,
      sessionAttempts
    );
    if (!cleanup.success) return cleanup;
    return runningWorkspaceProgress;
  }
  const expectedSession: E2ESessionInfo = {
    attemptId: sessionIdentity.attemptId,
    conversationId: sessionIdentity.conversationId,
    purpose: 'e2e',
    phaseId: input.phase.id,
    verificationRunId,
    attempt,
    target: copyTarget(cleanRoom.target),
    provider: input.provider,
    model: input.model,
    taskEnvironment: copyEnvironment(binding.taskEnvironment),
  };
  let stoppedSession: E2ESessionInfo | undefined;
  let stoppedStartError: E2EGateDependencyError | undefined;
  let stoppedAuthorities: ReservedSessionAuthorities | undefined;
  let stoppedReportedComplete = true;
  const started = await operations.callControlled(
    input,
    'Fresh E2E session start',
    () =>
      operations.dependencies.session.startFreshE2ESession({
        attemptId: sessionIdentity.attemptId,
        conversationId: sessionIdentity.conversationId,
        purpose: 'e2e',
        phaseId: input.phase.id,
        verificationRunId,
        attempt,
        target: copyTarget(cleanRoom.target),
        executionTarget: binding.executionTarget,
        taskEnvironment: copyEnvironment(binding.taskEnvironment),
        provider: input.provider,
        model: input.model,
        signal: input.signal,
        deadlineAt: input.deadlineAt,
      }),
    async (operation) => {
      const settled = await operation;
      const identities = [expectedSession];
      if (settled.value.success) {
        stoppedSession = settled.value.data;
        if (
          hasUsableCancellationIdentity(stoppedSession) &&
          !sameSessionIdentity(stoppedSession, expectedSession)
        ) {
          identities.push(stoppedSession);
        }
      } else {
        stoppedStartError = settled.value.error;
        const reported = reportedStartSessions(settled.value.error, expectedSession, featureHead);
        stoppedReportedComplete = reported.complete;
        identities.push(...reported.sessions);
      }
      stoppedAuthorities = await reserveSessionAuthorities(
        identities,
        expectedSession,
        preallocatedLedgerIndex,
        input,
        cleanRoom.target,
        featureHead,
        attempt,
        startedAt,
        sessionAttempts,
        operations
      );
      const startingPersisted = await operations.retryUnexpectedStartingProgress(
        input,
        featureHead,
        attempt,
        sessionAttempts,
        stoppedAuthorities.persistenceError
      );
      const cancellations = await cancelSessionsConcurrently(
        identities,
        cleanRoom.target,
        cancellationPromises,
        operations
      );
      if (!startingPersisted.success) {
        return err({
          type: 'cleanup-failed',
          message: startingPersisted.error.message,
        });
      }
      for (const cancellation of cancellations) {
        const ledgerIndex = stoppedAuthorities.indexes.get(
          sessionIdentityKey(cancellation.session)
        );
        if (ledgerIndex === undefined) continue;
        markOuterAttempt(
          sessionAttempts,
          ledgerIndex,
          cancellation.result.success ? 'cancelled' : 'interrupted',
          safeDate(operations.dependencies.now),
          {
            error: cancellation.result.success
              ? 'E2E session was cancelled.'
              : cancellation.result.error.message,
          }
        );
      }
      const terminalPersisted = await operations.syncSessionProgress(
        input,
        featureHead,
        attempt,
        sessionAttempts
      );
      if (!terminalPersisted.success) {
        return err({ type: 'cleanup-failed', message: terminalPersisted.error.message });
      }
      const cancellationErrors = cancellations.filter(
        (cancellation) => !cancellation.result.success
      );
      if (cancellationErrors.length > 0) {
        return err({
          type: 'cleanup-failed',
          message: cancellationErrors
            .map((cancellation) =>
              cancellation.result.success ? '' : cancellation.result.error.message
            )
            .filter(Boolean)
            .join('; '),
        });
      }
      if (
        !stoppedAuthorities.fullyRepresented ||
        !stoppedReportedComplete ||
        stoppedStartError?.quiescent === false ||
        stoppedStartError?.recoveryRequired === true
      ) {
        return err({
          type: 'cleanup-failed',
          message: 'Fresh E2E session start did not prove complete quiescent authority.',
        });
      }
      return ok();
    },
    (value) => stabilizeSessionStart(value, expectedSession)
  );
  if (!started.success) {
    const authoritativeStartError = stoppedStartError ?? started.error;
    const reported = reportedStartSessions(authoritativeStartError, expectedSession, featureHead);
    const identities = [expectedSession, ...reported.sessions];
    if (
      stoppedSession &&
      hasUsableCancellationIdentity(stoppedSession) &&
      !sameSessionIdentity(stoppedSession, expectedSession)
    ) {
      identities.push(stoppedSession);
    }
    const distinctIdentities = distinctSessions(identities);
    const authorities =
      stoppedAuthorities ??
      (await reserveSessionAuthorities(
        distinctIdentities,
        expectedSession,
        preallocatedLedgerIndex,
        input,
        cleanRoom.target,
        featureHead,
        attempt,
        startedAt,
        sessionAttempts,
        operations
      ));
    const lateStartingPersisted = await operations.retryUnexpectedStartingProgress(
      input,
      featureHead,
      attempt,
      sessionAttempts,
      authorities.persistenceError
    );
    const cancellations = await cancelSessionsConcurrently(
      distinctIdentities,
      cleanRoom.target,
      cancellationPromises,
      operations
    );
    if (!lateStartingPersisted.success) {
      return err({
        ...lateStartingPersisted.error,
        recoveryRequired: true,
        lastWorkspaceDestroyed: false,
        pendingWorkspace: pendingWorkspaceAuthority(cleanRoom),
      });
    }
    const failedCancellation = cancellations.find((cancellation) => !cancellation.result.success);
    for (const cancellation of cancellations) {
      const ledgerIndex = authorities.indexes.get(sessionIdentityKey(cancellation.session));
      if (ledgerIndex === undefined) continue;
      markOuterAttempt(
        sessionAttempts,
        ledgerIndex,
        cancellation.result.success
          ? started.error.type === 'cancelled'
            ? 'cancelled'
            : started.error.type === 'deadline-exceeded'
              ? 'interrupted'
              : 'failed'
          : 'interrupted',
        safeDate(operations.dependencies.now),
        {
          error: cancellation.result.success
            ? started.error.message
            : cancellation.result.error.message,
        }
      );
    }
    const terminalPersisted = await operations.syncSessionProgress(
      input,
      featureHead,
      attempt,
      sessionAttempts
    );
    const recoveryUnproven =
      !authorities.fullyRepresented ||
      !reported.complete ||
      authoritativeStartError.quiescent === false ||
      authoritativeStartError.recoveryRequired === true;
    if (failedCancellation || !terminalPersisted.success || recoveryUnproven) {
      const failure = !terminalPersisted.success
        ? terminalPersisted.error
        : failedCancellation && !failedCancellation.result.success
          ? operations.dependencyFailure(
              input,
              failedCancellation.result.error,
              'quiescence',
              featureHead,
              attempt,
              sessionAttempts
            )
          : recoveryUnproven
            ? operations.failure(
                input,
                'cleanup-failed',
                'quiescence',
                'Fresh E2E session start did not prove complete quiescent authority.',
                { featureHead, attempt, sessionAttempts }
              )
            : undefined;
      return err({
        ...(failure ??
          operations.failure(input, 'cleanup-failed', 'quiescence', 'Session cleanup failed.', {
            featureHead,
            attempt,
            sessionAttempts,
          })),
        recoveryRequired: true,
        lastWorkspaceDestroyed: false,
        pendingWorkspace: pendingWorkspaceAuthority(cleanRoom),
      });
    }
    const cleanup = await operations.cleanup(
      input,
      cleanRoom,
      binding,
      featureHead,
      attempt,
      sessionAttempts
    );
    if (!cleanup.success) return cleanup;
    return err(
      operations.dependencyFailure(
        input,
        started.error,
        'session-start',
        featureHead,
        attempt,
        sessionAttempts,
        {
          verificationRunId,
          ...(stoppedSession ? { conversationId: stoppedSession.conversationId } : {}),
          lastWorkspaceDestroyed: true,
        }
      )
    );
  }
  const session = started.data;
  const sessionError = operations.validateSession(
    session,
    cleanRoom.target,
    binding.taskEnvironment,
    input,
    verificationRunId,
    attempt,
    sessionAttempts,
    sessionIdentity
  );
  const outerAttempt = tryMakeOuterAttempt(session, cleanRoom.target, featureHead, startedAt);
  if (!outerAttempt) {
    const identities = [expectedSession];
    const usableReturnedIdentity = hasUsableCancellationIdentity(session);
    if (usableReturnedIdentity && !sameSessionIdentity(session, expectedSession)) {
      identities.push(session);
    }
    const authorities = await reserveSessionAuthorities(
      identities,
      expectedSession,
      preallocatedLedgerIndex,
      input,
      cleanRoom.target,
      featureHead,
      attempt,
      startedAt,
      sessionAttempts,
      operations
    );
    const startingPersisted = await operations.retryUnexpectedStartingProgress(
      input,
      featureHead,
      attempt,
      sessionAttempts,
      authorities.persistenceError
    );
    const cancellations = await cancelSessionsConcurrently(
      identities,
      cleanRoom.target,
      cancellationPromises,
      operations
    );
    const failedCancellation = cancellations.find(({ result }) => !result.success);
    for (const cancellation of cancellations) {
      const ledgerIndex = authorities.indexes.get(sessionIdentityKey(cancellation.session));
      if (ledgerIndex === undefined) continue;
      markOuterAttempt(
        sessionAttempts,
        ledgerIndex,
        cancellation.result.success ? 'cancelled' : 'interrupted',
        safeDate(operations.dependencies.now),
        {
          error: cancellation.result.success
            ? 'Fresh E2E session returned invalid durable authority.'
            : cancellation.result.error.message,
        }
      );
    }
    const terminalPersisted = await operations.syncSessionProgress(
      input,
      featureHead,
      attempt,
      sessionAttempts
    );
    if (
      !usableReturnedIdentity ||
      !authorities.fullyRepresented ||
      !startingPersisted.success ||
      !terminalPersisted.success ||
      failedCancellation
    ) {
      const dependencyError =
        failedCancellation && !failedCancellation.result.success
          ? failedCancellation.result.error
          : {
              type: 'cleanup-failed',
              message: !startingPersisted.success
                ? startingPersisted.error.message
                : !terminalPersisted.success
                  ? terminalPersisted.error.message
                  : 'Fresh E2E session did not retain complete cancellation authority.',
            };
      return err(
        operations.dependencyFailure(
          input,
          dependencyError,
          'quiescence',
          featureHead,
          attempt,
          sessionAttempts,
          {
            verificationRunId,
            recoveryRequired: true,
            lastWorkspaceDestroyed: false,
            pendingWorkspace: pendingWorkspaceAuthority(cleanRoom),
          }
        )
      );
    }
    const cleanup = await operations.cleanup(
      input,
      cleanRoom,
      binding,
      featureHead,
      attempt,
      sessionAttempts
    );
    if (!cleanup.success) return cleanup;
    return err(
      operations.failure(
        input,
        'session-authority-invalid',
        'session-start',
        'Fresh E2E session identity cannot be represented in the durable ledger.',
        {
          featureHead,
          attempt,
          verificationRunId,
          lastWorkspaceDestroyed: true,
          sessionAttempts,
        }
      )
    );
  }
  const outerLedgerIndex = preallocatedLedgerIndex;
  if (!sessionError) sessionAttempts[preallocatedLedgerIndex] = outerAttempt;
  if (sessionError) {
    const returnedDifferentIdentity = !sameSessionIdentity(session, expectedSession);
    const identities = returnedDifferentIdentity ? [expectedSession, session] : [expectedSession];
    const authorities = await reserveSessionAuthorities(
      identities,
      expectedSession,
      preallocatedLedgerIndex,
      input,
      cleanRoom.target,
      featureHead,
      attempt,
      startedAt,
      sessionAttempts,
      operations
    );
    const actualLedgerIndex = returnedDifferentIdentity
      ? authorities.indexes.get(sessionIdentityKey(session))
      : undefined;
    const actualStartingPersisted = await operations.retryUnexpectedStartingProgress(
      input,
      featureHead,
      attempt,
      sessionAttempts,
      authorities.persistenceError
    );
    const cancellations = await cancelSessionsConcurrently(
      identities,
      cleanRoom.target,
      cancellationPromises,
      operations
    );
    const cancellationFailure = cancellations.find(({ result }) => !result.success);
    if (!actualStartingPersisted.success) {
      return err({
        ...actualStartingPersisted.error,
        recoveryRequired: true,
        lastWorkspaceDestroyed: false,
        pendingWorkspace: pendingWorkspaceAuthority(cleanRoom),
      });
    }
    if (cancellationFailure || !authorities.fullyRepresented) {
      markOuterAttempt(
        sessionAttempts,
        outerLedgerIndex,
        'interrupted',
        safeDate(operations.dependencies.now),
        { error: 'Invalid E2E session did not prove quiescence.' }
      );
      if (actualLedgerIndex !== undefined) {
        markOuterAttempt(
          sessionAttempts,
          actualLedgerIndex,
          'interrupted',
          safeDate(operations.dependencies.now),
          {
            error:
              cancellationFailure && !cancellationFailure.result.success
                ? cancellationFailure.result.error.message
                : 'Actual E2E session identity could not be represented durably.',
          }
        );
      }
      const terminalPersisted = await operations.syncSessionProgress(
        input,
        featureHead,
        attempt,
        sessionAttempts
      );
      const failure = terminalPersisted.success
        ? cancellationFailure && !cancellationFailure.result.success
          ? cancellationFailure.result.error
          : {
              type: 'cleanup-failed',
              message: 'Invalid E2E session did not retain complete durable authority.',
            }
        : {
            type: 'cleanup-failed',
            message: `${
              cancellationFailure && !cancellationFailure.result.success
                ? cancellationFailure.result.error.message
                : 'Durable session authority was incomplete.'
            }; ${terminalPersisted.error.message}`,
          };
      return err(
        operations.dependencyFailure(
          input,
          failure,
          'quiescence',
          featureHead,
          attempt,
          sessionAttempts,
          {
            verificationRunId,
            conversationId: session.conversationId,
            recoveryRequired: true,
            lastWorkspaceDestroyed: false,
            pendingWorkspace: pendingWorkspaceAuthority(cleanRoom),
          }
        )
      );
    }
    markOuterAttempt(
      sessionAttempts,
      outerLedgerIndex,
      'failed',
      safeDate(operations.dependencies.now),
      {
        error: sessionError.message,
      }
    );
    if (actualLedgerIndex !== undefined) {
      markOuterAttempt(
        sessionAttempts,
        actualLedgerIndex,
        'cancelled',
        safeDate(operations.dependencies.now),
        { error: sessionError.message }
      );
    }
    const cleanup = await operations.cleanup(
      input,
      cleanRoom,
      binding,
      featureHead,
      attempt,
      sessionAttempts
    );
    if (!cleanup.success) return cleanup;
    return err(
      operations.failure(input, sessionError.type, 'session-start', sessionError.message, {
        featureHead,
        attempt,
        verificationRunId,
        conversationId: session.conversationId,
        lastWorkspaceDestroyed: true,
        sessionAttempts,
      })
    );
  }

  const active: ActiveAttempt = {
    number: attempt,
    verificationRunId,
    cleanRoom,
    binding,
    authority: authority,
    session,
    outerLedgerIndex,
  };

  const sessionProgress = await operations.syncSessionProgress(
    input,
    featureHead,
    attempt,
    sessionAttempts
  );
  const runningProgress = sessionProgress.success
    ? await operations.commitWorkspaceProgress(
        input,
        verificationProgress({
          currentVerification: input.progress.current.loopState.verification,
          verificationRunId,
          attempt,
          status: 'running',
          baseCommit: input.baseCommit,
          featureHead,
          updatedAt: safeNow(operations.dependencies.now),
          cleanRoom,
        }),
        featureHead,
        attempt,
        sessionAttempts
      )
    : sessionProgress;
  if (!runningProgress.success) {
    const cancelled = await operations.cancelSession(
      session,
      cleanRoom.target,
      cancellationPromises
    );
    if (!cancelled.success) {
      markOuterAttempt(
        sessionAttempts,
        outerLedgerIndex,
        'interrupted',
        safeDate(operations.dependencies.now),
        { error: cancelled.error.message }
      );
      return err(
        operations.dependencyFailure(
          input,
          cancelled.error,
          'quiescence',
          featureHead,
          attempt,
          sessionAttempts,
          {
            verificationRunId,
            conversationId: session.conversationId,
            recoveryRequired: true,
            lastWorkspaceDestroyed: false,
            pendingWorkspace: pendingWorkspaceAuthority(cleanRoom),
          }
        )
      );
    }
    markOuterAttempt(
      sessionAttempts,
      outerLedgerIndex,
      'cancelled',
      safeDate(operations.dependencies.now),
      { error: runningProgress.error.message }
    );
    const cleanup = await operations.cleanupActive(input, active, featureHead, sessionAttempts);
    if (!cleanup.success) return cleanup;
    return runningProgress;
  }

  return ok(active);
}

function reportedStartSessions(
  error: E2EGateDependencyError,
  expected: E2ESessionInfo,
  featureHead: string
): { sessions: E2ESessionInfo[]; complete: boolean } {
  let candidates: unknown;
  try {
    candidates = error.sessionAttempts;
  } catch {
    return { sessions: [], complete: false };
  }
  if (candidates === undefined) return { sessions: [], complete: true };
  if (!Array.isArray(candidates) || candidates.length > MAX_REPORTED_START_IDENTITIES) {
    return { sessions: [], complete: false };
  }
  const sessions: E2ESessionInfo[] = [];
  let complete = true;
  for (const candidate of candidates) {
    try {
      const parsed = loopSessionAttemptSchema.safeParse(candidate);
      const candidateRecord =
        candidate && typeof candidate === 'object' && !Array.isArray(candidate)
          ? (candidate as Record<string, unknown>)
          : undefined;
      const attemptId = candidateRecord?.attemptId;
      const conversationId = candidateRecord?.conversationId;
      if (
        !parsed.success ||
        !hasCanonicalAttemptFields(candidate, parsed.data) ||
        parsed.data.purpose !== 'e2e' ||
        parsed.data.phaseId !== expected.phaseId ||
        parsed.data.verificationRunId !== expected.verificationRunId ||
        parsed.data.checkpointBefore !== featureHead ||
        !sameTarget(parsed.data.target, expected.target) ||
        !validId(parsed.data.attemptId) ||
        !validId(parsed.data.conversationId) ||
        (error.quiescent === true &&
          !['completed', 'failed', 'cancelled', 'interrupted'].includes(parsed.data.status))
      ) {
        complete = false;
        if (validId(attemptId) && validId(conversationId)) {
          sessions.push({ ...expected, attemptId, conversationId });
        }
        continue;
      }
      sessions.push({
        ...expected,
        attemptId: parsed.data.attemptId,
        conversationId: parsed.data.conversationId,
      });
    } catch {
      complete = false;
    }
  }
  return { sessions: distinctSessions(sessions), complete };
}

async function reserveSessionAuthorities(
  sessions: readonly E2ESessionInfo[],
  expected: E2ESessionInfo,
  expectedLedgerIndex: number,
  input: NormalizedInput,
  target: LoopSessionTarget,
  featureHead: string,
  attempt: number,
  startedAt: string,
  sessionAttempts: LoopSessionAttempt[],
  operations: OuterSessionBootstrapOperations
): Promise<ReservedSessionAuthorities> {
  const indexes = new Map<string, number>([[sessionIdentityKey(expected), expectedLedgerIndex]]);
  let persistenceError: CleanRoomE2EGateError | undefined;
  let fullyRepresented = true;
  for (const session of distinctSessions(sessions)) {
    const key = sessionIdentityKey(session);
    if (indexes.has(key)) continue;
    const reserved = await operations.reserveUnexpectedOuterAttempt(
      input,
      session,
      target,
      featureHead,
      attempt,
      startedAt,
      sessionAttempts
    );
    if (reserved.index === undefined) {
      fullyRepresented = false;
    } else {
      indexes.set(key, reserved.index);
    }
    persistenceError ??= reserved.error;
  }
  return { indexes, fullyRepresented, ...(persistenceError ? { persistenceError } : {}) };
}

function cancelSessionsConcurrently(
  sessions: readonly E2ESessionInfo[],
  target: LoopSessionTarget,
  cancellationPromises: E2ECancellationRegistry,
  operations: OuterSessionBootstrapOperations
): Promise<Array<{ session: E2ESessionInfo; result: Result<void, E2EGateDependencyError> }>> {
  const pending = distinctSessions(sessions).map((session) => ({
    session,
    result: operations.cancelSession(session, target, cancellationPromises),
  }));
  return Promise.all(
    pending.map(async ({ session, result }) => ({ session, result: await result }))
  );
}

function distinctSessions(sessions: readonly E2ESessionInfo[]): E2ESessionInfo[] {
  const seen = new Set<string>();
  const result: E2ESessionInfo[] = [];
  for (const session of sessions) {
    const key = sessionIdentityKey(session);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(session);
  }
  return result;
}

function sessionIdentityKey(session: Pick<E2ESessionInfo, 'attemptId' | 'conversationId'>): string {
  return `${session.attemptId}\u0000${session.conversationId}`;
}
