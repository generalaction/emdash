import { err, ok, type Result } from '@main/lib/result';
import { loopPhaseStateInputSchema } from '@shared/core/loops/loop-phase-state';
import type {
  LoopSessionTarget,
  LoopVerificationWorkspaceState,
} from '@shared/core/loops/loop-state';
import { loopSessionTargetSchema } from '@shared/core/loops/loop-state';
import type { LoopPhase, LoopProviderId } from '@shared/core/loops/loops';
import type { CleanRoomWorkspace } from '../clean-room/clean-room-workspace-service';
import {
  clonePendingCleanup,
  parseCleanRoomPendingCleanup,
  type CleanRoomPendingCleanup,
} from '../clean-room/cleanup-journal';
import {
  boundedSummary,
  copyTarget,
  hasCanonicalPhaseState,
  isCanonicalTarget,
  monotonicTimestamp,
  redactPersistedText,
  sameMachine,
  sameTarget,
  stabilizePlainSuccess,
  validCommit,
  validId,
  workspacePathsOverlap,
} from './clean-room-e2e-boundary';
import type {
  CleanRoomE2EGateStage,
  E2EGateDependencyError,
  E2EExecutionBinding,
  E2EPendingWorkspaceAuthority,
  E2ESessionInfo,
  RunCleanRoomE2EGateInput,
} from './clean-room-e2e-gate';
import type { NormalizedInput } from './clean-room-e2e-input';
import { copyE2EDurableProgress, type E2EDurableProgress } from './clean-room-e2e-progress';

export type ControlFailure = {
  type: 'cancelled' | 'deadline-exceeded';
  message: string;
};

export type ControlledDependencyOutcome<T> =
  | { kind: 'completed'; value: Result<T, E2EGateDependencyError> }
  | { kind: 'stopped'; failure: ControlFailure };

export type SuccessStabilizer<T> = (value: unknown) => T | undefined;

export function validatePrerequisites(
  value: { phases: readonly LoopPhase[] },
  input: NormalizedInput
): { type: string; message: string } | undefined {
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray(value.phases) ||
    value.phases.length === 0 ||
    value.phases.length !== input.phase.idx ||
    value.phases.length > 64
  ) {
    return {
      type: 'prerequisite-authority-invalid',
      message: 'E2E prerequisites must contain every contiguous prior Loop phase.',
    };
  }
  const ids = new Set<string>();
  let reviewCount = 0;
  for (const [index, phase] of value.phases.entries()) {
    const state =
      phase.state === null || phase.state === undefined
        ? null
        : loopPhaseStateInputSchema.safeParse(phase.state);
    if (
      !phase ||
      typeof phase !== 'object' ||
      !validId(phase.id) ||
      ids.has(phase.id) ||
      phase.loopId !== input.loop.id ||
      phase.idx !== index ||
      (phase.kind !== 'work' && phase.kind !== 'review') ||
      phase.status !== 'passed' ||
      (phase.conversationId !== null && !validId(phase.conversationId)) ||
      state === null ||
      !state.success ||
      !hasCanonicalPhaseState(phase.state) ||
      state.data.result?.status !== 'passed' ||
      state.data.checkpointCommit === null
    ) {
      return {
        type: 'prerequisite-authority-invalid',
        message: 'A prior Loop phase lacks exact passed persisted authority.',
      };
    }
    ids.add(phase.id);
    if (phase.kind === 'review') reviewCount += 1;
    const purpose = phase.kind === 'review' ? 'review' : 'work';
    const exactAttempts = input.loop.state?.sessionAttempts.filter(
      (attempt) =>
        attempt.purpose === purpose &&
        attempt.phaseId === phase.id &&
        attempt.status === 'completed' &&
        attempt.checkpointAfter === state.data.checkpointCommit
    );
    const exactAttempt =
      exactAttempts?.length === 1 &&
      (phase.conversationId === null || exactAttempts[0]?.conversationId === phase.conversationId);
    if (!exactAttempt) {
      return {
        type: 'prerequisite-authority-invalid',
        message: 'A prior passed phase is not bound to its exact durable completed session.',
      };
    }
    if (phase.kind === 'review' && index !== value.phases.length - 1) {
      return {
        type: 'prerequisite-order-invalid',
        message: 'Terminal Review must be the final prerequisite immediately before E2E.',
      };
    }
  }
  const workCount = value.phases.length - reviewCount;
  const finalState = loopPhaseStateInputSchema.parse(value.phases.at(-1)!.state);
  if (
    workCount < 1 ||
    finalState.checkpointCommit !== input.checkpointCommit ||
    reviewCount !== (input.terminalGates.review ? 1 : 0)
  ) {
    return {
      type: 'prerequisite-order-invalid',
      message: 'Durable work and Review prerequisites do not match the configured terminal order.',
    };
  }
  return undefined;
}

export function verificationProgress(input: {
  currentVerification: LoopVerificationWorkspaceState | null;
  verificationRunId: string;
  attempt: number;
  status: LoopVerificationWorkspaceState['status'];
  baseCommit: string;
  featureHead: string;
  updatedAt: string;
  cleanRoom?: CleanRoomWorkspace;
  cleanupStatus?: LoopVerificationWorkspaceState['cleanup']['status'];
  cleanupError?: string;
}): LoopVerificationWorkspaceState {
  return {
    verificationRunId: input.verificationRunId,
    attempt: input.attempt,
    status: input.status,
    ...(input.cleanRoom ? { target: copyTarget(input.cleanRoom.target) } : {}),
    baseCommit: input.baseCommit,
    ...(input.cleanRoom ? { replayedThroughCommit: input.cleanRoom.replayedThroughCommit } : {}),
    expectedFeatureHead: input.featureHead,
    cleanup: {
      status: input.cleanupStatus ?? 'pending',
      updatedAt: monotonicTimestamp(input.currentVerification?.cleanup.updatedAt, input.updatedAt),
      ...(input.cleanupError
        ? { error: boundedSummary(input.cleanupError, 'Workspace cleanup failed.') }
        : {}),
    },
  };
}

export function safePendingCleanup(
  value: unknown,
  input: RunCleanRoomE2EGateInput,
  stage: CleanRoomE2EGateStage,
  pendingWorkspace?: E2EPendingWorkspaceAuthority
): CleanRoomPendingCleanup | undefined {
  if (value === undefined || stage !== 'cleanup' || !pendingWorkspace) return undefined;
  const parsed = parseCleanRoomPendingCleanup(value);
  if (!parsed.success) return undefined;
  const record = parsed.data;
  if (
    !hasCanonicalPendingCleanupAuthority(record) ||
    record.projectId !== pendingWorkspace.projectId ||
    record.projectId !== input.project.projectId ||
    record.cleanupId !== pendingWorkspace.cleanupId ||
    record.verificationRunId !== pendingWorkspace.verificationRunId ||
    record.attempt !== pendingWorkspace.attempt ||
    record.workspaceId !== pendingWorkspace.target.workspaceId ||
    record.target.path !== pendingWorkspace.target.path ||
    !sameMachine(
      { ...pendingWorkspace.target, path: record.target.path, machine: record.target.machine },
      pendingWorkspace.target
    ) ||
    !sameTarget(record.featureTarget, input.featureTarget) ||
    workspacePathsOverlap(record.target.path, input.featureTarget.path) ||
    workspacePathsOverlap(record.target.path, input.project.repoPath) ||
    record.baseCommit !== input.baseCommit ||
    record.expectedFeatureHead !== pendingWorkspace.expectedFeatureHead
  ) {
    return undefined;
  }
  return clonePendingCleanup(record);
}

export function safeCreatePendingCleanup(
  value: unknown,
  input: NormalizedInput,
  verificationRunId: string,
  attempt: number,
  featureHead: string
): CleanRoomPendingCleanup | undefined {
  const parsed = parseCleanRoomPendingCleanup(value);
  if (!parsed.success) return undefined;
  const record = parsed.data;
  if (!hasCanonicalPendingCleanupAuthority(record)) return undefined;
  const target: LoopSessionTarget = {
    workspaceId: record.workspaceId,
    path: record.target.path,
    machine: record.target.machine,
  };
  if (
    record.projectId !== input.project.projectId ||
    record.verificationRunId !== verificationRunId ||
    record.attempt !== attempt ||
    !sameTarget(record.featureTarget, input.featureTarget) ||
    !sameMachine(target, input.featureTarget) ||
    target.workspaceId === input.featureTarget.workspaceId ||
    workspacePathsOverlap(target.path, input.featureTarget.path) ||
    workspacePathsOverlap(target.path, input.project.repoPath) ||
    record.baseCommit !== input.baseCommit ||
    record.expectedFeatureHead !== featureHead
  ) {
    return undefined;
  }
  return clonePendingCleanup(record);
}

function hasCanonicalPendingCleanupAuthority(record: CleanRoomPendingCleanup): boolean {
  const target: LoopSessionTarget = {
    workspaceId: record.workspaceId,
    path: record.target.path,
    machine: record.target.machine,
  };
  const parsedTarget = loopSessionTargetSchema.safeParse(target);
  const parsedFeature = loopSessionTargetSchema.safeParse(record.featureTarget);
  return (
    validId(record.cleanupId) &&
    validId(record.verificationRunId) &&
    validId(record.projectId) &&
    validId(record.workspaceId) &&
    parsedTarget.success &&
    isCanonicalTarget(target, parsedTarget.data) &&
    parsedFeature.success &&
    isCanonicalTarget(record.featureTarget, parsedFeature.data) &&
    record.branchName === record.branchName.trim() &&
    redactPersistedText(record.branchName) === record.branchName &&
    validCommit(record.baseCommit) &&
    validCommit(record.expectedFeatureHead) &&
    validCommit(record.branchHead)
  );
}

export function pendingWorkspaceFromCleanup(
  cleanup: CleanRoomPendingCleanup
): E2EPendingWorkspaceAuthority {
  return {
    projectId: cleanup.projectId,
    cleanupId: cleanup.cleanupId,
    verificationRunId: cleanup.verificationRunId,
    attempt: cleanup.attempt,
    target: {
      workspaceId: cleanup.workspaceId,
      path: cleanup.target.path,
      machine: { ...cleanup.target.machine },
    },
    expectedFeatureHead: cleanup.expectedFeatureHead,
  };
}

export function pendingWorkspaceAuthority(
  cleanRoom: CleanRoomWorkspace
): E2EPendingWorkspaceAuthority {
  return {
    projectId: cleanRoom.projectId,
    cleanupId: cleanRoom.cleanupId,
    verificationRunId: cleanRoom.verificationRunId,
    attempt: cleanRoom.attempt,
    target: copyTarget(cleanRoom.target),
    expectedFeatureHead: cleanRoom.expectedFeatureHead,
  };
}

export function clonePendingWorkspace(
  authority: E2EPendingWorkspaceAuthority
): E2EPendingWorkspaceAuthority {
  return {
    ...authority,
    target: copyTarget(authority.target),
  };
}

export function safeDate(now: () => Date): Date {
  try {
    const value = now();
    if (value instanceof Date && Number.isFinite(value.getTime())) {
      return new Date(value.getTime());
    }
  } catch {
    // A valid fallback keeps lifecycle cleanup and durable evidence available.
  }
  return new Date();
}

export function safeNow(now: () => Date): string {
  return safeDate(now).toISOString();
}

export async function raceWithControl<T>(
  operation: Promise<Extract<ControlledDependencyOutcome<T>, { kind: 'completed' }>>,
  input: Pick<RunCleanRoomE2EGateInput, 'signal' | 'deadlineAt'>
): Promise<ControlledDependencyOutcome<T>> {
  const signal = input.signal;
  if (!signal && input.deadlineAt === undefined) return operation;

  let timeout: ReturnType<typeof setTimeout> | undefined;
  let detachAbort: (() => void) | undefined;
  const stopped = new Promise<Extract<ControlledDependencyOutcome<T>, { kind: 'stopped' }>>(
    (resolve) => {
      const stop = () => {
        const failure = controlFailure(input);
        if (failure) resolve({ kind: 'stopped', failure });
      };
      if (signal) {
        AbortSignal.prototype.addEventListener.call(signal, 'abort', stop, { once: true });
        detachAbort = () => AbortSignal.prototype.removeEventListener.call(signal, 'abort', stop);
      }
      if (input.deadlineAt !== undefined) {
        timeout = setTimeout(
          () =>
            resolve({
              kind: 'stopped',
              failure: {
                type: 'deadline-exceeded',
                message: 'Clean-room E2E deadline was exceeded.',
              },
            }),
          Math.max(0, input.deadlineAt - Date.now())
        );
      }
      stop();
    }
  );

  try {
    return await Promise.race([operation, stopped]);
  } finally {
    if (timeout) clearTimeout(timeout);
    detachAbort?.();
  }
}

export function normalizeDependencyResult<T>(
  value: unknown,
  label: string,
  stabilizeSuccess?: SuccessStabilizer<T>
): Result<T, E2EGateDependencyError> {
  try {
    if (!value || typeof value !== 'object') throw new TypeError('Invalid result');
    const candidate = value as {
      success?: unknown;
      data?: T;
      error?: E2EGateDependencyError;
    };
    const success = candidate.success;
    if (success === true && Reflect.has(candidate, 'data')) {
      const data = candidate.data;
      if (!stabilizeSuccess) return ok(data as T);
      const stable = stabilizeSuccess(data);
      if (stable === undefined) throw new TypeError('Invalid success payload');
      return ok(stable);
    }
    const dependencyError = candidate.error;
    if (success !== false || !dependencyError || typeof dependencyError !== 'object') {
      throw new TypeError('Invalid result');
    }
    const message = dependencyError.message;
    const type = dependencyError.type;
    const kind = dependencyError.kind;
    const rawPendingCleanup = Reflect.has(dependencyError, 'pendingCleanup')
      ? dependencyError.pendingCleanup
      : undefined;
    let hasSessionAttempts = false;
    let rawSessionAttempts: unknown;
    try {
      hasSessionAttempts = Reflect.has(dependencyError, 'sessionAttempts');
      rawSessionAttempts = hasSessionAttempts
        ? Reflect.get(dependencyError, 'sessionAttempts')
        : undefined;
    } catch {
      // Preserve hostile property presence as explicit invalid authority. Downstream recovery must
      // not confuse an unreadable reported ledger with an omitted ledger.
      hasSessionAttempts = true;
      rawSessionAttempts = undefined;
    }
    const quiescent = dependencyError.quiescent;
    const recoveryRequired = dependencyError.recoveryRequired;
    if (typeof message !== 'string') throw new TypeError('Invalid error');
    const pendingCleanup = stabilizePlainSuccess<unknown>(rawPendingCleanup);
    const sessionAttempts = stabilizePlainSuccess<unknown>(rawSessionAttempts);
    return err({
      ...(typeof type === 'string' ? { type } : {}),
      ...(typeof kind === 'string' ? { kind } : {}),
      message,
      ...(pendingCleanup !== undefined ? { pendingCleanup } : {}),
      ...(hasSessionAttempts ? { sessionAttempts: sessionAttempts ?? null } : {}),
      ...(typeof quiescent === 'boolean' ? { quiescent } : {}),
      ...(typeof recoveryRequired === 'boolean' ? { recoveryRequired } : {}),
    } as E2EGateDependencyError);
  } catch {
    return err({
      type: 'untrusted-settlement',
      message: `${label} returned an invalid result.`,
    });
  }
}

export function stabilizeExecutionBinding(value: unknown): E2EExecutionBinding | undefined {
  try {
    if (!value || typeof value !== 'object') return undefined;
    const candidate = value as E2EExecutionBinding;
    const target = stabilizePlainSuccess<LoopSessionTarget>(candidate.target);
    const taskEnvironment = stabilizePlainSuccess<Record<string, string>>(
      candidate.taskEnvironment
    );
    const rawExecutionTarget = candidate.executionTarget;
    if (!rawExecutionTarget || typeof rawExecutionTarget !== 'object') return undefined;
    const executionTargetIdentity = stabilizePlainSuccess<LoopSessionTarget>({
      workspaceId: rawExecutionTarget.workspaceId,
      path: rawExecutionTarget.path,
      machine: rawExecutionTarget.machine,
    });
    const executionTaskEnvironment = stabilizePlainSuccess<Record<string, string>>(
      rawExecutionTarget.taskEnv
    );
    const executionContext = rawExecutionTarget.executionContext;
    const dispose = rawExecutionTarget.dispose;
    if (
      !target ||
      !taskEnvironment ||
      !executionTargetIdentity ||
      !executionTaskEnvironment ||
      !executionContext ||
      typeof executionContext !== 'object' ||
      typeof dispose !== 'function'
    ) {
      return undefined;
    }
    return {
      target,
      taskEnvironment,
      executionTarget: {
        ...executionTargetIdentity,
        executionContext,
        taskEnv: executionTaskEnvironment,
        dispose: () => dispose.call(rawExecutionTarget),
      },
    };
  } catch {
    return undefined;
  }
}

export function stabilizeSessionStart(
  value: unknown,
  expected: E2ESessionInfo
): E2ESessionInfo | undefined {
  if (!value || typeof value !== 'object') return undefined;
  try {
    const candidate = value as Partial<E2ESessionInfo>;
    const attemptId = candidate.attemptId;
    const conversationId = candidate.conversationId;
    if (typeof attemptId !== 'string' || typeof conversationId !== 'string') return undefined;

    let attestationDrifted = false;
    const readExpected = <K extends 'purpose' | 'phaseId' | 'verificationRunId' | 'attempt'>(
      key: K
    ): E2ESessionInfo[K] => {
      try {
        const actual = candidate[key];
        if (actual !== expected[key]) attestationDrifted = true;
      } catch {
        attestationDrifted = true;
      }
      return expected[key];
    };
    let target: LoopSessionTarget | undefined;
    let taskEnvironment: Record<string, string> | undefined;
    try {
      target = stabilizePlainSuccess<LoopSessionTarget>(candidate.target);
    } catch {
      attestationDrifted = true;
    }
    try {
      taskEnvironment = stabilizePlainSuccess<Record<string, string>>(candidate.taskEnvironment);
    } catch {
      attestationDrifted = true;
    }
    if (!target || !taskEnvironment) attestationDrifted = true;
    let provider: unknown;
    let model: unknown;
    try {
      provider = candidate.provider;
      model = candidate.model;
    } catch {
      attestationDrifted = true;
    }

    return {
      attemptId,
      conversationId,
      purpose: readExpected('purpose'),
      phaseId: readExpected('phaseId'),
      verificationRunId: readExpected('verificationRunId'),
      attempt: readExpected('attempt'),
      target: target ?? copyTarget(expected.target),
      provider: (attestationDrifted ? '__invalid__' : provider) as LoopProviderId,
      model: typeof model === 'string' && !attestationDrifted ? model : '',
      taskEnvironment: taskEnvironment ?? Object.freeze({}),
    };
  } catch {
    return undefined;
  }
}

export function stabilizeDurableProgress(value: unknown): E2EDurableProgress | undefined {
  try {
    return copyE2EDurableProgress(value as E2EDurableProgress);
  } catch {
    return undefined;
  }
}

export function errorMessage(cause: unknown): string {
  try {
    return boundedSummary(
      cause instanceof Error ? cause.message : String(cause),
      'Unknown dependency failure.'
    );
  } catch {
    return 'Unknown dependency failure.';
  }
}

export function controlFailure(
  input: Pick<RunCleanRoomE2EGateInput, 'signal' | 'deadlineAt'>
): ControlFailure | undefined {
  if (input.signal && signalAborted(input.signal)) {
    return { type: 'cancelled', message: 'Clean-room E2E was cancelled.' };
  }
  if (input.deadlineAt !== undefined && Date.now() >= input.deadlineAt) {
    return { type: 'deadline-exceeded', message: 'Clean-room E2E deadline was exceeded.' };
  }
  return undefined;
}

function signalAborted(signal: AbortSignal): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted');
  return descriptor?.get?.call(signal) === true;
}

export function remainingTimeout(
  input: Pick<RunCleanRoomE2EGateInput, 'deadlineAt'>
): number | undefined {
  if (input.deadlineAt === undefined) return undefined;
  return Math.max(1, Math.min(2_147_483_647, input.deadlineAt - Date.now()));
}
