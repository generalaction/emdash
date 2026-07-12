import { Buffer } from 'node:buffer';
import { redactAll } from '@emdash/shared/logger';
import { err, ok, type Result } from '@main/lib/result';
import { loopPhaseStateInputSchema } from '@shared/core/loops/loop-phase-state';
import {
  loopCommitSchema,
  loopSessionAttemptSchema,
  loopSessionTargetSchema,
  loopStateV1Schema,
  type LoopSessionTarget,
} from '@shared/core/loops/loop-state';
import {
  loopPhaseCriteriaV1Schema,
  loopPhaseCriterionSchema,
  newLoopConfigV2Schema,
  type Loop,
  type LoopPhase,
  type LoopPhaseCriterion,
} from '@shared/core/loops/loops';
import type { LoopExecutionTarget } from '../runtime/loop-execution-target';
import type {
  NativeBrowserE2EAttestationError,
  NativeBrowserE2EAttestationPort,
} from '../verifiers/native-browser-e2e-attestation';
import type { LoopVerifier } from '../verifiers/types';
import { unitTestsVerifier } from '../verifiers/unit-tests';
import type {
  E2ERequiredChecksError,
  E2ERequiredChecksPort,
  E2ERequiredChecksResult,
} from './clean-room-e2e-gate';
import { sameE2EDurableProgress } from './clean-room-e2e-progress';

const MAX_ID_LENGTH = 256;
const MAX_MODEL_LENGTH = 256;
const MAX_SUMMARY_LENGTH = 16_384;
const MAX_TASK_ENVIRONMENT_BYTES = 64 * 1024;
const MAX_TASK_ENVIRONMENT_VALUE_LENGTH = 4_096;
const TRUSTED_TASK_ENVIRONMENT_KEYS = [
  'EMDASH_DEFAULT_BRANCH',
  'EMDASH_PORT',
  'EMDASH_ROOT_PATH',
  'EMDASH_TASK_ID',
  'EMDASH_TASK_NAME',
  'EMDASH_TASK_PATH',
] as const;
const cookieAssignmentPattern =
  /\b(?:cookies?|set[_ -]?cookie|session[_ -]?(?:cookie|id)|sessionid)\b[\\'"\s]*[:=][\s\S]*/giu;

export type CleanRoomE2ERequiredChecksContext = {
  loop: Loop;
  phase: LoopPhase;
};

export type CleanRoomE2ERequiredChecksDependencies = {
  /** Reads the loop and phase from the same durable authority named by the gate request. */
  resolveContext(
    authority: Parameters<E2ERequiredChecksPort['run']>[0]['authority']
  ): Promise<Result<CleanRoomE2ERequiredChecksContext, E2ERequiredChecksError>>;
  native: NativeBrowserE2EAttestationPort;
  validationVerifier?: LoopVerifier;
  now(): Date;
};

export class CleanRoomE2ERequiredChecksAdapter implements E2ERequiredChecksPort {
  private readonly validationVerifier: LoopVerifier;

  constructor(private readonly dependencies: CleanRoomE2ERequiredChecksDependencies) {
    this.validationVerifier = dependencies.validationVerifier ?? unitTestsVerifier;
  }

  async run(
    input: Parameters<E2ERequiredChecksPort['run']>[0]
  ): Promise<Result<E2ERequiredChecksResult, E2ERequiredChecksError>> {
    if (!validRequestEnvelope(input)) {
      return invalidContext();
    }

    let resolved: Awaited<ReturnType<typeof this.dependencies.resolveContext>>;
    try {
      resolved = await this.dependencies.resolveContext(input.authority);
    } catch {
      return err({
        type: 'required-checks-context-unavailable',
        message: 'Required-check authority could not be resolved.',
      });
    }
    if (!resolved.success) {
      return err({
        type: resolved.error.type ?? resolved.error.kind ?? 'required-checks-context-unavailable',
        message: safeText(
          resolved.error.message,
          'Required-check authority could not be resolved.'
        ),
        ...(resolved.error.sessionAttempts !== undefined
          ? { sessionAttempts: resolved.error.sessionAttempts }
          : {}),
      });
    }
    const context = validateContext(resolved.data, input);
    if (!context.success) return context;

    const validation = await runValidation(this.validationVerifier, context.data, input);
    const native = await this.dependencies.native.run({
      loop: context.data.loop,
      phase: context.data.phase,
      verificationRunId: input.verificationRunId,
      sessionIdentity: { ...input.sessionIdentity },
      outerConversationId: input.authority.outerConversationId,
      target: copyTarget(input.target),
      executionTarget: input.executionTarget,
      taskEnvironment: Object.freeze({ ...input.taskEnvironment }),
      provider: input.provider,
      model: input.model,
      checkpointCommit: input.checkpointCommit,
      criteria: input.criteria.map(copyCriterion),
      signal: input.signal,
      ...(input.deadlineAt !== undefined ? { deadlineAt: input.deadlineAt } : {}),
    });
    if (!native.success) return copyNativeError(native.error);

    const status = validation.success ? native.data.status : 'failed';
    const result: E2ERequiredChecksResult = {
      status,
      loopId: input.authority.loopId,
      phaseId: input.authority.phaseId,
      fullChecksRan: true,
      verificationRunId: input.verificationRunId,
      attempt: input.attempt,
      outerConversationId: input.authority.outerConversationId,
      target: copyTarget(input.target),
      executionTarget: copyTarget(input.executionTarget),
      checkpointCommit: input.checkpointCommit,
      provider: input.provider,
      model: input.model,
      validationCommands: [...input.validationCommands],
      criteria: input.criteria.map(copyCriterion),
      taskEnvironment: Object.freeze({ ...input.taskEnvironment }),
      requiredTestsSummary: validation.summary,
      nativeBrowserRan: true,
      nativePreview: {
        invocationCount: native.data.invocationCount,
        passed: native.data.passed,
        summary: safeText(native.data.summary, 'Native browser verification finished.'),
        target: copyTarget(native.data.target),
        provider: native.data.provider,
        model: native.data.model,
        taskEnvironment: Object.freeze({ ...native.data.taskEnvironment }),
      },
      sessionAttempts: [loopSessionAttemptSchema.parse(native.data.sessionAttempt)],
      ...(status === 'correctable' && native.data.handoff ? { handoff: native.data.handoff } : {}),
    };
    return ok(result);
  }
}

function validateContext(
  value: CleanRoomE2ERequiredChecksContext,
  input: Parameters<E2ERequiredChecksPort['run']>[0]
): Result<CleanRoomE2ERequiredChecksContext, E2ERequiredChecksError> {
  const config = newLoopConfigV2Schema.strict().safeParse(value.loop.config);
  const phaseCriteria = loopPhaseCriteriaV1Schema.strict().safeParse(value.phase.criteria);
  const loopState = loopStateV1Schema.safeParse(value.loop.state);
  const phaseState =
    value.phase.state === null || value.phase.state === undefined
      ? null
      : loopPhaseStateInputSchema.safeParse(value.phase.state);
  if (
    value.loop.id !== input.authority.loopId ||
    value.loop.projectId !== input.authority.projectId ||
    value.loop.taskId !== input.authority.taskId ||
    value.phase.id !== input.authority.phaseId ||
    value.phase.loopId !== value.loop.id ||
    value.phase.kind !== 'e2e' ||
    value.phase.conversationId !== input.authority.outerConversationId ||
    !config.success ||
    config.data.provider !== input.provider ||
    config.data.model !== input.model ||
    !sameStringArray(config.data.validationCommands, input.validationCommands) ||
    !phaseCriteria.success ||
    !sameCriteria(phaseCriteria.data.criteria, input.criteria) ||
    !loopState.success ||
    phaseState === null ||
    !phaseState.success ||
    !sameE2EDurableProgress(
      { loopState: loopState.data, phaseState: phaseState.data },
      input.authority.progress
    ) ||
    input.authority.progress.loopState.checkpointCommit !== input.checkpointCommit ||
    input.authority.progress.phaseState?.checkpointCommit !== input.checkpointCommit
  ) {
    return invalidContext();
  }
  return ok({
    loop: {
      ...value.loop,
      config: config.data,
      state: loopState.data,
    },
    phase: {
      ...value.phase,
      conversationId: input.authority.outerConversationId,
      criteria: phaseCriteria.data,
      state: phaseState.data,
    },
  });
}

async function runValidation(
  verifier: LoopVerifier,
  context: CleanRoomE2ERequiredChecksContext,
  input: Parameters<E2ERequiredChecksPort['run']>[0]
): Promise<{ success: boolean; summary: string }> {
  try {
    const result = await verifier.run({
      loop: context.loop,
      phase: context.phase,
      cwd: input.target.path,
      executionTarget: input.executionTarget,
      validationCommands: [...input.validationCommands],
      criteria: input.criteria.map(copyCriterion),
      signal: input.signal,
    });
    return result.success
      ? {
          success: true,
          summary: safeText(result.data.summary, 'Required validation commands passed.'),
        }
      : {
          success: false,
          summary: safeText(result.error.message, 'Required validation commands failed.'),
        };
  } catch {
    return {
      success: false,
      summary: 'Required validation commands failed to execute.',
    };
  }
}

function validRequestEnvelope(input: Parameters<E2ERequiredChecksPort['run']>[0]): boolean {
  const target = loopSessionTargetSchema.safeParse(input.target);
  const executionTarget = loopSessionTargetSchema.safeParse({
    workspaceId: input.executionTarget?.workspaceId,
    path: input.executionTarget?.path,
    machine: input.executionTarget?.machine,
  });
  return (
    validId(input.authority.loopId) &&
    validId(input.authority.projectId) &&
    validId(input.authority.taskId) &&
    validId(input.authority.phaseId) &&
    validId(input.authority.outerConversationId) &&
    validId(input.verificationRunId) &&
    Number.isInteger(input.attempt) &&
    input.attempt > 0 &&
    input.attempt <= 64 &&
    validId(input.sessionIdentity.attemptId) &&
    validId(input.sessionIdentity.conversationId) &&
    input.sessionIdentity.conversationId !== input.authority.outerConversationId &&
    target.success &&
    executionTarget.success &&
    sameTarget(target.data, executionTarget.data) &&
    sameStringRecord(input.executionTarget.taskEnv, input.taskEnvironment) &&
    validTrustedEnvironment(input.taskEnvironment, target.data) &&
    loopCommitSchema.safeParse(input.checkpointCommit).success &&
    typeof input.model === 'string' &&
    input.model === input.model.trim() &&
    input.model.length > 0 &&
    input.model.length <= MAX_MODEL_LENGTH &&
    input.validationCommands.length > 0 &&
    input.validationCommands.length <= 64 &&
    input.validationCommands.every(
      (command) =>
        typeof command === 'string' &&
        command === command.trim() &&
        command.length > 0 &&
        command.length <= 4_096
    ) &&
    input.criteria.length > 0 &&
    input.criteria.length <= 64 &&
    input.criteria.every((criterion) => loopPhaseCriterionSchema.safeParse(criterion).success) &&
    input.criteria.some((criterion) => criterion.verifier === 'agent-browser') &&
    (input.signal === undefined || isAbortSignal(input.signal)) &&
    (input.deadlineAt === undefined || Number.isFinite(input.deadlineAt))
  );
}

function copyNativeError(
  error: NativeBrowserE2EAttestationError
): Result<never, E2ERequiredChecksError> {
  const attempts = error.sessionAttempts?.map((attempt) =>
    loopSessionAttemptSchema.safeParse(attempt)
  );
  return err({
    type: validId(error.type) ? error.type : 'native-browser-rejected',
    message: safeText(error.message, 'Native browser verification was rejected.'),
    ...(attempts && attempts.every((attempt) => attempt.success)
      ? { sessionAttempts: attempts.map((attempt) => attempt.data) }
      : {}),
  });
}

function invalidContext(): Result<never, E2ERequiredChecksError> {
  return err({
    type: 'required-checks-context-invalid',
    message: 'Required checks did not retain the exact durable E2E authority.',
  });
}

function validTrustedEnvironment(
  environment: Readonly<Record<string, string>>,
  target: LoopSessionTarget
): boolean {
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)) return false;
  const keys = Object.keys(environment).sort();
  const trustedKeys = [...TRUSTED_TASK_ENVIRONMENT_KEYS].sort();
  if (
    keys.length !== trustedKeys.length ||
    keys.some((key, index) => key !== trustedKeys[index]) ||
    environment.EMDASH_TASK_PATH !== target.path
  ) {
    return false;
  }
  let bytes = 0;
  for (const [key, value] of Object.entries(environment)) {
    if (typeof value !== 'string' || value.length > MAX_TASK_ENVIRONMENT_VALUE_LENGTH) return false;
    bytes += Buffer.byteLength(key, 'utf8') + Buffer.byteLength(value, 'utf8');
    if (bytes > MAX_TASK_ENVIRONMENT_BYTES) return false;
  }
  return true;
}

function sameCriteria(
  left: readonly LoopPhaseCriterion[],
  right: readonly LoopPhaseCriterion[]
): boolean {
  return (
    left.length === right.length &&
    left.every((criterion, index) => {
      const expected = right[index];
      return (
        expected !== undefined &&
        criterion.description === expected.description &&
        criterion.verifier === expected.verifier &&
        criterion.status === expected.status &&
        criterion.evidence === expected.evidence
      );
    })
  );
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameStringRecord(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>
): boolean {
  const leftEntries = Object.entries(left).sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey)
  );
  const rightEntries = Object.entries(right).sort(([leftKey], [rightKey]) =>
    leftKey.localeCompare(rightKey)
  );
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(
      ([key, value], index) =>
        rightEntries[index]?.[0] === key && rightEntries[index]?.[1] === value
    )
  );
}

function sameTarget(left: unknown, right: unknown): boolean {
  const leftTarget = loopSessionTargetSchema.safeParse(left);
  const rightTarget = loopSessionTargetSchema.safeParse(right);
  return (
    leftTarget.success &&
    rightTarget.success &&
    JSON.stringify(leftTarget.data) === JSON.stringify(rightTarget.data)
  );
}

function copyTarget(target: LoopSessionTarget | LoopExecutionTarget): LoopSessionTarget {
  return loopSessionTargetSchema.parse({
    workspaceId: target.workspaceId,
    path: target.path,
    machine: target.machine,
  });
}

function copyCriterion(criterion: LoopPhaseCriterion): LoopPhaseCriterion {
  return loopPhaseCriterionSchema.parse(criterion);
}

function validId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH
  );
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof AbortSignal !== 'undefined' && value instanceof AbortSignal;
}

function safeText(value: unknown, fallback: string): string {
  const candidate = typeof value === 'string' ? value : fallback;
  const redacted = redactAll(
    candidate.replace(cookieAssignmentPattern, '[REDACTED_COOKIE]')
  ).trim();
  return (redacted || redactAll(fallback)).slice(0, MAX_SUMMARY_LENGTH);
}
