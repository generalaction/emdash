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
  let stoppedActualLedgerIndex: number | undefined;
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
      let actualStartingError: CleanRoomE2EGateError | undefined;
      if (settled.value.success) {
        stoppedSession = settled.value.data;
        if (
          hasUsableCancellationIdentity(stoppedSession) &&
          !sameSessionIdentity(stoppedSession, expectedSession)
        ) {
          identities.push(stoppedSession);
          const reserved = await operations.reserveUnexpectedOuterAttempt(
            input,
            stoppedSession,
            cleanRoom.target,
            featureHead,
            attempt,
            startedAt,
            sessionAttempts
          );
          stoppedActualLedgerIndex = reserved.index;
          actualStartingError = reserved.error;
        }
      }
      const cancellations = await operations.cancelAllSessions(
        identities,
        cleanRoom.target,
        cancellationPromises
      );
      const startingPersisted = await operations.retryUnexpectedStartingProgress(
        input,
        featureHead,
        attempt,
        sessionAttempts,
        actualStartingError
      );
      if (!startingPersisted.success) {
        return err({
          type: 'cleanup-failed',
          message: startingPersisted.error.message,
        });
      }
      for (const cancellation of cancellations) {
        const ledgerIndex = sameSessionIdentity(cancellation.session, expectedSession)
          ? preallocatedLedgerIndex
          : stoppedActualLedgerIndex;
        markOuterAttempt(
          sessionAttempts,
          ledgerIndex ?? preallocatedLedgerIndex,
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
      return ok();
    },
    (value) => stabilizeSessionStart(value, expectedSession)
  );
  if (!started.success) {
    const identities = [expectedSession];
    let lateStartingError: CleanRoomE2EGateError | undefined;
    if (
      stoppedSession &&
      hasUsableCancellationIdentity(stoppedSession) &&
      !sameSessionIdentity(stoppedSession, expectedSession)
    ) {
      identities.push(stoppedSession);
      if (stoppedActualLedgerIndex === undefined) {
        const reserved = await operations.reserveUnexpectedOuterAttempt(
          input,
          stoppedSession,
          cleanRoom.target,
          featureHead,
          attempt,
          startedAt,
          sessionAttempts
        );
        stoppedActualLedgerIndex = reserved.index;
        lateStartingError = reserved.error;
      }
    }
    const cancellations = await operations.cancelAllSessions(
      identities,
      cleanRoom.target,
      cancellationPromises
    );
    const lateStartingPersisted = await operations.retryUnexpectedStartingProgress(
      input,
      featureHead,
      attempt,
      sessionAttempts,
      lateStartingError
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
      const ledgerIndex = sameSessionIdentity(cancellation.session, expectedSession)
        ? preallocatedLedgerIndex
        : stoppedActualLedgerIndex;
      markOuterAttempt(
        sessionAttempts,
        ledgerIndex ?? preallocatedLedgerIndex,
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
    if (failedCancellation || !terminalPersisted.success) {
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
    for (const identity of identities) {
      const cancelled = await operations.cancelSession(
        identity,
        cleanRoom.target,
        cancellationPromises
      );
      if (!cancelled.success) {
        markOuterAttempt(
          sessionAttempts,
          preallocatedLedgerIndex,
          'interrupted',
          safeDate(operations.dependencies.now),
          { error: cancelled.error.message }
        );
        await operations.syncSessionProgress(input, featureHead, attempt, sessionAttempts);
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
              recoveryRequired: true,
              lastWorkspaceDestroyed: false,
              pendingWorkspace: pendingWorkspaceAuthority(cleanRoom),
            }
          )
        );
      }
    }
    if (!usableReturnedIdentity) {
      markOuterAttempt(
        sessionAttempts,
        preallocatedLedgerIndex,
        'interrupted',
        safeDate(operations.dependencies.now),
        { error: 'Fresh E2E session returned no usable cancellation identity.' }
      );
      await operations.syncSessionProgress(input, featureHead, attempt, sessionAttempts);
      return err(
        operations.failure(
          input,
          'session-authority-invalid',
          'quiescence',
          'Fresh E2E session returned no usable cancellation identity.',
          {
            featureHead,
            attempt,
            verificationRunId,
            recoveryRequired: true,
            lastWorkspaceDestroyed: false,
            pendingWorkspace: pendingWorkspaceAuthority(cleanRoom),
            sessionAttempts,
          }
        )
      );
    }
    markOuterAttempt(
      sessionAttempts,
      preallocatedLedgerIndex,
      'failed',
      safeDate(operations.dependencies.now),
      { error: 'Fresh E2E session identity cannot be represented in the durable ledger.' }
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
    const reserved = returnedDifferentIdentity
      ? await operations.reserveUnexpectedOuterAttempt(
          input,
          session,
          cleanRoom.target,
          featureHead,
          attempt,
          startedAt,
          sessionAttempts
        )
      : {};
    const actualLedgerIndex = reserved.index;
    const identities = returnedDifferentIdentity ? [expectedSession, session] : [expectedSession];
    let cancellationFailure: E2EGateDependencyError | undefined;
    for (const identity of identities) {
      const cancelled = await operations.cancelSession(
        identity,
        cleanRoom.target,
        cancellationPromises
      );
      if (!cancelled.success && cancellationFailure === undefined) {
        cancellationFailure = cancelled.error;
      }
    }
    const actualStartingPersisted = await operations.retryUnexpectedStartingProgress(
      input,
      featureHead,
      attempt,
      sessionAttempts,
      reserved.error
    );
    if (!actualStartingPersisted.success) {
      return err({
        ...actualStartingPersisted.error,
        recoveryRequired: true,
        lastWorkspaceDestroyed: false,
        pendingWorkspace: pendingWorkspaceAuthority(cleanRoom),
      });
    }
    if (cancellationFailure) {
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
          { error: cancellationFailure.message }
        );
      }
      const terminalPersisted = await operations.syncSessionProgress(
        input,
        featureHead,
        attempt,
        sessionAttempts
      );
      const failure = terminalPersisted.success
        ? cancellationFailure
        : {
            type: 'cleanup-failed',
            message: `${cancellationFailure.message}; ${terminalPersisted.error.message}`,
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
