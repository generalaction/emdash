import { Buffer } from 'node:buffer';
import { posix, win32 } from 'node:path';
import { redactAll } from '@emdash/shared/logger';
import z from 'zod';
import { loopPhaseHandoffSchema } from '@shared/core/loops/loop-phase-state';
import {
  loopCommitSchema,
  loopSessionAttemptSchema,
  loopSessionTargetSchema,
  loopStateInputSchema,
  loopStateV1Schema,
  loopStateV2Schema,
  type LoopSessionAttempt,
  type LoopSessionTarget,
} from '@shared/core/loops/loop-state';
import { loopPhaseCriterionSchema, type LoopPhaseCriterion } from '@shared/core/loops/loops';
import { loopPromptHandoffSchema, type LoopPromptHandoff } from '../handoff-builder';
import type { LoopExecutionTarget } from '../runtime/loop-execution-target';

const MAX_ID_LENGTH = 256;
const MAX_SUMMARY_LENGTH = 16_384;
const MAX_STABLE_SUCCESS_BYTES = 2 * 1024 * 1024;
const cookieAssignmentPattern =
  /\b(?:cookies?|set[_ -]?cookie|session[_ -]?(?:cookie|id)|sessionid)\b[\\'"\s]*[:=][\s\S]*/giu;
const trustedTaskEnvironmentSchema = z.record(z.string(), z.string());

export function copyCriterion(criterion: LoopPhaseCriterion): LoopPhaseCriterion {
  return loopPhaseCriterionSchema.parse(criterion);
}

export function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function sameCriteria(
  left: readonly LoopPhaseCriterion[],
  right: readonly LoopPhaseCriterion[]
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => {
      const expected = right[index];
      return (
        !!expected &&
        value.description === expected.description &&
        value.verifier === expected.verifier &&
        value.status === expected.status &&
        value.evidence === expected.evidence
      );
    })
  );
}

export function hasCanonicalPhaseCriteria(
  value: unknown,
  canonical: readonly LoopPhaseCriterion[]
): boolean {
  try {
    if (!value || typeof value !== 'object') return false;
    const raw = value as { version?: unknown; criteria?: unknown };
    return (
      hasExactOwnKeys(value, ['criteria', 'version']) &&
      raw.version === '1' &&
      Array.isArray(raw.criteria) &&
      raw.criteria.length === canonical.length &&
      raw.criteria.every((criterion, index) => sameCanonicalJsonShape(criterion, canonical[index]))
    );
  } catch {
    return false;
  }
}

export function copyPromptHandoff(handoff: LoopPromptHandoff): LoopPromptHandoff {
  const parsed = loopPromptHandoffSchema.parse(handoff);
  if (
    !hasCanonicalPromptHandoffAuthority(handoff, parsed) ||
    !validId(parsed.source) ||
    !validTimestamp(parsed.handoff.createdAt) ||
    parsed.handoff.artifacts.some(
      (artifact) => !validId(artifact.artifactId) || !validTimestamp(artifact.createdAt)
    )
  ) {
    throw new TypeError('Prompt handoff contains non-canonical persisted authority.');
  }
  return loopPromptHandoffSchema.parse({
    source: boundedSummary(parsed.source, 'Redacted handoff').slice(0, 256),
    handoff: {
      summary: boundedSummary(parsed.handoff.summary, 'Redacted handoff summary.'),
      risks: parsed.handoff.risks.map((risk) =>
        boundedSummary(risk, 'Redacted risk.').slice(0, 2_048)
      ),
      remainingWork: parsed.handoff.remainingWork.map((item) =>
        boundedSummary(item, 'Redacted remaining work.').slice(0, 2_048)
      ),
      artifacts: parsed.handoff.artifacts.map((artifact) => ({
        artifactId: artifact.artifactId,
        kind: artifact.kind,
        ...(artifact.label !== undefined
          ? { label: boundedSummary(artifact.label, 'Redacted artifact.').slice(0, 256) }
          : {}),
        ...(artifact.mimeType !== undefined
          ? {
              mimeType: boundedSummary(artifact.mimeType, 'application/octet-stream').slice(0, 128),
            }
          : {}),
        byteLength: artifact.byteLength,
        createdAt: artifact.createdAt,
      })),
      createdAt: parsed.handoff.createdAt,
    },
  });
}

export function hasCanonicalPromptHandoffAuthority(
  value: unknown,
  canonical: LoopPromptHandoff
): boolean {
  try {
    if (!value || typeof value !== 'object') return false;
    const raw = value as { source?: unknown; handoff?: unknown };
    if (
      !hasExactOwnKeys(value, ['handoff', 'source']) ||
      raw.source !== canonical.source ||
      !raw.handoff ||
      typeof raw.handoff !== 'object'
    ) {
      return false;
    }
    const handoff = raw.handoff as {
      artifacts?: unknown;
      createdAt?: unknown;
    };
    if (
      !hasExactOwnKeys(raw.handoff, [
        'artifacts',
        'createdAt',
        'remainingWork',
        'risks',
        'summary',
      ]) ||
      handoff.createdAt !== canonical.handoff.createdAt ||
      !Array.isArray(handoff.artifacts) ||
      handoff.artifacts.length !== canonical.handoff.artifacts.length
    ) {
      return false;
    }
    return handoff.artifacts.every((candidate, index) => {
      const expected = canonical.handoff.artifacts[index];
      return !!expected && sameCanonicalJsonShape(candidate, expected);
    });
  } catch {
    return false;
  }
}

export function tryCopyPromptHandoff(value: unknown): LoopPromptHandoff | undefined {
  try {
    return copyPromptHandoff(value as LoopPromptHandoff);
  } catch {
    return undefined;
  }
}

export function safeCopyPromptHandoffs(value: unknown): LoopPromptHandoff[] {
  if (!Array.isArray(value)) return [];
  const copied: LoopPromptHandoff[] = [];
  for (const candidate of value.slice(0, 64)) {
    const copy = tryCopyPromptHandoff(candidate);
    if (copy) copied.push(copy);
  }
  return copied;
}

export function copyTarget(target: LoopSessionTarget): LoopSessionTarget {
  return loopSessionTargetSchema.parse(target);
}

export function isCanonicalTarget(value: unknown, canonical: LoopSessionTarget): boolean {
  try {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<LoopSessionTarget>;
    if (!candidate.machine || typeof candidate.machine !== 'object') return false;
    const expectedTargetKeys = ['machine', 'path', 'workspaceId'];
    const expectedMachineKeys =
      canonical.machine.kind === 'local' ? ['kind'] : ['connectionId', 'kind'];
    return (
      hasExactOwnKeys(value, expectedTargetKeys) &&
      hasExactOwnKeys(candidate.machine, expectedMachineKeys) &&
      validId(candidate.workspaceId) &&
      isCanonicalAbsolutePath(candidate.path) &&
      candidate.workspaceId === canonical.workspaceId &&
      candidate.path === canonical.path &&
      candidate.machine.kind === canonical.machine.kind &&
      (canonical.machine.kind === 'local' ||
        (candidate.machine.kind === 'ssh' &&
          validId(candidate.machine.connectionId) &&
          candidate.machine.connectionId === canonical.machine.connectionId))
    );
  } catch {
    return false;
  }
}

export function copyEnvironment(
  environment: Readonly<Record<string, string>>
): Readonly<Record<string, string>> {
  return Object.freeze({ ...environment });
}

export function sameEnvironment(left: unknown, right: unknown): boolean {
  const parsedLeft = trustedTaskEnvironmentSchema.safeParse(left);
  const parsedRight = trustedTaskEnvironmentSchema.safeParse(right);
  if (!parsedLeft.success || !parsedRight.success) return false;
  const leftEnvironment = parsedLeft.data;
  const rightEnvironment = parsedRight.data;
  const leftKeys = Object.keys(leftEnvironment).sort();
  const rightKeys = Object.keys(rightEnvironment).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) => key === rightKeys[index] && leftEnvironment[key] === rightEnvironment[key]
    )
  );
}

export function sameTarget(left: unknown, right: unknown): boolean {
  const parsedLeft = parseTargetLike(left);
  const parsedRight = parseTargetLike(right);
  if (
    !parsedLeft.success ||
    !parsedRight.success ||
    !isCanonicalTarget(left, parsedLeft.data) ||
    !isCanonicalTarget(right, parsedRight.data)
  ) {
    return false;
  }
  const leftTarget = parsedLeft.data;
  const rightTarget = parsedRight.data;
  return (
    leftTarget.workspaceId === rightTarget.workspaceId &&
    leftTarget.path === rightTarget.path &&
    leftTarget.machine.kind === rightTarget.machine.kind &&
    (leftTarget.machine.kind === 'local' ||
      (rightTarget.machine.kind === 'ssh' &&
        leftTarget.machine.connectionId === rightTarget.machine.connectionId))
  );
}

export function sameExecutionTargetIdentity(
  value: LoopExecutionTarget,
  expected: LoopSessionTarget
): boolean {
  try {
    const identity: LoopSessionTarget = {
      workspaceId: value.workspaceId,
      path: value.path,
      machine: value.machine,
    };
    return isCanonicalTarget(identity, expected) && sameTarget(identity, expected);
  } catch {
    return false;
  }
}

export function hasCanonicalAttemptTarget(
  candidate: unknown,
  expected: LoopSessionTarget
): boolean {
  try {
    return (
      !!candidate &&
      typeof candidate === 'object' &&
      sameTarget((candidate as { target?: unknown }).target, expected)
    );
  } catch {
    return false;
  }
}

export function hasCanonicalAttemptFields(candidate: unknown, parsed: LoopSessionAttempt): boolean {
  try {
    if (!candidate || typeof candidate !== 'object') return false;
    const raw = candidate as Partial<LoopSessionAttempt>;
    const expectedKeys = [
      'attemptId',
      'conversationId',
      'purpose',
      'startedAt',
      'status',
      'target',
      ...(parsed.phaseId === undefined ? [] : ['phaseId']),
      ...(parsed.verificationRunId === undefined ? [] : ['verificationRunId']),
      ...(parsed.checkpointBefore === undefined ? [] : ['checkpointBefore']),
      ...(parsed.checkpointAfter === undefined ? [] : ['checkpointAfter']),
      ...(parsed.finishedAt === undefined ? [] : ['finishedAt']),
      ...(parsed.error === undefined ? [] : ['error']),
    ];
    return (
      hasExactOwnKeys(candidate, expectedKeys) &&
      validId(raw.attemptId) &&
      validId(raw.conversationId) &&
      (raw.phaseId === undefined || validId(raw.phaseId)) &&
      (raw.verificationRunId === undefined || validId(raw.verificationRunId)) &&
      validTimestamp(raw.startedAt) &&
      (raw.finishedAt === undefined || validTimestamp(raw.finishedAt)) &&
      (raw.finishedAt === undefined || Date.parse(raw.finishedAt) >= Date.parse(raw.startedAt)) &&
      (raw.error === undefined ||
        (typeof raw.error === 'string' &&
          raw.error === raw.error.trim() &&
          raw.error.length > 0 &&
          redactPersistedText(raw.error) === raw.error)) &&
      raw.attemptId === parsed.attemptId &&
      raw.conversationId === parsed.conversationId &&
      raw.purpose === parsed.purpose &&
      raw.phaseId === parsed.phaseId &&
      raw.verificationRunId === parsed.verificationRunId &&
      raw.status === parsed.status &&
      raw.checkpointBefore === parsed.checkpointBefore &&
      raw.checkpointAfter === parsed.checkpointAfter &&
      raw.startedAt === parsed.startedAt &&
      raw.finishedAt === parsed.finishedAt &&
      raw.error === parsed.error &&
      hasCanonicalAttemptTarget(candidate, parsed.target)
    );
  } catch {
    return false;
  }
}

export function hasCanonicalPersistedLoopState(value: unknown): boolean {
  try {
    if (!value || typeof value !== 'object') return false;
    const rawVersion = (value as { version?: unknown }).version;
    const rawState =
      rawVersion === '1'
        ? loopStateV1Schema.safeParse(value)
        : rawVersion === '2'
          ? loopStateV2Schema.safeParse(value)
          : { success: false as const };
    const parsedState = loopStateInputSchema.safeParse(value);
    if (
      !rawState.success ||
      !parsedState.success ||
      !sameCanonicalJsonShape(value, rawState.data)
    ) {
      return false;
    }
    const state = value as {
      sessionAttempts?: unknown;
      verification?: unknown;
    };
    if (
      !Array.isArray(state.sessionAttempts) ||
      state.sessionAttempts.some((attempt) => {
        const parsed = loopSessionAttemptSchema.safeParse(attempt);
        return (
          !parsed.success ||
          !hasCanonicalAttemptFields(attempt, parsed.data) ||
          !validPersistedAttemptState(parsed.data)
        );
      })
    ) {
      return false;
    }
    if (state.verification === null) return true;
    if (!state.verification || typeof state.verification !== 'object') return false;
    const verification = state.verification as {
      verificationRunId?: unknown;
      target?: unknown;
      cleanup?: unknown;
    };
    if (!validId(verification.verificationRunId)) return false;
    if (verification.target !== undefined) {
      const target = loopSessionTargetSchema.safeParse(verification.target);
      if (!target.success || !isCanonicalTarget(verification.target, target.data)) return false;
    }
    if (!verification.cleanup || typeof verification.cleanup !== 'object') return false;
    const cleanup = verification.cleanup as { updatedAt?: unknown; error?: unknown };
    return (
      validTimestamp(cleanup.updatedAt) &&
      (cleanup.error === undefined ||
        (typeof cleanup.error === 'string' && redactPersistedText(cleanup.error) === cleanup.error))
    );
  } catch {
    return false;
  }
}

export function validPersistedAttemptState(attempt: LoopSessionAttempt): boolean {
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
  return (
    attempt.finishedAt !== undefined &&
    attempt.checkpointAfter === undefined &&
    attempt.error !== undefined
  );
}

export function hasCanonicalPhaseState(value: unknown): boolean {
  try {
    if (value === undefined || value === null) return true;
    if (!value || typeof value !== 'object') return false;
    const state = value as {
      version?: unknown;
      checkpointCommit?: unknown;
      handoff?: unknown;
      retryHandoffs?: unknown;
      result?: unknown;
    };
    if (
      (state.version !== '1' && state.version !== '2') ||
      !hasExactOwnKeys(
        value,
        state.version === '2'
          ? ['checkpointCommit', 'handoff', 'result', 'retryHandoffs', 'version']
          : ['checkpointCommit', 'handoff', 'result', 'version']
      ) ||
      (state.checkpointCommit !== null && !validCommit(state.checkpointCommit))
    ) {
      return false;
    }
    if (
      state.handoff !== null &&
      state.handoff !== undefined &&
      !hasCanonicalPhaseHandoff(state.handoff)
    ) {
      return false;
    }
    if (state.version === '2') {
      if (
        !Array.isArray(state.retryHandoffs) ||
        state.retryHandoffs.some((handoff) => !hasCanonicalPersistedPromptHandoff(handoff))
      ) {
        return false;
      }
    }
    if (state.result !== null && state.result !== undefined) {
      if (!state.result || typeof state.result !== 'object') return false;
      const result = state.result as { completedAt?: unknown; summary?: unknown };
      if (
        !validTimestamp(result.completedAt) ||
        typeof result.summary !== 'string' ||
        redactPersistedText(result.summary) !== result.summary
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function hasCanonicalPersistedPromptHandoff(value: unknown): boolean {
  try {
    const parsed = loopPromptHandoffSchema.safeParse(value);
    return (
      parsed.success &&
      hasCanonicalPromptHandoffAuthority(value, parsed.data) &&
      validId(parsed.data.source) &&
      hasCanonicalPhaseHandoff(parsed.data.handoff)
    );
  } catch {
    return false;
  }
}

export function hasCanonicalPhaseHandoff(value: unknown): boolean {
  try {
    const parsed = loopPhaseHandoffSchema.safeParse(value);
    if (!parsed.success || !sameCanonicalJsonShape(value, parsed.data)) return false;
    return (
      redactPersistedText(parsed.data.summary) === parsed.data.summary &&
      parsed.data.risks.every((risk) => redactPersistedText(risk) === risk) &&
      parsed.data.remainingWork.every((item) => redactPersistedText(item) === item) &&
      validTimestamp(parsed.data.createdAt) &&
      parsed.data.artifacts.every(
        (artifact) =>
          validId(artifact.artifactId) &&
          validTimestamp(artifact.createdAt) &&
          (artifact.label === undefined ||
            redactPersistedText(artifact.label) === artifact.label) &&
          (artifact.mimeType === undefined ||
            redactPersistedText(artifact.mimeType) === artifact.mimeType)
      )
    );
  } catch {
    return false;
  }
}

export function hasExactOwnKeys(value: object, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string')) return false;
  const actual = (keys as string[]).sort();
  const canonical = [...expected].sort();
  return (
    actual.length === canonical.length && actual.every((key, index) => key === canonical[index])
  );
}

export function sameCanonicalJsonShape(value: unknown, canonical: unknown): boolean {
  if (
    value === null ||
    canonical === null ||
    typeof value !== 'object' ||
    typeof canonical !== 'object'
  ) {
    return Object.is(value, canonical);
  }
  if (Array.isArray(value) || Array.isArray(canonical)) {
    return (
      Array.isArray(value) &&
      Array.isArray(canonical) &&
      value.length === canonical.length &&
      value.every((item, index) => sameCanonicalJsonShape(item, canonical[index]))
    );
  }
  const canonicalKeys = Object.keys(canonical);
  if (!hasExactOwnKeys(value, canonicalKeys)) return false;
  const raw = value as Record<string, unknown>;
  const expected = canonical as Record<string, unknown>;
  return canonicalKeys.every((key) => sameCanonicalJsonShape(raw[key], expected[key]));
}

export function parseTargetLike(
  value: unknown
): ReturnType<typeof loopSessionTargetSchema.safeParse> {
  if (!value || typeof value !== 'object') return loopSessionTargetSchema.safeParse(value);
  const candidate = value as Partial<LoopSessionTarget>;
  return loopSessionTargetSchema.safeParse({
    workspaceId: candidate.workspaceId,
    path: candidate.path,
    machine: candidate.machine,
  });
}

export function sameMachine(left: LoopSessionTarget, right: LoopSessionTarget): boolean {
  return (
    left.machine.kind === right.machine.kind &&
    (left.machine.kind === 'local' ||
      (right.machine.kind === 'ssh' && left.machine.connectionId === right.machine.connectionId))
  );
}

export function validId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    redactPersistedText(value) === value
  );
}

export function validCommit(value: unknown): value is string {
  return loopCommitSchema.safeParse(value).success;
}

export function serializedBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function isCanonicalAbsolutePath(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 4_096 ||
    value !== value.trim() ||
    value.includes('\0') ||
    redactPersistedText(value) !== value
  ) {
    return false;
  }
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

export function validTimestamp(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value !== value.trim() ||
    value.length === 0 ||
    value.length > 64 ||
    redactPersistedText(value) !== value
  ) {
    return false;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

export function monotonicTimestamp(...candidates: Array<string | undefined>): string {
  let latest: { value: string; time: number } | undefined;
  for (const value of candidates) {
    if (!validTimestamp(value)) continue;
    const time = Date.parse(value);
    if (!latest || time > latest.time) latest = { value, time };
  }
  if (!latest) throw new TypeError('A monotonic timestamp requires canonical time authority.');
  return latest.value;
}

export function validAbortSignal(value: unknown): value is AbortSignal {
  return typeof AbortSignal !== 'undefined' && value instanceof AbortSignal;
}

export function boundedSummary(value: unknown, fallback: string): string {
  const candidate = typeof value === 'string' ? value : fallback;
  const redacted = redactPersistedText(candidate).trim();
  return (redacted || redactPersistedText(fallback)).slice(0, MAX_SUMMARY_LENGTH);
}

export function redactPersistedText(value: string): string {
  return redactAll(value.replace(cookieAssignmentPattern, '[REDACTED_COOKIE]'));
}
export function stabilizePlainSuccess<T>(value: unknown): T | undefined {
  try {
    const serialized = JSON.stringify(value);
    if (
      serialized === undefined ||
      Buffer.byteLength(serialized, 'utf8') > MAX_STABLE_SUCCESS_BYTES
    ) {
      return undefined;
    }
    return JSON.parse(serialized) as T;
  } catch {
    return undefined;
  }
}
