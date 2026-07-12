import { Buffer } from 'node:buffer';
import { redactAll } from '@emdash/shared/logger';
import { err, ok, type Result } from '@main/lib/result';
import {
  loopArtifactReferenceSchema,
  loopPhaseStateInputSchema,
  type LoopArtifactReference,
} from '@shared/core/loops/loop-phase-state';
import {
  loopCommitSchema,
  loopSessionAttemptSchema,
  loopSessionTargetSchema,
  loopStateV1Schema,
  type LoopSessionAttempt,
  type LoopSessionTarget,
  type LoopState,
} from '@shared/core/loops/loop-state';
import {
  loopPhaseCriteriaV1Schema,
  loopPhaseCriterionSchema,
  newLoopConfigV2Schema,
  type Loop,
  type LoopPhase,
  type LoopPhaseCriterion,
} from '@shared/core/loops/loops';
import { loopPromptHandoffSchema, type LoopPromptHandoff } from '../handoff-builder';
import type { LoopExecutionTarget } from '../runtime/loop-execution-target';
import type {
  NativeBrowserE2EAttestation,
  NativeBrowserE2EAttestationPort,
} from '../verifiers/native-browser-e2e-attestation';
import type { LoopVerifier } from '../verifiers/types';
import { unitTestsVerifier } from '../verifiers/unit-tests';
import type {
  E2ERequiredChecksError,
  E2ERequiredChecksPort,
  E2ERequiredChecksResult,
} from './clean-room-e2e-gate';
import { e2eCriteriaSchema } from './clean-room-e2e-input';
import { sameE2EDurableProgress } from './clean-room-e2e-progress';

const MAX_ID_LENGTH = 256;
const MAX_MODEL_LENGTH = 256;
const MAX_SUMMARY_LENGTH = 16_384;
const MAX_TASK_ENVIRONMENT_BYTES = 64 * 1024;
const MAX_TASK_ENVIRONMENT_VALUE_LENGTH = 4_096;
const MAX_STABLE_NATIVE_BYTES = 1024 * 1024;
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
const posixAbsolutePathPattern = /(^|[\s("'=])\/(?:[^\s"'<>]|\\ )+/gmu;
const windowsAbsolutePathPattern = /\b[A-Z]:\\(?:[^\s"'<>]|\\ )+/giu;

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
      return requiredChecksError(
        'required-checks-context-unavailable',
        'Required-check authority could not be resolved.',
        true
      );
    }
    let contextResolved: boolean;
    try {
      contextResolved = resolved.success === true;
    } catch {
      return requiredChecksError(
        'required-checks-context-unavailable',
        'Required-check authority returned unreadable settlement authority.',
        true
      );
    }
    if (!contextResolved) {
      let rawError: unknown;
      try {
        rawError = (resolved as { success: false; error: unknown }).error;
      } catch {
        rawError = undefined;
      }
      const stable = stabilizeJson(rawError, MAX_STABLE_NATIVE_BYTES);
      const error =
        stable && typeof stable === 'object' && !Array.isArray(stable)
          ? (stable as Record<string, unknown>)
          : {};
      const attempts = Array.isArray(error.sessionAttempts)
        ? error.sessionAttempts.slice(0, 3).flatMap((attempt) => {
            const copied = canonicalAttempt(attempt);
            return copied ? [copied] : [];
          })
        : [];
      return requiredChecksError(
        validErrorType(error.type)
          ? error.type
          : validErrorType(error.kind)
            ? error.kind
            : 'required-checks-context-unavailable',
        safeText(error.message, 'Required-check authority could not be resolved.'),
        true,
        attempts
      );
    }
    let rawContext: unknown;
    try {
      rawContext = (resolved as { success: true; data: unknown }).data;
    } catch {
      rawContext = undefined;
    }
    const context = validateContext(rawContext as CleanRoomE2ERequiredChecksContext, input);
    if (!context.success) return context;

    const validation = await runValidation(this.validationVerifier, context.data, input);
    let native: Awaited<ReturnType<NativeBrowserE2EAttestationPort['run']>>;
    try {
      native = await this.dependencies.native.run({
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
    } catch {
      return requiredChecksError(
        'native-browser-execution-error',
        'Native browser verification threw before proving quiescence.',
        false
      );
    }
    let nativeSucceeded: boolean;
    try {
      nativeSucceeded = native.success === true;
    } catch {
      return requiredChecksError(
        'native-browser-authority-invalid',
        'Native browser verification returned unreadable settlement authority.',
        false
      );
    }
    if (!nativeSucceeded) {
      let nativeError: unknown;
      try {
        nativeError = (native as { success: false; error: unknown }).error;
      } catch {
        nativeError = undefined;
      }
      return copyNativeError(nativeError);
    }
    let nativeData: unknown;
    try {
      nativeData = (native as { success: true; data: unknown }).data;
    } catch {
      nativeData = undefined;
    }
    const exactNative = validateNativeAttestation(nativeData, input);
    if (!exactNative.success) return exactNative;

    const status = validation.success ? exactNative.data.status : 'failed';
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
        invocationCount: exactNative.data.invocationCount,
        passed: exactNative.data.passed,
        summary: exactNative.data.summary,
        target: copyTarget(exactNative.data.target),
        provider: exactNative.data.provider,
        model: exactNative.data.model,
        taskEnvironment: Object.freeze({ ...exactNative.data.taskEnvironment }),
      },
      sessionAttempts: [exactNative.data.sessionAttempt],
      nativeEvidence: {
        runId: exactNative.data.evidence.runId,
        artifacts: exactNative.data.evidence.artifacts.map(copyArtifact),
      },
      ...(status === 'correctable' && exactNative.data.handoff
        ? { handoff: exactNative.data.handoff }
        : {}),
    };
    return ok(result);
  }
}

function validateContext(
  value: CleanRoomE2ERequiredChecksContext,
  input: Parameters<E2ERequiredChecksPort['run']>[0]
): Result<CleanRoomE2ERequiredChecksContext, E2ERequiredChecksError> {
  try {
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
      value.loop.status !== 'running' ||
      value.loop.currentPhaseIndex !== value.phase.idx ||
      value.phase.id !== input.authority.phaseId ||
      value.phase.loopId !== value.loop.id ||
      value.phase.kind !== 'e2e' ||
      value.phase.status !== 'reviewing' ||
      value.phase.conversationId !== input.authority.outerConversationId ||
      !config.success ||
      config.data.provider !== input.provider ||
      config.data.model !== input.model ||
      config.data.terminalGates.e2e !== true ||
      config.data.browserPreview.enabled !== true ||
      !sameStringArray(config.data.validationCommands, input.validationCommands) ||
      !phaseCriteria.success ||
      !sameCriteria(phaseCriteria.data.criteria, input.criteria) ||
      !loopState.success ||
      phaseState === null ||
      !phaseState.success ||
      phaseState.data.result !== null ||
      !sameE2EDurableProgress(
        { loopState: loopState.data, phaseState: phaseState.data },
        input.authority.progress
      ) ||
      input.authority.progress.loopState.checkpointCommit !== input.checkpointCommit ||
      input.authority.progress.phaseState?.checkpointCommit !== input.checkpointCommit ||
      !validActiveVerificationContext(loopState.data, input)
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
  } catch {
    return invalidContext();
  }
}

function validActiveVerificationContext(
  loopState: LoopState,
  input: Parameters<E2ERequiredChecksPort['run']>[0]
): boolean {
  const verification = loopState.verification;
  if (
    verification === null ||
    verification.verificationRunId !== input.verificationRunId ||
    verification.attempt !== input.attempt ||
    verification.status !== 'running' ||
    verification.cleanup.status !== 'pending' ||
    verification.expectedFeatureHead !== input.checkpointCommit ||
    verification.replayedThroughCommit !== input.checkpointCommit ||
    !sameExactTarget(verification.target, input.target)
  ) {
    return false;
  }
  const matching = loopState.sessionAttempts.filter(
    (attempt) =>
      attempt.attemptId === input.sessionIdentity.attemptId ||
      attempt.conversationId === input.sessionIdentity.conversationId
  );
  if (matching.length !== 1) return false;
  const attempt = matching[0];
  return (
    attempt !== undefined &&
    canonicalAttempt(attempt) !== undefined &&
    attempt.attemptId === input.sessionIdentity.attemptId &&
    attempt.conversationId === input.sessionIdentity.conversationId &&
    attempt.purpose === 'browser-verification' &&
    attempt.phaseId === input.authority.phaseId &&
    attempt.verificationRunId === input.verificationRunId &&
    attempt.status === 'starting' &&
    attempt.checkpointBefore === input.checkpointCommit &&
    attempt.checkpointAfter === undefined &&
    attempt.finishedAt === undefined &&
    attempt.error === undefined &&
    sameExactTarget(attempt.target, input.target)
  );
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
  try {
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
      sameExactTarget(input.target, target.data) &&
      executionTarget.success &&
      sameExactTarget(
        {
          workspaceId: input.executionTarget.workspaceId,
          path: input.executionTarget.path,
          machine: input.executionTarget.machine,
        },
        executionTarget.data
      ) &&
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
      e2eCriteriaSchema.safeParse(input.criteria).success &&
      (input.signal === undefined || isAbortSignal(input.signal)) &&
      (input.signal === undefined || !signalAborted(input.signal)) &&
      (input.deadlineAt === undefined ||
        (Number.isFinite(input.deadlineAt) && Date.now() < input.deadlineAt))
    );
  } catch {
    return false;
  }
}

function validateNativeAttestation(
  value: unknown,
  input: Parameters<E2ERequiredChecksPort['run']>[0]
): Result<NativeBrowserE2EAttestation, E2ERequiredChecksError> {
  const stable = stabilizeJson(value, MAX_STABLE_NATIVE_BYTES);
  try {
    if (!stable || typeof stable !== 'object' || Array.isArray(stable)) throw new TypeError();
    const candidate = stable as NativeBrowserE2EAttestation;
    const expectedKeys = [
      'checkpointCommit',
      'evidence',
      'invocationCount',
      'model',
      'passed',
      'provider',
      'quiescent',
      'sessionAttempt',
      'status',
      'summary',
      'target',
      'taskEnvironment',
      'verificationRunId',
      ...(candidate.handoff === undefined ? [] : ['handoff']),
    ];
    const attempt = canonicalAttempt(candidate.sessionAttempt);
    const evidence = copyOpaqueEvidence(candidate.evidence, input.verificationRunId);
    const handoff =
      candidate.handoff === undefined ? undefined : copySafeHandoff(candidate.handoff, evidence);
    if (
      !hasExactKeys(candidate, expectedKeys) ||
      !['passed', 'correctable', 'failed'].includes(candidate.status) ||
      candidate.invocationCount !== 1 ||
      candidate.passed !== (candidate.status === 'passed') ||
      candidate.verificationRunId !== input.verificationRunId ||
      !sameExactTarget(candidate.target, input.target) ||
      !sameExactStringRecord(candidate.taskEnvironment, input.taskEnvironment) ||
      candidate.provider !== input.provider ||
      candidate.model !== input.model ||
      candidate.checkpointCommit !== input.checkpointCommit ||
      candidate.quiescent !== true ||
      safeText(candidate.summary, 'Native browser verification finished.') !== candidate.summary ||
      !attempt ||
      attempt.attemptId !== input.sessionIdentity.attemptId ||
      attempt.conversationId !== input.sessionIdentity.conversationId ||
      attempt.purpose !== 'browser-verification' ||
      attempt.phaseId !== input.authority.phaseId ||
      attempt.verificationRunId !== input.verificationRunId ||
      attempt.status !== 'completed' ||
      attempt.checkpointBefore !== input.checkpointCommit ||
      attempt.checkpointAfter !== input.checkpointCommit ||
      !sameExactTarget(attempt.target, input.target) ||
      evidence === undefined ||
      (candidate.status === 'correctable' ? handoff === undefined : candidate.handoff !== undefined)
    ) {
      throw new TypeError();
    }
    return ok({
      status: candidate.status,
      summary: candidate.summary,
      invocationCount: 1,
      passed: candidate.passed,
      verificationRunId: candidate.verificationRunId,
      target: copyTarget(candidate.target),
      taskEnvironment: Object.freeze({ ...candidate.taskEnvironment }),
      provider: candidate.provider,
      model: candidate.model,
      checkpointCommit: candidate.checkpointCommit,
      sessionAttempt: attempt,
      evidence,
      ...(handoff ? { handoff } : {}),
      quiescent: true,
    });
  } catch {
    const rawAttempt =
      stable && typeof stable === 'object' && !Array.isArray(stable)
        ? canonicalAttempt((stable as { sessionAttempt?: unknown }).sessionAttempt)
        : undefined;
    return requiredChecksError(
      'native-browser-authority-invalid',
      'Native browser verification returned malformed or drifted authority.',
      false,
      rawAttempt ? [rawAttempt] : []
    );
  }
}

function copyNativeError(error: unknown): Result<never, E2ERequiredChecksError> {
  const stable = stabilizeJson(error, MAX_STABLE_NATIVE_BYTES);
  if (!stable || typeof stable !== 'object' || Array.isArray(stable)) {
    return requiredChecksError(
      'native-browser-rejected',
      'Native browser verification returned unreadable failure authority.',
      false
    );
  }
  const candidate = stable as Record<string, unknown>;
  const attempts = Array.isArray(candidate.sessionAttempts)
    ? candidate.sessionAttempts.slice(0, 3).flatMap((attempt) => {
        const copied = canonicalAttempt(attempt);
        return copied ? [copied] : [];
      })
    : [];
  const quiescent = candidate.quiescent === true && candidate.recoveryRequired !== true;
  return requiredChecksError(
    validErrorType(candidate.type) ? candidate.type : 'native-browser-rejected',
    safeText(candidate.message, 'Native browser verification was rejected.'),
    quiescent,
    attempts
  );
}

function requiredChecksError(
  type: string,
  message: string,
  quiescent: boolean,
  sessionAttempts: readonly LoopSessionAttempt[] = []
): Result<never, E2ERequiredChecksError> {
  const error: E2ERequiredChecksError & { quiescent: boolean; recoveryRequired: boolean } = {
    type: validErrorType(type) ? type : 'native-browser-rejected',
    message: safeText(message, 'Native browser verification was rejected.'),
    quiescent,
    recoveryRequired: !quiescent,
    ...(sessionAttempts.length > 0 ? { sessionAttempts: sessionAttempts.slice(0, 3) } : {}),
  };
  return err(error);
}

function copyOpaqueEvidence(
  value: unknown,
  verificationRunId: string
): NativeBrowserE2EAttestation['evidence'] | undefined {
  try {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !hasExactKeys(value, ['artifacts', 'runId'])
    ) {
      return undefined;
    }
    const candidate = value as { runId?: unknown; artifacts?: unknown };
    if (candidate.runId !== verificationRunId || !Array.isArray(candidate.artifacts)) {
      return undefined;
    }
    const artifacts = candidate.artifacts.map(copyOpaqueArtifact);
    if (artifacts.length > 64 || artifacts.some((artifact) => artifact === undefined)) {
      return undefined;
    }
    return {
      runId: verificationRunId,
      artifacts: artifacts as LoopArtifactReference[],
    };
  } catch {
    return undefined;
  }
}

function copyOpaqueArtifact(value: unknown): LoopArtifactReference | undefined {
  try {
    const parsed = loopArtifactReferenceSchema.safeParse(value);
    if (
      !parsed.success ||
      !canonicalDeepEqual(value, parsed.data) ||
      /[\\/]/u.test(parsed.data.artifactId) ||
      safeText(parsed.data.artifactId, 'opaque-artifact', 256) !== parsed.data.artifactId ||
      (parsed.data.label !== undefined &&
        safeText(parsed.data.label, 'Evidence artifact', 256) !== parsed.data.label) ||
      !validTimestamp(parsed.data.createdAt)
    ) {
      return undefined;
    }
    return parsed.data;
  } catch {
    return undefined;
  }
}

function copySafeHandoff(
  value: unknown,
  evidence: NativeBrowserE2EAttestation['evidence'] | undefined
): LoopPromptHandoff | undefined {
  try {
    const parsed = loopPromptHandoffSchema.safeParse(value);
    if (
      !parsed.success ||
      !evidence ||
      !canonicalDeepEqual(value, parsed.data) ||
      safeText(parsed.data.source, 'Native browser verification', 256) !== parsed.data.source ||
      safeText(parsed.data.handoff.summary, 'Native browser correction required.') !==
        parsed.data.handoff.summary ||
      parsed.data.handoff.risks.some(
        (risk) => safeText(risk, 'Native browser correction risk.', 2_048) !== risk
      ) ||
      parsed.data.handoff.remainingWork.some(
        (work) => safeText(work, 'Native browser correction work.', 2_048) !== work
      ) ||
      !validTimestamp(parsed.data.handoff.createdAt) ||
      !canonicalDeepEqual(parsed.data.handoff.artifacts, evidence.artifacts)
    ) {
      return undefined;
    }
    return loopPromptHandoffSchema.parse({
      source: parsed.data.source,
      handoff: {
        ...parsed.data.handoff,
        risks: [...parsed.data.handoff.risks],
        remainingWork: [...parsed.data.handoff.remainingWork],
        artifacts: parsed.data.handoff.artifacts.map(copyArtifact),
      },
    });
  } catch {
    return undefined;
  }
}

function canonicalAttempt(value: unknown): LoopSessionAttempt | undefined {
  try {
    const parsed = loopSessionAttemptSchema.safeParse(value);
    if (
      !parsed.success ||
      !canonicalDeepEqual(value, parsed.data) ||
      !validTimestamp(parsed.data.startedAt) ||
      (parsed.data.finishedAt !== undefined &&
        (!validTimestamp(parsed.data.finishedAt) ||
          Date.parse(parsed.data.finishedAt) < Date.parse(parsed.data.startedAt))) ||
      (parsed.data.error !== undefined &&
        safeText(parsed.data.error, 'Native browser session failed.', 4_096) !== parsed.data.error)
    ) {
      return undefined;
    }
    return parsed.data;
  } catch {
    return undefined;
  }
}

function copyArtifact(value: LoopArtifactReference): LoopArtifactReference {
  return loopArtifactReferenceSchema.parse({ ...value });
}

function invalidContext(): Result<never, E2ERequiredChecksError> {
  return requiredChecksError(
    'required-checks-context-invalid',
    'Required checks did not retain the exact durable E2E authority.',
    true
  );
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

function sameExactStringRecord(left: unknown, right: Readonly<Record<string, string>>): boolean {
  try {
    if (!left || typeof left !== 'object' || Array.isArray(left)) return false;
    const entries = Object.entries(left);
    return (
      entries.length === Object.keys(right).length &&
      entries.every(([key, value]) => typeof value === 'string' && right[key] === value)
    );
  } catch {
    return false;
  }
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

function sameExactTarget(left: unknown, right: LoopSessionTarget): boolean {
  try {
    const parsed = loopSessionTargetSchema.safeParse(left);
    return (
      parsed.success && canonicalDeepEqual(left, parsed.data) && sameTarget(parsed.data, right)
    );
  } catch {
    return false;
  }
}

function canonicalDeepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => canonicalDeepEqual(value, right[index]))
    );
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] && canonicalDeepEqual(leftRecord[key], rightRecord[key])
    )
  );
}

function hasExactKeys(value: unknown, expected: readonly string[]): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function stabilizeJson(value: unknown, maxBytes: number): unknown {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > maxBytes) {
      return undefined;
    }
    return JSON.parse(serialized) as unknown;
  } catch {
    return undefined;
  }
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

function validErrorType(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,127}$/u.test(value);
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return typeof AbortSignal !== 'undefined' && value instanceof AbortSignal;
}

function signalAborted(signal: AbortSignal): boolean {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted');
    return descriptor?.get?.call(signal) === true;
  } catch {
    return true;
  }
}

function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value !== value.trim() || value.length > 64) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function safeText(value: unknown, fallback: string, limit = MAX_SUMMARY_LENGTH): string {
  const candidate = typeof value === 'string' ? value : fallback;
  const withoutPaths = candidate
    .replace(windowsAbsolutePathPattern, '[REDACTED_PATH]')
    .replace(posixAbsolutePathPattern, (_match, prefix: string) => `${prefix}[REDACTED_PATH]`);
  const redacted = redactAll(
    withoutPaths.replace(cookieAssignmentPattern, '[REDACTED_COOKIE]')
  ).trim();
  return (redacted || redactAll(fallback)).slice(0, limit);
}
