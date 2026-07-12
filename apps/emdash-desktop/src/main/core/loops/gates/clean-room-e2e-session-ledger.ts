import {
  loopSessionAttemptSchema,
  loopSessionTargetSchema,
  type LoopSessionAttempt,
  type LoopSessionTarget,
} from '@shared/core/loops/loop-state';
import type { CleanRoomWorkspace } from '../clean-room/clean-room-workspace-service';
import {
  boundedSummary,
  copyTarget,
  hasCanonicalAttemptFields,
  isCanonicalTarget,
  monotonicTimestamp,
  sameMachine,
  sameTarget,
  validCommit,
  validId,
} from './clean-room-e2e-boundary';
import type {
  ActiveAttempt,
  E2EAttemptAuthority,
  E2EAttemptInspection,
  E2EFeatureInspection,
  E2ESessionInfo,
} from './clean-room-e2e-gate';
import type { NormalizedInput } from './clean-room-e2e-input';

const MAX_ATTEMPTS = 64;

export function validateCleanRoom(
  cleanRoom: CleanRoomWorkspace,
  input: NormalizedInput,
  verificationRunId: string,
  attempt: number,
  featureHead: string
): { type: string; message: string } | undefined {
  const parsedTarget = loopSessionTargetSchema.safeParse(
    cleanRoom && typeof cleanRoom === 'object' ? cleanRoom.target : undefined
  );
  if (
    !cleanRoom ||
    typeof cleanRoom !== 'object' ||
    cleanRoom.projectId !== input.project.projectId ||
    cleanRoom.verificationRunId !== verificationRunId ||
    cleanRoom.attempt !== attempt ||
    cleanRoom.baseCommit !== input.baseCommit ||
    cleanRoom.expectedFeatureHead !== featureHead ||
    cleanRoom.replayedThroughCommit !== featureHead ||
    !validId(cleanRoom.cleanupId) ||
    !validId(cleanRoom.branchName) ||
    !parsedTarget.success
  ) {
    return {
      type: 'clean-room-authority-invalid',
      message: 'Clean-room identity attestation is invalid.',
    };
  }
  if (!isCanonicalTarget(cleanRoom.target, parsedTarget.data)) {
    return {
      type: 'target-drift',
      message: 'Clean-room target authority is not canonical.',
    };
  }
  if (
    !sameMachine(parsedTarget.data, input.featureTarget) ||
    parsedTarget.data.workspaceId === input.featureTarget.workspaceId ||
    parsedTarget.data.path === input.featureTarget.path
  ) {
    return {
      type: 'target-drift',
      message: 'Clean room must be a distinct disposable workspace on the feature machine.',
    };
  }
  return undefined;
}

export function validateBeginning(
  authority: E2EAttemptAuthority,
  target: LoopSessionTarget,
  featureHead: string
): { type: string; message: string } | undefined {
  if (
    !authority ||
    typeof authority !== 'object' ||
    !sameTarget(authority.target, target) ||
    !validId(authority.mutationBaseline) ||
    !validCommit(authority.headCommit) ||
    typeof authority.clean !== 'boolean' ||
    typeof authority.branchAttached !== 'boolean'
  ) {
    return {
      type: 'authority-invalid',
      message: 'Attempt authority returned invalid target or baseline.',
    };
  }
  if (authority.headCommit !== featureHead) {
    return {
      type: 'checkpoint-drift',
      message: 'Fresh clean-room head does not match feature authority.',
    };
  }
  if (!authority.clean || !authority.branchAttached) {
    return { type: 'dirty-workspace', message: 'Fresh clean room is not clean and attached.' };
  }
  return undefined;
}

export function freshAttemptIdentity(
  attempt: LoopSessionAttempt,
  input: NormalizedInput,
  currentAttempts: readonly LoopSessionAttempt[]
): boolean {
  return ![...input.previousSessionAttempts, ...currentAttempts].some(
    (existing) =>
      existing.attemptId === attempt.attemptId || existing.conversationId === attempt.conversationId
  );
}

export function sameSessionIdentity(
  left: Pick<E2ESessionInfo, 'attemptId' | 'conversationId'>,
  right: Pick<E2ESessionInfo, 'attemptId' | 'conversationId'>
): boolean {
  return left.attemptId === right.attemptId && left.conversationId === right.conversationId;
}

export function validateInspection(
  inspection: E2EAttemptInspection,
  target: LoopSessionTarget,
  mutationBaseline: string
): { type: string; message: string } | undefined {
  if (
    !inspection ||
    typeof inspection !== 'object' ||
    !sameTarget(inspection.target, target) ||
    inspection.mutationBaseline !== mutationBaseline ||
    !validCommit(inspection.headCommit) ||
    typeof inspection.mutated !== 'boolean'
  ) {
    return { type: 'authority-invalid', message: 'Attempt inspection returned invalid authority.' };
  }
  if (!inspection.clean || !inspection.branchAttached) {
    return { type: 'dirty-workspace', message: 'Attempt workspace is not clean and attached.' };
  }
  return undefined;
}

export function validateCorrectionInspection(
  inspection: E2EAttemptInspection,
  featureHead: string
): { type: string; message: string } | undefined {
  if (!inspection.mutated || inspection.headCommit === featureHead) {
    return {
      type: 'correction-authority-invalid',
      message: 'Correction-ready requires trusted mutation and one changed clean checkpoint.',
    };
  }
  return undefined;
}

export function validatePassInspection(
  inspection: E2EAttemptInspection,
  featureHead: string
): { type: string; message: string } | undefined {
  if (inspection.mutated) {
    return {
      type: 'mutation-concealed',
      message: 'A mutated attempt cannot be a fresh pass candidate.',
    };
  }
  if (inspection.headCommit !== featureHead) {
    return {
      type: 'checkpoint-drift',
      message: 'Pass candidate changed the clean-room checkpoint.',
    };
  }
  return undefined;
}

export function settlePreallocatedNestedAttempt(
  attempts: LoopSessionAttempt[],
  index: number,
  value: unknown,
  active: ActiveAttempt,
  featureHead: string,
  input: NormalizedInput,
  settledAt: string
): void {
  try {
    const starting = attempts[index];
    if (!starting || starting.purpose !== 'browser-verification') return;
    const candidates =
      value && typeof value === 'object'
        ? (value as { sessionAttempts?: unknown }).sessionAttempts
        : undefined;
    if (Array.isArray(candidates)) {
      for (const candidate of candidates.slice(0, 3)) {
        const adopted = normalizeNestedAttempt(
          candidate,
          starting,
          active,
          featureHead,
          input,
          settledAt
        );
        if (adopted) {
          attempts[index] = adopted;
          return;
        }
      }
    }
    markNestedAttemptInterrupted(
      attempts,
      index,
      settledAt,
      'Nested verification settled quiescently without exact terminal evidence.'
    );
  } catch {
    markNestedAttemptInterrupted(
      attempts,
      index,
      settledAt,
      'Nested verification returned unreadable terminal evidence.'
    );
  }
}

export type NestedAttemptSettlement = {
  expected: LoopSessionAttempt;
  actuals: readonly LoopSessionAttempt[];
  ambiguousActual: boolean;
};

export function collectNestedAttemptSettlement(
  attempts: readonly LoopSessionAttempt[],
  index: number,
  value: unknown,
  active: ActiveAttempt,
  featureHead: string,
  input: NormalizedInput,
  settledAt: string
): NestedAttemptSettlement {
  const starting = attempts[index];
  if (!starting || starting.purpose !== 'browser-verification') {
    throw new TypeError('Nested settlement requires its preallocated browser attempt.');
  }
  let expected: LoopSessionAttempt | undefined;
  const actuals: LoopSessionAttempt[] = [];
  let ambiguousActual = false;
  try {
    const candidates =
      value && typeof value === 'object'
        ? (value as { sessionAttempts?: unknown }).sessionAttempts
        : undefined;
    if (Array.isArray(candidates)) {
      if (candidates.length > 4) ambiguousActual = true;
      for (const candidate of candidates.slice(0, 4)) {
        const normalized = normalizeNestedAttemptCandidate(
          candidate,
          starting,
          active,
          featureHead,
          input,
          settledAt
        );
        if (!normalized) continue;
        if (
          normalized.attemptId === starting.attemptId &&
          normalized.conversationId === starting.conversationId
        ) {
          expected ??= copyAttempt({
            ...normalized,
            startedAt: starting.startedAt,
            ...(normalized.finishedAt
              ? {
                  finishedAt: monotonicTimestamp(
                    starting.startedAt,
                    normalized.finishedAt,
                    settledAt
                  ),
                }
              : {}),
          });
          continue;
        }
        const collides =
          input.previousSessionAttempts.some(
            (attempt) =>
              attempt.attemptId === normalized.attemptId ||
              attempt.conversationId === normalized.conversationId
          ) ||
          attempts.some(
            (attempt, attemptIndex) =>
              attemptIndex !== index &&
              (attempt.attemptId === normalized.attemptId ||
                attempt.conversationId === normalized.conversationId)
          );
        if (collides) continue;
        actuals.push(normalized);
        ambiguousActual = actuals.length > 1;
      }
    }
  } catch {
    // Fall through to the preallocated interrupted authority.
  }
  return {
    expected:
      expected ??
      copyAttempt({
        ...starting,
        status: 'interrupted',
        finishedAt: monotonicTimestamp(starting.startedAt, settledAt),
        error: 'Nested verification returned no exact terminal evidence.',
      }),
    actuals,
    ambiguousActual,
  };
}

function normalizeNestedAttemptCandidate(
  value: unknown,
  starting: LoopSessionAttempt,
  active: ActiveAttempt,
  featureHead: string,
  input: NormalizedInput,
  settledAt: string
): LoopSessionAttempt | undefined {
  try {
    const parsed = loopSessionAttemptSchema.safeParse(value);
    if (
      !parsed.success ||
      !hasCanonicalAttemptFields(value, parsed.data) ||
      parsed.data.purpose !== 'browser-verification' ||
      parsed.data.phaseId !== input.phase.id ||
      parsed.data.verificationRunId !== active.verificationRunId ||
      parsed.data.checkpointBefore !== featureHead ||
      (parsed.data.checkpointAfter !== undefined && parsed.data.checkpointAfter !== featureHead) ||
      parsed.data.conversationId === active.session.conversationId ||
      !sameTarget(parsed.data.target, active.cleanRoom.target)
    ) {
      return undefined;
    }
    const terminal = ['completed', 'failed', 'cancelled', 'interrupted'].includes(
      parsed.data.status
    );
    if (terminal && parsed.data.finishedAt === undefined) return undefined;
    if (parsed.data.status === 'completed' && parsed.data.checkpointAfter !== featureHead) {
      return undefined;
    }
    const finishedAt = monotonicTimestamp(
      starting.startedAt,
      parsed.data.startedAt,
      parsed.data.finishedAt,
      settledAt
    );
    return copyAttempt({
      attemptId: parsed.data.attemptId,
      conversationId: parsed.data.conversationId,
      purpose: 'browser-verification',
      phaseId: input.phase.id,
      verificationRunId: active.verificationRunId,
      target: copyTarget(active.cleanRoom.target),
      checkpointBefore: featureHead,
      startedAt: parsed.data.startedAt,
      ...(parsed.data.status === 'completed'
        ? { status: 'completed', checkpointAfter: featureHead, finishedAt }
        : terminal
          ? {
              status: parsed.data.status,
              finishedAt,
              error: boundedSummary(
                parsed.data.error,
                'Nested verification did not complete successfully.'
              ),
            }
          : {
              status: 'interrupted',
              finishedAt,
              error: 'Nested verification settled without terminal evidence.',
            }),
    });
  } catch {
    return undefined;
  }
}

export function normalizeNestedAttempt(
  value: unknown,
  starting: LoopSessionAttempt,
  active: ActiveAttempt,
  featureHead: string,
  input: NormalizedInput,
  settledAt: string
): LoopSessionAttempt | undefined {
  try {
    const parsed = loopSessionAttemptSchema.safeParse(value);
    if (
      !parsed.success ||
      !hasCanonicalAttemptFields(value, parsed.data) ||
      parsed.data.attemptId !== starting.attemptId ||
      parsed.data.conversationId !== starting.conversationId ||
      parsed.data.purpose !== 'browser-verification' ||
      parsed.data.phaseId !== input.phase.id ||
      parsed.data.verificationRunId !== active.verificationRunId ||
      parsed.data.checkpointBefore !== featureHead ||
      (parsed.data.checkpointAfter !== undefined && parsed.data.checkpointAfter !== featureHead) ||
      parsed.data.conversationId === active.session.conversationId ||
      !sameTarget(parsed.data.target, active.cleanRoom.target)
    ) {
      return undefined;
    }
    const terminal = ['completed', 'failed', 'cancelled', 'interrupted'].includes(
      parsed.data.status
    );
    if (terminal && parsed.data.finishedAt === undefined) return undefined;
    if (parsed.data.status === 'completed' && parsed.data.checkpointAfter !== featureHead) {
      return undefined;
    }
    const finishedAt = monotonicTimestamp(starting.startedAt, parsed.data.finishedAt, settledAt);
    const {
      checkpointAfter: _checkpointAfter,
      error: _error,
      finishedAt: _finishedAt,
      ...identity
    } = parsed.data;
    return copyAttempt({
      ...identity,
      startedAt: starting.startedAt,
      ...(parsed.data.status === 'completed'
        ? { status: 'completed', checkpointAfter: featureHead, finishedAt }
        : terminal
          ? {
              status: parsed.data.status,
              finishedAt,
              error: boundedSummary(
                parsed.data.error,
                'Nested verification did not complete successfully.'
              ),
            }
          : {
              status: 'interrupted',
              finishedAt,
              error: 'Nested verification settled quiescently without terminal evidence.',
            }),
    });
  } catch {
    return undefined;
  }
}

export function markNestedAttemptInterrupted(
  attempts: LoopSessionAttempt[],
  index: number,
  finishedAt: string,
  error: string
): void {
  const current = attempts[index];
  if (!current) return;
  attempts[index] = copyAttempt({
    ...current,
    status: 'interrupted',
    finishedAt: monotonicTimestamp(current.startedAt, finishedAt),
    error,
  });
}

export function validatePostChecks(
  inspection: E2EAttemptInspection,
  target: LoopSessionTarget,
  mutationBaseline: string,
  featureHead: string
): { type: string; message: string } | undefined {
  const common = validateInspection(inspection, target, mutationBaseline);
  if (common) return common;
  if (inspection.mutated || inspection.headCommit !== featureHead) {
    return {
      type: 'post-check-drift',
      message: 'Required checks mutated or moved the clean-room checkpoint.',
    };
  }
  return undefined;
}

export function validateFeature(
  feature: E2EFeatureInspection,
  target: LoopSessionTarget,
  featureHead: string
): { type: string; message: string } | undefined {
  if (
    !feature ||
    typeof feature !== 'object' ||
    !loopSessionTargetSchema.safeParse(feature.target).success ||
    !validCommit(feature.headCommit) ||
    typeof feature.clean !== 'boolean' ||
    typeof feature.branchAttached !== 'boolean'
  ) {
    return {
      type: 'feature-authority-invalid',
      message: 'Feature inspection returned malformed authority.',
    };
  }
  if (!sameTarget(feature.target, target) || feature.headCommit !== featureHead) {
    return {
      type: 'feature-head-drift',
      message: 'Feature authority drifted before E2E completion.',
    };
  }
  if (!feature.clean || !feature.branchAttached) {
    return { type: 'dirty-feature', message: 'Feature workspace is not clean and attached.' };
  }
  return undefined;
}

export function tryMakeOuterAttempt(
  session: unknown,
  authoritativeTarget: LoopSessionTarget,
  checkpoint: string,
  startedAt: string,
  status: 'starting' | 'running' = 'running'
): LoopSessionAttempt | undefined {
  try {
    if (!session || typeof session !== 'object') return undefined;
    const candidate = session as Partial<E2ESessionInfo>;
    const parsed = loopSessionAttemptSchema.safeParse({
      attemptId: candidate.attemptId,
      conversationId: candidate.conversationId,
      purpose: candidate.purpose,
      phaseId: candidate.phaseId,
      verificationRunId: candidate.verificationRunId,
      target: copyTarget(authoritativeTarget),
      status,
      checkpointBefore: checkpoint,
      startedAt,
    });
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function hasUsableCancellationIdentity(value: unknown): value is E2ESessionInfo {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<E2ESessionInfo>;
  return (
    validId(candidate.attemptId) &&
    validId(candidate.conversationId) &&
    candidate.purpose === 'e2e' &&
    validId(candidate.phaseId) &&
    validId(candidate.verificationRunId) &&
    Number.isInteger(candidate.attempt) &&
    (candidate.attempt ?? 0) > 0 &&
    (candidate.attempt ?? 0) <= MAX_ATTEMPTS
  );
}

export function markOuterAttempt(
  attempts: LoopSessionAttempt[],
  index: number,
  status: 'completed' | 'failed' | 'cancelled' | 'interrupted',
  finishedAt: Date,
  extra: { checkpointAfter?: string; error?: string } = {}
): void {
  const current = attempts[index];
  if (!current) return;
  if (['completed', 'failed', 'cancelled', 'interrupted'].includes(current.status)) return;
  attempts[index] = loopSessionAttemptSchema.parse({
    ...current,
    status,
    finishedAt: monotonicTimestamp(current.startedAt, finishedAt.toISOString()),
    ...(extra.checkpointAfter ? { checkpointAfter: extra.checkpointAfter } : {}),
    ...(extra.error ? { error: boundedSummary(extra.error, 'E2E attempt failed.') } : {}),
  });
}

export function copyAttempt(attempt: LoopSessionAttempt): LoopSessionAttempt {
  return loopSessionAttemptSchema.parse({
    ...attempt,
    ...(attempt.error !== undefined
      ? { error: boundedSummary(attempt.error, 'E2E attempt failed.') }
      : {}),
  });
}
