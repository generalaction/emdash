import { Buffer } from 'node:buffer';
import path from 'node:path';
import { redactAll } from '@emdash/shared/logger';
import { err, ok, type Result } from '@main/lib/result';
import {
  loopArtifactReferenceSchema,
  loopPhaseStateInputSchema,
  type LoopArtifactReference,
} from '@shared/core/loops/loop-phase-state';
import {
  CLEAN_ROOM_E2E_MAX_REPORTED_SESSION_ATTEMPTS,
  loopCommitSchema,
  loopSessionAttemptSchema,
  loopSessionTargetSchema,
  loopStateV2Schema,
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
const MAX_STABLE_REQUEST_BYTES = 2 * 1024 * 1024;
const APPROVED_ARTIFACT_MIME_TYPES = new Set([
  'application/json',
  'application/xml',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/markdown',
  'text/plain',
]);
const APPROVED_ARTIFACT_MIME_TYPES_BY_KIND: Readonly<
  Record<LoopArtifactReference['kind'], ReadonlySet<string>>
> = {
  'browser-diagnostics': new Set(['application/json', 'text/plain']),
  'command-log': new Set(['text/plain']),
  'diff-summary': new Set(['text/markdown', 'text/plain']),
  screenshot: new Set(['image/jpeg', 'image/png', 'image/webp']),
  'test-report': new Set(['application/json', 'application/xml', 'text/plain']),
};
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
    rawInput: Parameters<E2ERequiredChecksPort['run']>[0]
  ): Promise<Result<E2ERequiredChecksResult, E2ERequiredChecksError>> {
    const input = stabilizeRequest(rawInput);
    if (!input || !validRequestEnvelope(input)) {
      return invalidContext();
    }

    const control = createRunControl(input.signal, input.deadlineAt);
    try {
      if (controlStopped(control.signal, input.deadlineAt)) return stoppedBeforeNestedEffects();
      return await this.runControlled(input, control.signal);
    } finally {
      control.dispose();
    }
  }

  private async runControlled(
    input: Parameters<E2ERequiredChecksPort['run']>[0],
    signal: AbortSignal
  ): Promise<Result<E2ERequiredChecksResult, E2ERequiredChecksError>> {
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
    const stableResolution = stabilizeJson(resolved, MAX_STABLE_REQUEST_BYTES);
    if (
      !stableResolution ||
      typeof stableResolution !== 'object' ||
      Array.isArray(stableResolution)
    ) {
      return requiredChecksError(
        'required-checks-context-unavailable',
        'Required-check authority returned unreadable settlement authority.',
        true
      );
    }
    const resolution = stableResolution as Record<string, unknown>;
    if (resolution.success !== true) {
      const stable = stabilizeJson(resolution.error, MAX_STABLE_NATIVE_BYTES);
      const error =
        stable && typeof stable === 'object' && !Array.isArray(stable)
          ? (stable as Record<string, unknown>)
          : {};
      const attempts = Array.isArray(error.sessionAttempts)
        ? error.sessionAttempts
            .slice(0, CLEAN_ROOM_E2E_MAX_REPORTED_SESSION_ATTEMPTS)
            .flatMap((attempt) => {
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
    if (controlStopped(signal, input.deadlineAt)) return stoppedBeforeNestedEffects();
    const rawContext = resolution.data;
    const context = validateContext(rawContext as CleanRoomE2ERequiredChecksContext, input);
    if (!context.success) return context;

    const validation = await runValidation(this.validationVerifier, context.data, input, signal);
    if (controlStopped(signal, input.deadlineAt)) return stoppedBeforeNestedEffects();
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
        signal,
        ...(input.deadlineAt !== undefined ? { deadlineAt: input.deadlineAt } : {}),
      });
    } catch {
      return requiredChecksError(
        'native-browser-execution-error',
        'Native browser verification threw before proving quiescence.',
        false
      );
    }
    const stableNativeSettlement = stabilizeJson(native, MAX_STABLE_NATIVE_BYTES);
    if (
      !stableNativeSettlement ||
      typeof stableNativeSettlement !== 'object' ||
      Array.isArray(stableNativeSettlement)
    ) {
      return requiredChecksError(
        'native-browser-authority-invalid',
        'Native browser verification returned unreadable settlement authority.',
        false
      );
    }
    const nativeSettlement = stableNativeSettlement as Record<string, unknown>;
    if (typeof nativeSettlement.success !== 'boolean') {
      return requiredChecksError(
        'native-browser-authority-invalid',
        'Native browser verification returned unreadable settlement authority.',
        false
      );
    }
    if (nativeSettlement.success !== true) {
      return copyNativeError(nativeSettlement.error, input);
    }
    const nativeData = nativeSettlement.data;
    const exactNative = validateNativeAttestation(nativeData, input);
    if (!exactNative.success) return exactNative;
    if (controlStopped(signal, input.deadlineAt)) {
      return requiredChecksError(
        'required-checks-aborted',
        'Required checks stopped after native verification proved quiescence.',
        true,
        [exactNative.data.sessionAttempt]
      );
    }

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

function stabilizeRequest(
  input: Parameters<E2ERequiredChecksPort['run']>[0]
): Parameters<E2ERequiredChecksPort['run']>[0] | undefined {
  try {
    const {
      authority: rawAuthority,
      validationCommands: rawValidationCommands,
      criteria: rawCriteria,
      verificationRunId,
      attempt,
      sessionIdentity: rawSessionIdentity,
      target: rawTarget,
      executionTarget: rawExecutionTarget,
      taskEnvironment: rawTaskEnvironment,
      checkpointCommit,
      provider,
      model,
      signal,
      deadlineAt,
    } = input;
    const {
      workspaceId: executionWorkspaceId,
      path: executionPath,
      machine: rawExecutionMachine,
      executionContext,
      taskEnv: rawExecutionTaskEnvironment,
      dispose,
    } = rawExecutionTarget;
    const authority = stabilizeJson(rawAuthority, MAX_STABLE_REQUEST_BYTES);
    const validationCommands = stabilizeJson(rawValidationCommands, MAX_STABLE_REQUEST_BYTES);
    const criteria = stabilizeJson(rawCriteria, MAX_STABLE_REQUEST_BYTES);
    const sessionIdentity = stabilizeJson(rawSessionIdentity, MAX_STABLE_REQUEST_BYTES);
    const target = stabilizeJson(rawTarget, MAX_STABLE_REQUEST_BYTES);
    const executionMachine = stabilizeJson(rawExecutionMachine, MAX_STABLE_REQUEST_BYTES);
    const taskEnvironment = stabilizeJson(rawTaskEnvironment, MAX_STABLE_REQUEST_BYTES);
    const executionTaskEnvironment = stabilizeJson(
      rawExecutionTaskEnvironment,
      MAX_STABLE_REQUEST_BYTES
    );
    if (
      !authority ||
      typeof authority !== 'object' ||
      Array.isArray(authority) ||
      !Array.isArray(validationCommands) ||
      !Array.isArray(criteria) ||
      !sessionIdentity ||
      typeof sessionIdentity !== 'object' ||
      Array.isArray(sessionIdentity) ||
      !target ||
      typeof target !== 'object' ||
      Array.isArray(target) ||
      !executionMachine ||
      typeof executionMachine !== 'object' ||
      Array.isArray(executionMachine) ||
      !taskEnvironment ||
      typeof taskEnvironment !== 'object' ||
      Array.isArray(taskEnvironment) ||
      !executionTaskEnvironment ||
      typeof executionTaskEnvironment !== 'object' ||
      Array.isArray(executionTaskEnvironment) ||
      typeof dispose !== 'function'
    ) {
      return undefined;
    }
    const stableExecutionTarget = Object.freeze({
      workspaceId: executionWorkspaceId,
      path: executionPath,
      machine: Object.freeze(executionMachine) as LoopSessionTarget['machine'],
      executionContext,
      taskEnv: Object.freeze(executionTaskEnvironment) as Readonly<Record<string, string>>,
      dispose: () => Reflect.apply(dispose, rawExecutionTarget, []),
    });
    return {
      authority: deepFreezeJson(authority) as Parameters<
        E2ERequiredChecksPort['run']
      >[0]['authority'],
      validationCommands: Object.freeze([...validationCommands]) as readonly string[],
      criteria: deepFreezeJson(criteria) as readonly LoopPhaseCriterion[],
      verificationRunId,
      attempt,
      sessionIdentity: Object.freeze(sessionIdentity) as {
        attemptId: string;
        conversationId: string;
      },
      target: deepFreezeJson(target) as LoopSessionTarget,
      executionTarget: stableExecutionTarget,
      taskEnvironment: Object.freeze(taskEnvironment) as Readonly<Record<string, string>>,
      checkpointCommit,
      provider,
      model,
      ...(signal !== undefined ? { signal } : {}),
      ...(deadlineAt !== undefined ? { deadlineAt } : {}),
    };
  } catch {
    return undefined;
  }
}

function createRunControl(
  parentSignal: AbortSignal | undefined,
  deadlineAt: number | undefined
): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let listening = false;
  const stop = () => controller.abort();
  const armDeadline = () => {
    if (deadlineAt === undefined || signalAborted(controller.signal)) return;
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) {
      stop();
      return;
    }
    timer = setTimeout(armDeadline, Math.min(remaining, 2_147_483_647));
  };
  if (parentSignal !== undefined) {
    parentSignal.addEventListener('abort', stop, { once: true });
    listening = true;
    if (signalAborted(parentSignal)) stop();
  }
  armDeadline();
  return {
    signal: controller.signal,
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      if (listening && parentSignal !== undefined) {
        parentSignal.removeEventListener('abort', stop);
      }
    },
  };
}

function stoppedBeforeNestedEffects(): Result<never, E2ERequiredChecksError> {
  return requiredChecksError(
    'required-checks-aborted',
    'Required checks stopped before starting further nested effects.',
    true
  );
}

function controlStopped(signal: AbortSignal, deadlineAt: number | undefined): boolean {
  return signalAborted(signal) || (deadlineAt !== undefined && Date.now() >= deadlineAt);
}

function validateContext(
  value: CleanRoomE2ERequiredChecksContext,
  input: Parameters<E2ERequiredChecksPort['run']>[0]
): Result<CleanRoomE2ERequiredChecksContext, E2ERequiredChecksError> {
  try {
    const config = newLoopConfigV2Schema.strict().safeParse(value.loop.config);
    const phaseCriteria = loopPhaseCriteriaV1Schema.strict().safeParse(value.phase.criteria);
    const loopState = loopStateV2Schema.safeParse(value.loop.state);
    const phaseState =
      value.phase.state === null ? null : loopPhaseStateInputSchema.safeParse(value.phase.state);
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
      !config.success ||
      !canonicalDeepEqual(value.loop.config, config.data) ||
      config.data.provider !== input.provider ||
      config.data.model !== input.model ||
      config.data.terminalGates.e2e !== true ||
      config.data.browserPreview.enabled !== true ||
      !sameStringArray(config.data.validationCommands, input.validationCommands) ||
      !phaseCriteria.success ||
      !canonicalDeepEqual(value.phase.criteria, phaseCriteria.data) ||
      !sameCriteria(phaseCriteria.data.criteria, input.criteria) ||
      !loopState.success ||
      !canonicalDeepEqual(value.loop.state, loopState.data) ||
      (phaseState !== null &&
        (!phaseState.success || !canonicalDeepEqual(value.phase.state, phaseState.data)))
    ) {
      return invalidContext();
    }
    const exactPhaseState = phaseState === null ? null : phaseState.data;
    if (
      (exactPhaseState !== null &&
        (exactPhaseState.result !== null ||
          exactPhaseState.checkpointCommit !== input.checkpointCommit)) ||
      !validOuterConversationAuthority(value.phase.conversationId, loopState.data, input) ||
      !sameE2EDurableProgress(
        { loopState: loopState.data, phaseState: exactPhaseState },
        input.authority.progress
      ) ||
      input.authority.progress.loopState.checkpointCommit !== input.checkpointCommit ||
      !validActiveVerificationContext(loopState.data, input)
    ) {
      return invalidContext();
    }
    return ok(
      deepFreezeJson({
        loop: {
          ...value.loop,
          config: config.data,
          state: loopState.data,
        },
        phase: {
          ...value.phase,
          conversationId: input.authority.outerConversationId,
          criteria: phaseCriteria.data,
          state: exactPhaseState,
        },
      })
    );
  } catch {
    return invalidContext();
  }
}

function validOuterConversationAuthority(
  phaseConversationId: string | null,
  loopState: LoopState,
  input: Parameters<E2ERequiredChecksPort['run']>[0]
): boolean {
  if (phaseConversationId === input.authority.outerConversationId) return true;
  if (phaseConversationId !== null) return false;
  const matching = loopState.sessionAttempts.filter(
    (attempt) =>
      attempt.conversationId === input.authority.outerConversationId &&
      attempt.purpose === 'e2e' &&
      attempt.phaseId === input.authority.phaseId &&
      attempt.verificationRunId === input.verificationRunId &&
      attempt.status === 'running' &&
      attempt.checkpointBefore === input.checkpointCommit &&
      attempt.checkpointAfter === undefined &&
      attempt.finishedAt === undefined &&
      attempt.error === undefined &&
      sameExactTarget(attempt.target, input.target)
  );
  return matching.length === 1 && canonicalAttempt(matching[0]) !== undefined;
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
  input: Parameters<E2ERequiredChecksPort['run']>[0],
  signal: AbortSignal
): Promise<{ success: boolean; summary: string }> {
  try {
    const result = await verifier.run({
      loop: context.loop,
      phase: context.phase,
      cwd: input.target.path,
      executionTarget: input.executionTarget,
      validationCommands: [...input.validationCommands],
      criteria: input.criteria.map(copyCriterion),
      signal,
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
    const parsedCriteria = e2eCriteriaSchema.safeParse(input.criteria);
    const progressLoopState = loopStateV2Schema.safeParse(input.authority.progress.loopState);
    const progressPhaseState =
      input.authority.progress.phaseState === null
        ? null
        : loopPhaseStateInputSchema.safeParse(input.authority.progress.phaseState);
    return (
      hasExactKeys(input.authority, [
        'loopId',
        'outerConversationId',
        'phaseId',
        'progress',
        'projectId',
        'taskId',
      ]) &&
      hasExactKeys(input.authority.progress, ['loopState', 'phaseState']) &&
      hasExactKeys(input.sessionIdentity, ['attemptId', 'conversationId']) &&
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
      isCanonicalAbsolutePath(target.data.path) &&
      executionTarget.success &&
      sameExactTarget(
        {
          workspaceId: input.executionTarget.workspaceId,
          path: input.executionTarget.path,
          machine: input.executionTarget.machine,
        },
        executionTarget.data
      ) &&
      isCanonicalAbsolutePath(executionTarget.data.path) &&
      sameTarget(target.data, executionTarget.data) &&
      sameStringRecord(input.executionTarget.taskEnv, input.taskEnvironment) &&
      validTrustedEnvironment(input.taskEnvironment, target.data) &&
      loopCommitSchema.safeParse(input.checkpointCommit).success &&
      input.provider === 'codex' &&
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
      parsedCriteria.success &&
      canonicalDeepEqual(input.criteria, parsedCriteria.data) &&
      progressLoopState.success &&
      canonicalDeepEqual(input.authority.progress.loopState, progressLoopState.data) &&
      (progressPhaseState === null ||
        (progressPhaseState.success &&
          canonicalDeepEqual(input.authority.progress.phaseState, progressPhaseState.data))) &&
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

function copyNativeError(
  error: unknown,
  input: Parameters<E2ERequiredChecksPort['run']>[0]
): Result<never, E2ERequiredChecksError> {
  const stable = stabilizeJson(error, MAX_STABLE_NATIVE_BYTES);
  if (!stable || typeof stable !== 'object' || Array.isArray(stable)) {
    return requiredChecksError(
      'native-browser-rejected',
      'Native browser verification returned unreadable failure authority.',
      false
    );
  }
  const candidate = stable as Record<string, unknown>;
  const expectedKeys = [
    'message',
    'quiescent',
    'recoveryRequired',
    ...(candidate.sessionAttempts === undefined ? [] : ['sessionAttempts']),
    'type',
  ];
  const rawAttempts = candidate.sessionAttempts;
  const attempts = Array.isArray(rawAttempts)
    ? rawAttempts
        .slice(0, CLEAN_ROOM_E2E_MAX_REPORTED_SESSION_ATTEMPTS)
        .map((attempt) => canonicalAttempt(attempt))
    : [];
  const validAttempts = attempts.flatMap((attempt) =>
    attempt && nativeFailureAttemptMatchesInput(attempt, input) ? [attempt] : []
  );
  const attemptsComplete =
    rawAttempts === undefined ||
    (Array.isArray(rawAttempts) &&
      rawAttempts.length <= CLEAN_ROOM_E2E_MAX_REPORTED_SESSION_ATTEMPTS &&
      validAttempts.length === rawAttempts.length);
  const quiescentAttemptsAreTerminal =
    candidate.quiescent !== true || validAttempts.every(isTerminalAttempt);
  if (
    !hasExactKeys(candidate, expectedKeys) ||
    !validErrorType(candidate.type) ||
    typeof candidate.message !== 'string' ||
    typeof candidate.quiescent !== 'boolean' ||
    typeof candidate.recoveryRequired !== 'boolean' ||
    candidate.recoveryRequired === candidate.quiescent ||
    !attemptsComplete ||
    !quiescentAttemptsAreTerminal
  ) {
    return requiredChecksError(
      'native-browser-authority-invalid',
      'Native browser verification returned inconsistent recovery authority.',
      false,
      validAttempts
    );
  }
  return requiredChecksError(
    candidate.type,
    safeText(candidate.message, 'Native browser verification was rejected.'),
    candidate.quiescent,
    validAttempts
  );
}

function nativeFailureAttemptMatchesInput(
  attempt: LoopSessionAttempt,
  input: Parameters<E2ERequiredChecksPort['run']>[0]
): boolean {
  return (
    attempt.purpose === 'browser-verification' &&
    attempt.phaseId === input.authority.phaseId &&
    attempt.verificationRunId === input.verificationRunId &&
    attempt.checkpointBefore === input.checkpointCommit &&
    (attempt.checkpointAfter === undefined || attempt.checkpointAfter === input.checkpointCommit) &&
    attempt.conversationId !== input.authority.outerConversationId &&
    sameExactTarget(attempt.target, input.target) &&
    validFailureAttemptState(attempt)
  );
}

function validFailureAttemptState(attempt: LoopSessionAttempt): boolean {
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
  return attempt.finishedAt !== undefined && attempt.checkpointAfter === undefined;
}

function isTerminalAttempt(attempt: LoopSessionAttempt): boolean {
  return ['completed', 'failed', 'cancelled', 'interrupted'].includes(attempt.status);
}

function requiredChecksError(
  type: string,
  message: string,
  quiescent: boolean,
  sessionAttempts: readonly LoopSessionAttempt[] = []
): Result<never, E2ERequiredChecksError> {
  const attempts = sessionAttempts
    .slice(0, CLEAN_ROOM_E2E_MAX_REPORTED_SESSION_ATTEMPTS)
    .flatMap((attempt) => {
      const copied = canonicalAttempt(attempt);
      return copied ? [copied] : [];
    });
  const attemptsComplete =
    sessionAttempts.length <= CLEAN_ROOM_E2E_MAX_REPORTED_SESSION_ATTEMPTS &&
    attempts.length === sessionAttempts.length;
  const exactQuiescence = quiescent && attemptsComplete;
  const error: E2ERequiredChecksError & { quiescent: boolean; recoveryRequired: boolean } = {
    type: validErrorType(type) ? type : 'native-browser-rejected',
    message: safeText(message, 'Native browser verification was rejected.'),
    quiescent: exactQuiescence,
    recoveryRequired: !exactQuiescence,
    ...(attempts.length > 0 ? { sessionAttempts: attempts } : {}),
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
      !validArtifactMimeType(parsed.data) ||
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

function isCanonicalAbsolutePath(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > 4_096 ||
    value.includes('\0') ||
    value !== value.trim()
  ) {
    return false;
  }
  const canonicalPosix =
    path.posix.isAbsolute(value) &&
    !value.includes('\\') &&
    path.posix.normalize(value) === value &&
    (value === '/' || !value.endsWith('/'));
  const canonicalWindows =
    path.win32.isAbsolute(value) &&
    !value.includes('/') &&
    path.win32.normalize(value) === value &&
    (/^[A-Za-z]:\\$/u.test(value) || !value.endsWith('\\'));
  return canonicalPosix || canonicalWindows;
}

function validArtifactMimeType(artifact: LoopArtifactReference): boolean {
  const mimeType = artifact.mimeType;
  return (
    mimeType === undefined ||
    (APPROVED_ARTIFACT_MIME_TYPES.has(mimeType) &&
      APPROVED_ARTIFACT_MIME_TYPES_BY_KIND[artifact.kind].has(mimeType) &&
      safeText(mimeType, 'application/octet-stream', 128) === mimeType)
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

function deepFreezeJson<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreezeJson(child);
  return Object.freeze(value);
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
